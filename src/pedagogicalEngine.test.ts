import { describe, expect, it, vi } from 'vitest';

vi.mock('./db/dexieDb', () => {
  const noopTable = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(undefined),
    toArray: vi.fn().mockResolvedValue([]),
    where: vi.fn(() => ({
      equals: vi.fn(() => ({
        delete: vi.fn().mockResolvedValue(undefined),
        toArray: vi.fn().mockResolvedValue([]),
      })),
    })),
  };
  return {
    createInitialUserStats: () => ({
      id: 'default',
      currentStreakDays: 0,
      lastStudyDate: '2026-01-01',
      totalFirstTryHits: 0,
      totalAttempts: 0,
      currentFirstTryStreak: 0,
      astMasteryCount: 0,
      srsReviewsCount: 0,
      updatedAt: 0,
    }),
    livingBooksDb: {
      installedCartridges: noopTable,
      lessonProgress: noopTable,
      srsCardsState: noopTable,
      savedUserCode: noopTable,
      unlockedAchievements: noopTable,
      userStats: noopTable,
      virtualFileSystems: noopTable,
      lessonTranslations: noopTable,
      learningTelemetry: noopTable,
      conceptMastery: noopTable,
    },
  };
});

import { detectPythonMisconception } from './engine/evaluators/misconceptionDetector';
import { enforceAntiSpoilingGuardrail } from './engine/compiler/socraticTutor';
import { buildUnitTestHarness } from './engine/evaluators/astRulesEngine';
import {
  buildPrioritizedReviewQueue,
  createInitialSrsState,
  gradeFromObjectiveOutcome,
} from './engine/srs/sm2Scheduler';
import { computeLessonMasteryTier, usePlatformStore } from './store/usePlatformStore';
import type { BookCartridge } from './types/cartridge.types';

