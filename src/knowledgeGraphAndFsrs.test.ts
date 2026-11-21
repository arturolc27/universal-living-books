import { describe, it, expect } from 'vitest';
import practicalProgrammingRaw from '../public/cartridges/practical-programming/cartridge.json';
import intuitivePythonRaw from '../public/cartridges/intuitive-python/cartridge.json';
import {
  PYTHON_COMPETENCIES,
  PYTHON_DOMAINS,
  computeCompetencyMasteryScore,
  matchCompetenciesFromText,
} from './data/pythonTaxonomy';
import {
  buildGlobalFsrsReviewQueue,
  computeNextFsrsState,
  ensureFsrsFields,
  formatIntervalLabel,
} from './engine/srs/fsrsScheduler';
import { createInitialSrsState } from './engine/srs/sm2Scheduler';
import {
  autoLinkGlossaryMarkdown,
  buildAutoLinkTargets,
} from './engine/knowledge/glossaryAutoLinker';
import { sanitizeLesson } from './engine/compiler/lessonSanitizer';
import { validateBookCartridge } from './types/cartridge.schema';
import type { BookCartridge } from './types/cartridge.types';

const practicalProgrammingCartridge = practicalProgrammingRaw as unknown as BookCartridge;
const intuitivePythonCartridge = intuitivePythonRaw as unknown as BookCartridge;

describe('Canonical Python Taxonomy & Demonstrated Mastery Score', () => {
  it('defines exactly 9 domains and 54 unique canonical competencies', () => {
    expect(PYTHON_DOMAINS).toHaveLength(9);
    expect(PYTHON_COMPETENCIES).toHaveLength(54);
    const ids = new Set(PYTHON_COMPETENCIES.map((c) => c.id));
    expect(ids.size).toBe(54);
    const domainIds = new Set(PYTHON_DOMAINS.map((d) => d.id));
    for (const c of PYTHON_COMPETENCIES) {
      expect(domainIds.has(c.domainId)).toBe(true);
      for (const pre of c.prerequisites) {
        expect(ids.has(pre)).toBe(true);
      }
    }
  });

  it('deterministically maps concepts/tags to canonical competency IDs', () => {
    const aliasMatches = matchCompetenciesFromText(['aliasing', 'mutabilidad', 'referencia compartida']);
    expect(aliasMatches).toContain('py.memory.aliasing');

    const compMatches = matchCompetenciesFromText(['list comprehension', 'ListComp']);
    expect(compMatches).toContain('py.idiom.comprehensions');
  });

  it('computes demonstrated mastery score with misconception penalties and mastery threshold', () => {
    const unseen = computeCompetencyMasteryScore(undefined);
    expect(unseen).toEqual({ score: 0, status: 'UNSEEN' });

    const mastered = computeCompetencyMasteryScore({
      predictionHits: 3,
      predictionAttempts: 3,
      activeExercisesPassed: 3,
      activeExercisesAttempts: 3,
      transferPassed: true,
      delayedReviewPassed: true,
      fsrsMaxStability: 14,
      misconceptionHits: {},
      misconceptionResolved: [],
    });
    expect(mastered.status).toBe('MASTERED');
    expect(mastered.score).toBeGreaterThanOrEqual(85);

    const openBug = computeCompetencyMasteryScore({
      predictionHits: 2,
      predictionAttempts: 3,
      activeExercisesPassed: 2,
      activeExercisesAttempts: 3,
      transferPassed: false,
      delayedReviewPassed: false,
      fsrsMaxStability: 2,
      misconceptionHits: { MUTATION_ALIASING: 2 },
      misconceptionResolved: [],
    });
    expect(openBug.status).toBe('NEEDS_REVIEW');
  });
});

describe('FSRS v4.5 Scheduler & Book-Agnostic Global Review Queue', () => {
  it('migrates legacy SM-2 records and schedules increasing intervals for Good/Easy vs Lapse', () => {
    const now = 1_700_000_000_000;
    const legacy = createInitialSrsState('book-a', 'card-1', now, true);
    const ensured = ensureFsrsFields(legacy);
    expect(ensured.fsrsState).toBe('NEW');

    const afterGood = computeNextFsrsState(ensured, 3, now);
    expect(afterGood.fsrsState).toBe('REVIEW');
    expect((afterGood.stability ?? 0) > 1).toBe(true);
    expect(afterGood.nextReviewTimestamp).toBeGreaterThan(now);

    const afterEasy = computeNextFsrsState(afterGood, 4, now + 3 * 86_400_000);
    expect((afterEasy.stability ?? 0) > (afterGood.stability ?? 0)).toBe(true);

    const afterLapse = computeNextFsrsState(afterEasy, 1, now + 10 * 86_400_000);
    expect(afterLapse.fsrsState).toBe('RELEARNING');
    expect((afterLapse.lapses ?? 0)).toBeGreaterThanOrEqual(1);

    const label = formatIntervalLabel(ensured, 3, now);
    expect(label).toMatch(/\d+\s*(min|h|d|m)/);
  });

  it('builds an enrolled-only, cross-book interleaved queue', () => {
    const pp = practicalProgrammingCartridge;
    const ip = intuitivePythonCartridge;
    const cartridges = { [pp.bookId]: pp, [ip.bookId]: ip };
    const now = 1_700_000_000_000;

    // Sin tarjetas enroladas -> cola vacía (no contamina con temas no estudiados)
    expect(buildGlobalFsrsReviewQueue(cartridges, {}, { now })).toHaveLength(0);

    // Enrolar 2 de Practical Programming y 2 de Intuitive Python
    const srsStates = {
      [`${pp.bookId}::pp-card-reassign`]: createInitialSrsState(pp.bookId, 'pp-card-reassign', now - 1000, true),
      [`${pp.bookId}::pp-card-aliasing`]: createInitialSrsState(pp.bookId, 'pp-card-aliasing', now - 1000, true),
      [`${ip.bookId}::ip-card-listcomp`]: createInitialSrsState(ip.bookId, 'ip-card-listcomp', now - 1000, true),
      [`${ip.bookId}::ip-card-mutation`]: createInitialSrsState(ip.bookId, 'ip-card-mutation', now - 1000, true),
    };

    const queue = buildGlobalFsrsReviewQueue(cartridges, srsStates, { now, dueOnly: true });
    expect(queue).toHaveLength(4);
    // Verificar intercalado entre libros (no salen los 2 del mismo libro pegados primero)
    expect(queue[0].bookId).not.toBe(queue[1].bookId);
  });
});

