import type {
  BookCartridge,
  LessonBlock,
  PythonMisconceptionId,
} from '../../types/cartridge.types';
import {
  livingBooksDb,
  type ConceptSourceRef,
  type ExerciseBankRecord,
  type GlobalCompetencyMasteryRecord,
  type GlobalConceptRecord,
} from '../../db/dexieDb';
import {
  competencyForMisconception,
  computeCompetencyMasteryScore,
  matchCompetenciesFromText,
} from '../../data/pythonTaxonomy';

export function normalizeConceptKey(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_+.#-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const MOBILE_FRIENDLY_TYPES = new Set<LessonBlock['type']>([
  'OUTPUT_PREDICTION',
  'PARSONS_PROBLEM',
  'BUG_AUTOPSY',
  'SYNTAX_CLOZE',
  'QUICK_QUIZ',
]);

const PRACTICE_BLOCK_TYPES = new Set<LessonBlock['type']>([
  'OUTPUT_PREDICTION',
  'PARSONS_PROBLEM',
  'BUG_AUTOPSY',
  'SYNTAX_CLOZE',
  'QUICK_QUIZ',
  'CODE_LAB',
  'AST_CHALLENGE',
]);

const COMMON_BILINGUAL_ALIASES: Record<string, string[]> = {
  variable: ['variables', 'identificador', 'nombre'],
  object: ['objeto', 'objetos', 'objects'],
  namespace: ['espacio de nombres', 'scope', 'ámbito'],
  aliasing: ['alias', 'referencia compartida'],
  precedence: ['precedencia', 'orden de evaluación'],
  comprehension: ['list comprehension', 'comprehensions', 'comprensión de lista'],
  mutation: ['mutación', 'mutabilidad', 'mutable', 'in-place'],
  dataframe: ['dataframes', 'tabla pandas'],
  vectorization: ['vectorización', 'vectorizado'],
  recursion: ['recursión', 'recursividad'],
  generator: ['generador', 'generadores', 'yield'],
  closure: ['clausura', 'closures'],
  decorator: ['decorador', 'decoradores'],
  iterable: ['iterables', 'iterador', 'iterator'],
};

function inferAliases(term: string, explicitAliases?: string[]): string[] {
  const key = normalizeConceptKey(term);
  const set = new Set<string>();
  for (const a of explicitAliases ?? []) {
    if (a.trim()) set.add(a.trim());
  }
  for (const a of COMMON_BILINGUAL_ALIASES[key] ?? []) {
    set.add(a);
  }
  // Plural simple en inglés/español
  if (!term.endsWith('s') && term.length >= 4 && /^[a-zA-ZÀ-ÿ]+$/.test(term)) {
    set.add(`${term}s`);
  }
  set.delete(term);
  return [...set];
}

function findLessonForGlossaryTerm(
  cartridge: BookCartridge,
  term: string,
  chapterIntroduced: number,
  explicitLessonId?: string
): { chapterId: string; chapterNumber: number; lessonId: string; lessonTitle: string } {
  const normTerm = term.toLowerCase();
  if (explicitLessonId) {
    for (const ch of cartridge.chapters) {
      const ml = ch.microLessons.find((l) => l.lessonId === explicitLessonId);
      if (ml) {
        return {
          chapterId: ch.chapterId,
          chapterNumber: ch.number,
          lessonId: ml.lessonId,
          lessonTitle: ml.title,
        };
      }
    }
  }

  // Buscar coincidencia exacta en capítulo introducido
  const targetChapter =
    cartridge.chapters.find((c) => c.number === chapterIntroduced) ?? cartridge.chapters[0];
  if (targetChapter) {
    for (const ml of targetChapter.microLessons) {
      const haystack = `${ml.title} ${ml.sourceBookMarkdown ?? ''} ${ml.blocks
        .map((b) => (b.type === 'PROSE' ? b.markdown : ''))
        .join(' ')}`.toLowerCase();
      if (haystack.includes(normTerm)) {
        return {
          chapterId: targetChapter.chapterId,
          chapterNumber: targetChapter.number,
          lessonId: ml.lessonId,
          lessonTitle: ml.title,
        };
      }
    }
    const first = targetChapter.microLessons[0];
    if (first) {
      return {
        chapterId: targetChapter.chapterId,
        chapterNumber: targetChapter.number,
        lessonId: first.lessonId,
        lessonTitle: first.title,
      };
    }
  }

  const fallbackCh = cartridge.chapters[0];
  const fallbackMl = fallbackCh?.microLessons[0];
  return {
    chapterId: fallbackCh?.chapterId ?? 'ch1',
    chapterNumber: fallbackCh?.number ?? chapterIntroduced ?? 1,
    lessonId: fallbackMl?.lessonId ?? 'lesson-1',
    lessonTitle: fallbackMl?.title ?? cartridge.metadata.title,
  };
}

/**
 * Indexa un BookCartridge completo en el grafo de conocimiento local (Dexie v7):
 * - Consolida glosario en `concepts` (merge multi-libro de `sources[]` y `aliases[]`).
 * - Indexa todos los ejercicios del flujo principal + `exerciseBank[]` en `exerciseBank`.
 */
