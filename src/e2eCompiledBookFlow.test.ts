import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db/dexieDb', () => {
  const noopTable = {
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
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
      totalXp: 0,
      streakDays: 0,
      lastStudyDate: '2026-01-01',
      lessonsCompleted: 0,
      dailyXpHistory: {},
    }),
    livingBooksDb: {
      installedCartridges: noopTable,
      cartridges: noopTable,
      lessonProgress: noopTable,
      srsCardsState: noopTable,
      srsStates: noopTable,
      virtualFileSystems: noopTable,
      virtualFiles: noopTable,
      userStats: noopTable,
      settings: noopTable,
      lessonTranslations: noopTable,
      transaction: vi.fn(async (_mode: string, _tables: unknown[], cb: () => Promise<void>) => cb()),
    },
  };
});

import {
  repairCartridgeForRuntime,
  sanitizeBlock,
  sanitizeLesson,
} from './engine/compiler/lessonSanitizer';
import { coerceChaptersIndex } from './engine/compiler/metadataTocExtractor';
import { usePlatformStore } from './store/usePlatformStore';
import type { BookCartridge } from './types/cartridge.types';

describe('Compiled book resilience & E2E opening flow', () => {
  it('repairs malformed LLM blocks without dropping chapters or lessons', () => {
    const dirtyCartridge = {
      bookId: 'libro-llm-sucio',
      metadata: {
        title: 'Python Real',
        authors: ['Autor'],
      },
      chapters: [
        {
          number: 1,
          title: 'Inicio',
          microLessons: [
            {
              lessonId: 'sec-1',
              title: 'Variables',
              blocks: [
                {
                  blockId: 'b1',
                  type: 'OUTPUT_PREDICTION',
                  prompt: { text: 'Que imprime?' },
                  codeSnippet: 'print(2 + 2)',
                  options: [
                    { id: 'a', text: '4' },
                    { id: 'b', text: '22' },
                  ],
                  correctOptionIndex: 0,
                  expectedReturnType: 'int',
                  explanation: 'Suma entera',
                },
                {
                  blockId: 'b2',
                  type: 'INTERACTIVE_VISUALIZER',
                  visualizerKind: 'MEMORY_MODEL',
                  title: 'Heap',
                  payload: {},
                },
                {
                  blockId: 'b3',
                  type: 'PARSONS_PROBLEM',
                },
              ],
            },
          ],
        },
      ],
    };

    const repaired = repairCartridgeForRuntime(dirtyCartridge);
    expect(repaired).not.toBeNull();
    expect(repaired?.chapters).toHaveLength(1);
    expect(repaired?.chapters[0].microLessons).toHaveLength(1);

    const blocks = repaired!.chapters[0].microLessons[0].blocks;
    expect(blocks[0].type).toBe('OUTPUT_PREDICTION');
    if (blocks[0].type === 'OUTPUT_PREDICTION') {
      expect(blocks[0].options).toEqual(['4', '22']);
      expect(blocks[0].prompt).toBe('Que imprime?');
    }
    if (blocks[2].type === 'PARSONS_PROBLEM') {
      expect(Array.isArray(blocks[2].blocks)).toBe(true);
    }
  });

  it('sanitizes SYNTAX_CLOZE and QUICK_QUIZ blocks', () => {
    const cloze = sanitizeBlock(
      { blockId: 'c1', type: 'SYNTAX_CLOZE', title: 'Cloze', prompt: 'p', codeTemplate: 'x=___', blanks: [], explanation: 'e' },
      0
    );
    const quiz = sanitizeBlock({ blockId: 'q1', type: 'QUICK_QUIZ', title: 'Quiz', questions: [] }, 1);
    expect(cloze?.type).toBe('SYNTAX_CLOZE');
    expect(quiz?.type).toBe('QUICK_QUIZ');
  });

  it('normalizes LLM field aliases (content/front/back), injects fallback PROSE, and preserves sectionTitle', () => {
    const prose = sanitizeBlock({ blockId: 'p1', type: 'PROSE', content: 'Explicación real sobre listas.' }, 0);
    expect(prose?.type).toBe('PROSE');
    if (prose?.type === 'PROSE') {
      expect(prose.markdown).toBe('Explicación real sobre listas.');
    }

    const card = sanitizeBlock(
      { blockId: 'fc1', type: 'FLASHCARD', front: '¿Qué es tuple?', back: 'Secuencia inmutable.' },
      1
    );
    expect(card?.type).toBe('FLASHCARD');
    if (card?.type === 'FLASHCARD') {
      expect(card.frontMarkdown).toBe('¿Qué es tuple?');
      expect(card.backMarkdown).toBe('Secuencia inmutable.');
    }

    const sanitizedLesson = sanitizeLesson(
      {
        lessonId: 'sec-list',
        title: 'Leccion',
        blocks: [{ blockId: 'f1', type: 'FLASHCARD', front: 'A', back: 'B' }],
      },
      {
        sectionTitle: 'Listas y Tuplas en Python',
        cleanText: 'Texto fuente extraído del capítulo para evitar pantallas vacías.',
        order: 2,
      }
    );

    expect(sanitizedLesson.title).toBe('Listas y Tuplas en Python');
    expect(sanitizedLesson.blocks[0].type).toBe('PROSE');
    if (sanitizedLesson.blocks[0].type === 'PROSE') {
      expect(sanitizedLesson.blocks[0].markdown).toContain('Texto fuente extraído');
    }
  });

  it('deduplicates colliding chapterNumber entries in coerceChaptersIndex', () => {
    const chapters = coerceChaptersIndex(
      [
        { chapterNumber: 1, title: 'Prefacio', startPage: 1, endPage: 5 },
        { chapterNumber: 1, title: 'Capítulo 1: Introducción', startPage: 6, endPage: 25 },
      ],
      50000,
      100
    );
    expect(chapters).toHaveLength(2);
    expect(chapters.map((c) => c.chapterNumber)).toEqual([1, 2]);
  });
});