describe('Smart Alias-Aware Glossary Auto-Linker', () => {
  it('links first occurrence per paragraph, supports aliases, and skips code/headings/links', () => {
    const targets = buildAutoLinkTargets({
      aliasing: {
        term: 'aliasing',
        aliases: ['referencia compartida'],
        definition: 'Dos nombres apuntando al mismo objeto.',
        chapterIntroduced: 2,
      },
      comprehension: {
        term: 'comprehension',
        aliases: ['list comprehension'],
        definition: 'Expresión declarativa.',
        chapterIntroduced: 1,
      },
    });

    const input = [
      '## Aliasing en listas',
      '',
      'El aliasing ocurre cuando hay referencia compartida y otro aliasing repetido en el mismo párrafo.',
      '',
      'En otro párrafo `aliasing` dentro de inline code no se enlaza, pero List Comprehension sí se enlaza.',
      '',
      '```python',
      '# aliasing y comprehension dentro de codigo nunca se tocan',
      'x = [n for n in range(3)]',
      '```',
    ].join('\n');

    const linked = autoLinkGlossaryMarkdown(input, targets);

    // Encabezado intacto
    expect(linked).toContain('## Aliasing en listas');
    // Primer aliasing enlazado, pero segundo aliasing y alias en mismo párrafo NO duplicados
    const firstPara = linked.split('\n\n')[1];
    expect((firstPara.match(/\(#glossary:aliasing\)/g) ?? []).length).toBe(1);
    // Código inline intacto, pero List Comprehension enlazado
    expect(linked).toContain('`aliasing`');
    expect(linked).toContain('[List Comprehension](#glossary:comprehension)');
    // Código cercado intacto
    expect(linked).toContain('# aliasing y comprehension dentro de codigo nunca se tocan');
  });
});

describe('Compiler v3 Sanitizer & Upgraded Bundled Cartridges', () => {
  it('validates both upgraded bundled cartridges with Deep Dive, sourceBookMarkdown, and exerciseBank', () => {
    for (const raw of [practicalProgrammingCartridge, intuitivePythonCartridge]) {
      const res = validateBookCartridge(raw);
      expect(res.success).toBe(true);
      if (res.success) {
        for (const ch of res.cartridge.chapters) {
          for (const ml of ch.microLessons) {
            expect(ml.sourceBookMarkdown?.length ?? 0).toBeGreaterThan(200);
            expect(ml.deepDive?.internalMechanics.length ?? 0).toBeGreaterThan(40);
            expect((ml.exerciseBank?.length ?? 0)).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it('preserves deepDive, competencyIds, and exerciseBank inside sanitizeLesson', () => {
    const cleaned = sanitizeLesson({
      lessonId: 'l1',
      order: 1,
      title: 'Mutabilidad',
      estimatedMinutes: 10,
      competencyIds: ['py.memory.mutability'],
      deepDive: {
        internalMechanics: 'CPython muta el buffer interno de PyListObject.',
        edgeCases: ['+= muta in-place'],
        commonPitfalls: ['Aliasing accidental'],
        realWorldContrast: 'Usa copias explícitas en APIs públicas.',
      },
      exerciseBank: [
        {
          blockId: 'eb1',
          type: 'OUTPUT_PREDICTION',
          prompt: 'Salida?',
          codeSnippet: 'print(1 + 1)',
          options: ['2', '11'],
          correctOptionIndex: 0,
          expectedReturnType: 'int',
          explanation: 'Suma entera.',
        },
      ],
      blocks: [
        { blockId: 'p1', type: 'PROSE', markdown: 'Contenido base.' },
      ],
    });
    expect(cleaned.deepDive?.internalMechanics).toContain('PyListObject');
    expect(cleaned.competencyIds).toEqual(['py.memory.mutability']);
    expect(cleaned.exerciseBank).toHaveLength(1);
  });
});