export async function indexCartridgeIntoKnowledgeGraph(
  cartridge: BookCartridge
): Promise<{ conceptsIndexed: number; exercisesIndexed: number }> {
  const now = Date.now();
  let conceptsIndexed = 0;
  let exercisesIndexed = 0;

  // 1. Consolidar glosario en tabla transversal `concepts`
  if (livingBooksDb.concepts) {
    for (const entry of Object.values(cartridge.glossary ?? {})) {
      const conceptKey = normalizeConceptKey(entry.term);
      if (!conceptKey) continue;

      const origin = findLessonForGlossaryTerm(
        cartridge,
        entry.term,
        entry.chapterIntroduced,
        entry.lessonId
      );
      const sourceRef: ConceptSourceRef = {
        bookId: cartridge.bookId,
        bookTitle: cartridge.metadata.title,
        chapterId: origin.chapterId,
        chapterNumber: origin.chapterNumber,
        lessonId: origin.lessonId,
        lessonTitle: origin.lessonTitle,
        pageRef: entry.pageRef,
      };

      const inferredAliases = inferAliases(entry.term, entry.aliases);
      const competencyIds =
        entry.competencyIds && entry.competencyIds.length > 0
          ? entry.competencyIds
          : matchCompetenciesFromText(
              [entry.term, ...inferredAliases, entry.definition, origin.lessonTitle],
              2
            );

      const existing = await livingBooksDb.concepts.get(conceptKey).catch(() => undefined);
      if (existing) {
        const mergedAliases = [...new Set([...existing.aliases, ...inferredAliases])].filter(
          (a) => a.toLowerCase() !== existing.term.toLowerCase()
        );
        const mergedComps = [...new Set([...existing.competencyIds, ...competencyIds])];
        const filteredSources = existing.sources.filter(
          (s) => !(s.bookId === sourceRef.bookId && s.lessonId === sourceRef.lessonId)
        );
        filteredSources.push(sourceRef);

        const updated: GlobalConceptRecord = {
          ...existing,
          aliases: mergedAliases,
          definition:
            entry.definition.length > existing.definition.length
              ? entry.definition
              : existing.definition,
          snippet: existing.snippet ?? entry.snippet,
          deepDive: existing.deepDive ?? entry.deepDive,
          competencyIds: mergedComps,
          sources: filteredSources,
          updatedAt: now,
        };
        await livingBooksDb.concepts.put(updated).catch(() => {});
      } else {
        const created: GlobalConceptRecord = {
          conceptKey,
          term: entry.term,
          aliases: inferredAliases,
          definition: entry.definition,
          snippet: entry.snippet,
          deepDive: entry.deepDive,
          competencyIds,
          sources: [sourceRef],
          updatedAt: now,
        };
        await livingBooksDb.concepts.put(created).catch(() => {});
      }
      conceptsIndexed += 1;
    }
  }

  // 2. Indexar ejercicios precompilados (flujo principal + exerciseBank) en `exerciseBank`
  if (livingBooksDb.exerciseBank) {
    const glossaryKeys = Object.values(cartridge.glossary ?? {}).map((g) => ({
      key: normalizeConceptKey(g.term),
      terms: [g.term.toLowerCase(), ...inferAliases(g.term, g.aliases).map((a) => a.toLowerCase())],
    }));

    const recordsToPut: ExerciseBankRecord[] = [];

    for (const ch of cartridge.chapters) {
      for (const ml of ch.microLessons) {
        const lessonComps =
          ml.competencyIds && ml.competencyIds.length > 0
            ? ml.competencyIds
            : matchCompetenciesFromText([ch.title, ml.title, ...(ml.learningObjectives ?? [])], 3);

        const allBlocks: LessonBlock[] = [...ml.blocks, ...(ml.exerciseBank ?? [])];
        for (const blk of allBlocks) {
          if (!PRACTICE_BLOCK_TYPES.has(blk.type)) continue;

          const textBag = [
            ml.title,
            ...(blk.conceptTags ?? []),
            'prompt' in blk ? blk.prompt : '',
            'title' in blk ? blk.title : '',
            'instructions' in blk ? blk.instructions : '',
          ].join(' ');

          const blockComps =
            blk.competencyIds && blk.competencyIds.length > 0
              ? blk.competencyIds
              : matchCompetenciesFromText([textBag, ...lessonComps], 3);
          const finalComps = blockComps.length > 0 ? blockComps : lessonComps;

          const normBag = textBag.toLowerCase();
          const conceptKeys = new Set<string>();
          for (const tag of blk.conceptTags ?? []) {
            const k = normalizeConceptKey(tag);
            if (k) conceptKeys.add(k);
          }
          for (const g of glossaryKeys) {
            if (g.terms.some((t) => t.length >= 3 && normBag.includes(t))) {
              conceptKeys.add(g.key);
            }
          }

          recordsToPut.push({
            exerciseId: `${cartridge.bookId}::${ml.lessonId}::${blk.blockId}`,
            bookId: cartridge.bookId,
            chapterId: ch.chapterId,
            lessonId: ml.lessonId,
            blockType: blk.type,
            mobileFriendly: MOBILE_FRIENDLY_TYPES.has(blk.type),
            origin: 'PRECOMPILED',
            verifiedWithPyodide: true,
            competencyIds: finalComps,
            conceptKeys: [...conceptKeys],
            block: blk,
            createdAt: now,
          });
        }
      }
    }

    if (recordsToPut.length > 0) {
      await livingBooksDb.exerciseBank.bulkPut(recordsToPut).catch(() => {});
      exercisesIndexed = recordsToPut.length;
    }
  }

  return { conceptsIndexed, exercisesIndexed };
}