describe('usePlatformStore lesson progression state machine', () => {
  const sampleBook: BookCartridge = {
    schemaVersion: '2.0',
    bookId: 'test-book-nav',
    metadata: {
      title: 'Test Python Book',
      subtitle: 'Guía práctica',
      authors: ['Author'],
      edition: '1st',
      difficulty: 'BEGINNER',
      coverAccentIcon: '🐍',
    },
    themeDNA: {
      themeName: 'Slate',
      mode: 'dark',
      colors: {
        bgCanvas: '#0F1419',
        bgSurface: '#182026',
        bgElevated: '#222D36',
        borderSubtle: '#2E3C48',
        textPrimary: '#F1F5F9',
        textMuted: '#94A3B8',
        accentPrimary: '#38BDF8',
        accentSecondary: '#F59E0B',
        accentSuccess: '#10B981',
        accentDanger: '#F43F5E',
      },
      typography: { editorialFont: 'sans', codeFont: 'JetBrains Mono' },
    },
    runtimeRequirements: {
      pythonVersion: '3.12',
      packages: [],
      enableLiveMemoryTracer: false,
      virtualFileSystemSeed: {},
    },
    glossary: {},
    achievements: [],
    chapters: [
      {
        chapterId: 'ch-1',
        number: 1,
        title: 'Fundamentos',
        summary: 'Resumen',
        microLessons: [
          {
            lessonId: 'l-1',
            order: 1,
            title: 'Lección 1',
            estimatedMinutes: 5,
            blocks: [
              { blockId: 'b-1', type: 'PROSE', markdown: 'Concepto 1' },
              {
                blockId: 'b-2',
                type: 'OUTPUT_PREDICTION',
                prompt: 'Salida?',
                codeSnippet: 'print(1)',
                options: ['1', '2'],
                correctOptionIndex: 0,
                expectedReturnType: 'int',
                explanation: 'Imprime 1',
              },
            ],
          },
          {
            lessonId: 'l-2',
            order: 2,
            title: 'Lección 2',
            estimatedMinutes: 5,
            blocks: [{ blockId: 'b-3', type: 'PROSE', markdown: 'Concepto 2' }],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    usePlatformStore.setState({
      cartridges: { [sampleBook.bookId]: sampleBook },
      lessonProgressMap: {},
      srsStates: {},
      activeBookId: null,
      activeLessonId: null,
      activeBlockIndex: 0,
      unlockedBlockIndex: 0,
    });
  });

  it('initializes IN_PROGRESS row on openBook, navigates steps, completes lesson, and advances to next lesson', async () => {
    const store = usePlatformStore.getState();
    await store.openBook(sampleBook.bookId);

    let state = usePlatformStore.getState();
    expect(state.activeBookId).toBe(sampleBook.bookId);
    expect(state.activeLessonId).toBe('l-1');
    expect(state.lessonProgressMap[`${sampleBook.bookId}::l-1`]).toBeDefined();
    expect(state.lessonProgressMap[`${sampleBook.bookId}::l-1`].isCompleted).toBe(false);

    // Advance unlock to step 1 and then test navigating backward & forward cleanly
    await state.advanceUnlockedBlock(1);
    state = usePlatformStore.getState();
    expect(state.unlockedBlockIndex).toBe(1);
    expect(state.activeBlockIndex).toBe(1);

    state.setActiveBlockIndex(0);
    expect(usePlatformStore.getState().activeBlockIndex).toBe(0);

    // Complete lesson (blocks.length = 2)
    await state.advanceUnlockedBlock(2);
    state = usePlatformStore.getState();
    expect(state.lessonProgressMap[`${sampleBook.bookId}::l-1`].isCompleted).toBe(true);

    // Advance to next lesson
    const moved = await state.goToNextLesson();
    expect(moved).toBe(true);
    state = usePlatformStore.getState();
    expect(state.activeLessonId).toBe('l-2');
    expect(state.activeBlockIndex).toBe(0);
    expect(state.lessonProgressMap[`${sampleBook.bookId}::l-2`]).toBeDefined();

    // Delete book cleans state cleanly
    await state.deleteBook(sampleBook.bookId);
    state = usePlatformStore.getState();
    expect(state.cartridges[sampleBook.bookId]).toBeUndefined();
    expect(state.activeBookId).toBeNull();
  });
});