describe('Pedagogical Engine (Misconceptions, Socratic Guardrail, Active SRS & Real Mastery)', () => {
  it('detects common Python mental-model misconceptions deterministically', () => {
    const printVsReturn = detectPythonMisconception('def doble(n):\n    print(n * 2)', {
      ok: true,
      stdout: '6',
      stderr: '',
      returnValue: null,
      plotsBase64: [],
      updatedVirtualFiles: {},
      executionTimeMs: 5,
      unitTestReport: {
        passed: false,
        total: 1,
        passedCount: 0,
        items: [{ name: 'Caso #1', passed: false, message: 'Esperado 6, obtenido None' }],
      },
    });
    expect(printVsReturn?.id).toBe('PRINT_VS_RETURN');

    const mutableArg = detectPythonMisconception('def add(x, bag=[]):\n    bag.append(x)\n    return bag');
    expect(mutableArg?.id).toBe('MUTABLE_DEFAULT_ARG');

    const legb = detectPythonMisconception('x = 1\ndef f():\n    x = x + 1', {
      ok: false,
      stdout: '',
      stderr: 'UnboundLocalError: cannot access local variable x',
      returnValue: null,
      plotsBase64: [],
      updatedVirtualFiles: {},
      executionTimeMs: 3,
    });
    expect(legb?.id).toBe('SCOPE_LEGB_SHADOWING');

    const loopMut = detectPythonMisconception('for item in nums:\n    nums.remove(item)');
    expect(loopMut?.id).toBe('SHALLOW_LOOP_MUTATION');
  });

  it('strips multi-line solution code blocks in Socratic Tutor anti-spoiling guardrail', () => {
    const spoiled =
      'Aquí tienes la pista:\n```python\ndef solve(x):\n    y = x * 2\n    return y\n```\n¿Qué devuelve?';
    const safe = enforceAntiSpoilingGuardrail(spoiled);
    expect(safe).not.toContain('return y');
    expect(safe).toContain('código omitido');
    expect(safe).toContain('¿Qué devuelve?');
  });

  it('builds granular per-assertion unit test harness with hidden transfer tests', () => {
    const script = buildUnitTestHarness(
      'def f(x):\n    return x + 1',
      'assert f(1) == 2\nassert f(2) == 3',
      'assert f(-1) == 0'
    );
    expect(script).toContain('_run_test_suite(_unit_test_code, False)');
    expect(script).toContain('_run_test_suite(_hidden_test_code, True)');
    expect(script).toContain('Transferencia #');
  });

  it('enrolls only studied/failed cards in SRS, interleaves across chapters, and grades objectively', () => {
    const cartridge: BookCartridge = {
      schemaVersion: '2.0',
      bookId: 'py-book',
      metadata: {
        title: 'Python',
        subtitle: '',
        authors: ['A'],
        edition: '1st',
        difficulty: 'BEGINNER',
        coverAccentIcon: '🐍',
      },
      themeDNA: {
        themeName: 'Dark',
        mode: 'dark',
        colors: {
          bgCanvas: '#000',
          bgSurface: '#111',
          bgElevated: '#222',
          borderSubtle: '#333',
          textPrimary: '#fff',
          textMuted: '#999',
          accentPrimary: '#0af',
          accentSecondary: '#fa0',
          accentSuccess: '#0f0',
          accentDanger: '#f00',
        },
        typography: { editorialFont: 'sans', codeFont: 'monospace' },
      },
      runtimeRequirements: {
        pythonVersion: '3.14',
        packages: [],
        enableLiveMemoryTracer: true,
        virtualFileSystemSeed: {},
      },
      glossary: {},
      achievements: [],
      chapters: [
        {
          chapterId: 'ch1',
          number: 1,
          title: 'Cap 1',
          summary: '',
          microLessons: [
            {
              lessonId: 'l1',
              order: 1,
              title: 'L1',
              estimatedMinutes: 5,
              blocks: [
                {
                  blockId: 'c1a',
                  type: 'FLASHCARD',
                  cardId: 'card-1a',
                  frontMarkdown: 'Q1a',
                  backMarkdown: 'A1a',
                  tags: ['ch1'],
                },
                {
                  blockId: 'c1b',
                  type: 'FLASHCARD',
                  cardId: 'card-1b',
                  frontMarkdown: 'Q1b',
                  backMarkdown: 'A1b',
                  tags: ['ch1'],
                },
              ],
            },
          ],
        },
        {
          chapterId: 'ch2',
          number: 2,
          title: 'Cap 2',
          summary: '',
          microLessons: [
            {
              lessonId: 'l2',
              order: 1,
              title: 'L2',
              estimatedMinutes: 5,
              blocks: [
                {
                  blockId: 'c2a',
                  type: 'FLASHCARD',
                  cardId: 'card-2a',
                  frontMarkdown: 'Q2a',
                  backMarkdown: 'A2a',
                  tags: ['ch2'],
                },
              ],
            },
          ],
        },
        {
          chapterId: 'ch3',
          number: 3,
          title: 'Cap 3 (No estudiado)',
          summary: '',
          microLessons: [
            {
              lessonId: 'l3',
              order: 1,
              title: 'L3',
              estimatedMinutes: 5,
              blocks: [
                {
                  blockId: 'c3a',
                  type: 'FLASHCARD',
                  cardId: 'card-3a',
                  frontMarkdown: 'Q3a',
                  backMarkdown: 'A3a',
                  tags: ['ch3'],
                },
              ],
            },
          ],
        },
      ],
    };

    const now = Date.now();
    const states = {
      'card-1a': createInitialSrsState('py-book', 'card-1a', now - 1000, true),
      'card-1b': createInitialSrsState('py-book', 'card-1b', now - 1000, true),
      'card-2a': createInitialSrsState('py-book', 'card-2a', now - 1000, true),
      // card-3a is NOT enrolled
    };

    const queue = buildPrioritizedReviewQueue(cartridge, states, now);
    expect(queue.map((q) => q.card.cardId)).not.toContain('card-3a');
    // Interleaving: cap 1 and cap 2 alternate instead of [card-1a, card-1b, card-2a]
    expect(queue[0].chapterNumber).not.toBe(queue[1].chapterNumber);

    expect(gradeFromObjectiveOutcome(false, 5000)).toBe(0);
    expect(gradeFromObjectiveOutcome(true, 60000, false)).toBe(3);
    expect(gradeFromObjectiveOutcome(true, 10000, true)).toBe(3);
    expect(gradeFromObjectiveOutcome(true, 25000, false)).toBe(4);
    expect(gradeFromObjectiveOutcome(true, 8000, false)).toBe(5);
  });

  it('marks hadMistakes=true on active lesson when recordAttempt(false) is called, yielding SILVER instead of GOLD', async () => {
    usePlatformStore.setState({
      activeBookId: 'b1',
      activeLessonId: 'l1',
      unlockedBlockIndex: 2,
      lessonProgressMap: {
        'b1::l1': {
          bookId: 'b1',
          lessonId: 'l1',
          unlockedBlockIndex: 2,
          isCompleted: true,
          masteryTier: 'GOLD',
          hadMistakes: false,
          updatedAt: Date.now(),
        },
      },
    });

    await usePlatformStore.getState().recordAttempt(false);
    const updated = usePlatformStore.getState().lessonProgressMap['b1::l1'];
    expect(updated.hadMistakes).toBe(true);
    expect(computeLessonMasteryTier(updated, 3)).toBe('SILVER');
  });
});