export interface CompetencyEvidenceSignal {
  bookId: string;
  competencyIds?: string[];
  conceptTags?: string[];
  misconceptionId?: PythonMisconceptionId;
  kind:
    | 'PREDICTION'
    | 'ACTIVE_EXERCISE'
    | 'TRANSFER_LAB'
    | 'SRS_REVIEW'
    | 'MISCONCEPTION_TRIGGERED'
    | 'MISCONCEPTION_RESOLVED';
  passed?: boolean;
  fsrsStability?: number;
  daysSinceLastPractice?: number;
}

/**
 * Registra evidencia de aprendizaje real en `globalCompetencyMastery` (libro-agnóstico)
 * y recalcula el puntaje de dominio demostrado (0..100).
 */
export async function recordCompetencyEvidence(
  signal: CompetencyEvidenceSignal
): Promise<GlobalCompetencyMasteryRecord[]> {
  const now = Date.now();
  const resolvedIds = new Set<string>(signal.competencyIds ?? []);

  if (signal.misconceptionId) {
    resolvedIds.add(competencyForMisconception(signal.misconceptionId));
  }
  if (resolvedIds.size === 0 && signal.conceptTags && signal.conceptTags.length > 0) {
    for (const id of matchCompetenciesFromText(signal.conceptTags, 2)) {
      resolvedIds.add(id);
    }
  }

  if (resolvedIds.size === 0 || !livingBooksDb.globalCompetencyMastery) {
    return [];
  }

  const updatedRecords: GlobalCompetencyMasteryRecord[] = [];

  for (const competencyId of resolvedIds) {
    const existing = await livingBooksDb.globalCompetencyMastery
      .get(competencyId)
      .catch(() => undefined);

    const base: GlobalCompetencyMasteryRecord = existing ?? {
      competencyId,
      status: 'UNSEEN',
      masteryScore: 0,
      predictionHits: 0,
      predictionAttempts: 0,
      activeExercisesPassed: 0,
      activeExercisesAttempts: 0,
      transferPassed: false,
      delayedReviewPassed: false,
      fsrsMaxStability: 0,
      misconceptionHits: {},
      misconceptionResolved: [],
      sourceBookIds: [],
      lastPracticedAt: now,
      updatedAt: now,
    };

    const next: GlobalCompetencyMasteryRecord = {
      ...base,
      misconceptionHits: { ...base.misconceptionHits },
      misconceptionResolved: [...base.misconceptionResolved],
      sourceBookIds: base.sourceBookIds.includes(signal.bookId)
        ? base.sourceBookIds
        : [...base.sourceBookIds, signal.bookId],
      lastPracticedAt: now,
      updatedAt: now,
    };

    switch (signal.kind) {
      case 'PREDICTION':
        next.predictionAttempts += 1;
        if (signal.passed) next.predictionHits += 1;
        break;
      case 'ACTIVE_EXERCISE':
        next.activeExercisesAttempts += 1;
        if (signal.passed) next.activeExercisesPassed += 1;
        break;
      case 'TRANSFER_LAB':
        next.activeExercisesAttempts += 1;
        if (signal.passed) {
          next.activeExercisesPassed += 1;
          next.transferPassed = true;
        }
        break;
      case 'SRS_REVIEW':
        if (typeof signal.fsrsStability === 'number') {
          next.fsrsMaxStability = Math.max(next.fsrsMaxStability, signal.fsrsStability);
        }
        if (signal.passed && ((signal.daysSinceLastPractice ?? 0) >= 3 || (signal.fsrsStability ?? 0) >= 5)) {
          next.delayedReviewPassed = true;
        }
        break;
      case 'MISCONCEPTION_TRIGGERED':
        if (signal.misconceptionId) {
          next.misconceptionHits[signal.misconceptionId] =
            (next.misconceptionHits[signal.misconceptionId] ?? 0) + 1;
          next.misconceptionResolved = next.misconceptionResolved.filter(
            (m) => m !== signal.misconceptionId
          );
        }
        break;
      case 'MISCONCEPTION_RESOLVED':
        if (signal.misconceptionId && !next.misconceptionResolved.includes(signal.misconceptionId)) {
          next.misconceptionResolved.push(signal.misconceptionId);
        }
        break;
    }

    const { score, status } = computeCompetencyMasteryScore(next, now);
    next.masteryScore = score;
    next.status = status;

    await livingBooksDb.globalCompetencyMastery.put(next).catch(() => {});
    updatedRecords.push(next);
  }

  return updatedRecords;
}
