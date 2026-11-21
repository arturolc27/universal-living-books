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
  formatBookSourceMarkdown,
  repairCartridgeForRuntime,
  sanitizeBlock,
  sanitizeGlossaryMap,
  sanitizeLesson,
} from './engine/compiler/lessonSanitizer';
import { buildCompilerSystemInstruction } from './engine/compiler/llmCompiler';
import {
  coerceChaptersIndex,
  deriveChaptersHeuristic,
  segmentBookByIndex,
  splitChapterIntoMicroLessons,
} from './engine/compiler/metadataTocExtractor';
import { analyzeSnippetStatic } from './engine/compiler/snippetStaticFilter';
import { selectActiveLesson, usePlatformStore } from './store/usePlatformStore';
import { validateBookCartridge } from './types/cartridge.schema';
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

  it('preserves full sourceBookMarkdown and sourcePageRange even when LLM already returned PROSE', () => {
    const cleanSource = [
      '--- page 12 ---',
      '1.2 Variables y Tipos en Python',
      'En Python no necesitas declarar tipos manualmente.',
      '>>> edad = 25',
      '>>> print(edad * 2)',
      '50',
      '--- page 13 ---',
      'Puedes reasignar una variable en tiempo de ejecución sin errores.',
    ].join('\n');

    const formatted = formatBookSourceMarkdown(cleanSource);
    expect(formatted.pageRange).toBe('Págs. 12–13');
    expect(formatted.markdown).toContain('```python');
    expect(formatted.markdown).toContain('edad = 25');

    const lesson = sanitizeLesson(
      {
        lessonId: 'sec-vars',
        title: 'Variables',
        blocks: [
          {
            blockId: 'p1',
            type: 'PROSE',
            markdown: 'Resumen corto generado por la IA.',
          },
          {
            blockId: 'f1',
            type: 'FLASHCARD',
            front: '¿Qué es una variable?',
            back: 'Una referencia a un valor en memoria.',
          },
        ],
      },
      {
        sectionTitle: 'Variables y Tipos',
        cleanText: cleanSource,
        order: 1,
      }
    );

    expect(lesson.sourcePageRange).toBe('Págs. 12–13');
    expect(lesson.sourceBookMarkdown).toContain('En Python no necesitas declarar tipos manualmente.');
    expect(lesson.sourceBookMarkdown).toContain('Puedes reasignar una variable en tiempo de ejecución');
    expect(lesson.sourceBookMarkdown).toContain('```python');

    const repaired = repairCartridgeForRuntime({
      bookId: 'book-with-source',
      metadata: { title: 'Python Libro Real', authors: ['Autor'] },
      chapters: [
        {
          number: 1,
          title: 'Fundamentos',
          microLessons: [lesson],
        },
      ],
    });

    expect(repaired).not.toBeNull();
    const repairedLesson = repaired!.chapters[0].microLessons[0];
    expect(repairedLesson.sourceBookMarkdown).toBe(lesson.sourceBookMarkdown);
    expect(repairedLesson.sourcePageRange).toBe('Págs. 12–13');
  });

  it('skips Table of Contents entries in segmentBookByIndex and slices the actual chapter body', () => {
    const rawBook = [
      '--- page 1 ---',
      'Table of Contents',
      'Chapter 1: Getting Started ....... 4',
      'Chapter 2: Functions and Scope ....... 8',
      '--- page 2 ---',
      'Preface',
      'Welcome to this practical programming guide designed for builders and engineers.',
      '--- page 3 ---',
      'How to use the exercises and interactive code blocks in every chapter of this book.',
      '--- page 4 ---',
      'Chapter 1: Getting Started',
      'This is the real body of Chapter 1 with detailed explanations and code examples.',
      'Python executes statements sequentially from top to bottom inside a script file.',
      'x = 42',
      'print(x)',
      '--- page 5 ---',
      'More real content from Chapter 1 explaining expressions, variables, and statements in depth so readers master the core syntax before moving forward.',
      '--- page 8 ---',
      'Chapter 2: Functions and Scope',
      'Functions encapsulate reusable logic and create local variable scopes isolated from globals.',
      'def greet(name: str) -> str:',
      '    return f"Hello, {name}"',
      'When you invoke greet("Ada"), Python allocates a fresh stack frame for local bindings and cleans it up upon return.',
    ].join('\n');

    const chaptersIndex = coerceChaptersIndex(
      [
        { chapterNumber: 1, title: 'Chapter 1: Getting Started', startPage: 4, endPage: 7 },
        { chapterNumber: 2, title: 'Chapter 2: Functions and Scope', startPage: 8, endPage: 10 },
      ],
      rawBook.length,
      10
    );

    const chunks = segmentBookByIndex(rawBook, chaptersIndex);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toContain('This is the real body of Chapter 1');
    expect(chunks[0].text).not.toContain('....... 4');
    expect(chunks[1].text).toContain('Functions encapsulate reusable logic');
    expect(chunks[1].text).not.toContain('....... 8');
  });

  it('supports BALANCED/DEEP/CONCISE instruction depth and preserves >9000-char sections on large chapters', () => {
    const balancedPrompt = buildCompilerSystemInstruction('es', 'BALANCED');
    const deepPrompt = buildCompilerSystemInstruction('es', 'DEEP');
    const concisePrompt = buildCompilerSystemInstruction('es', 'CONCISE');

    expect(balancedPrompt).toContain('350 a 650 palabras');
    expect(deepPrompt).toContain('600 a 950 palabras');
    expect(concisePrompt).toContain('180 a 280 palabras');

    const bigBody = Array.from(
      { length: 60 },
      (_, idx) => `Párrafo ${idx + 1}: ` + 'Python estructura módulos y clases limpias. '.repeat(22)
    ).join('\n\n');

    const chunks = splitChapterIntoMicroLessons(bigBody, 1, 'Capítulo Extenso', 6);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0].text.length).toBeGreaterThan(9000);
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

  it('selectActiveLesson preserves base sourceBookMarkdown & deepDive even when a stale cached translation lacks them', async () => {
    const bookWithSource: BookCartridge = {
      ...sampleBook,
      bookId: 'book-translation-merge',
      chapters: [
        {
          ...sampleBook.chapters[0],
          microLessons: [
            {
              ...sampleBook.chapters[0].microLessons[0],
              sourceBookMarkdown: '##### Página 1\n\nTexto real completo del libro original.',
              sourcePageRange: 'Pág. 1',
              deepDive: {
                internalMechanics: 'CPython reference counting',
                edgeCases: ['small int cache'],
                commonPitfalls: ['mutable default'],
                realWorldContrast: 'Use None sentinel.',
              },
            },
          ],
        },
      ],
    };

    usePlatformStore.setState({
      cartridges: { [bookWithSource.bookId]: bookWithSource },
      activeBookId: bookWithSource.bookId,
      activeChapterId: 'ch-1',
      activeLessonId: 'l-1',
      preferredLanguage: 'es',
      translatedLessons: {
        // Simula una traducción vieja guardada antes de existir sourceBookMarkdown y deepDive
        [`${bookWithSource.bookId}::l-1::es`]: {
          lessonId: 'l-1',
          order: 1,
          title: 'Lección 1 Traducida',
          estimatedMinutes: 5,
          blocks: [{ blockId: 'b1', type: 'PROSE', markdown: 'Resumen traducido.' }],
        },
      },
    });

    const snapshot = usePlatformStore.getState();
    const active = selectActiveLesson(snapshot);
    const activeSecondCall = selectActiveLesson(snapshot);
    // Crucial para Zustand/useSyncExternalStore: evita React Error #185 (infinite loop)
    expect(activeSecondCall).toBe(active);
    expect(active?.title).toBe('Lección 1 Traducida');
    expect(active?.sourceBookMarkdown).toContain('Texto real completo del libro original.');
    expect(active?.sourcePageRange).toBe('Pág. 1');
    expect(active?.deepDive?.internalMechanics).toBe('CPython reference counting');
  });

  it('normalizes invalid LLM heap statuses (LIVE/UNREACHABLE/DEAD/EXISTING) and malformed glossary entries so Zod validates cleanly', () => {
    const dirtyLesson = sanitizeLesson(
      {
        lessonId: 'ch2-sec1',
        title: 'Memoria en Python',
        blocks: [
          { blockId: 'p1', type: 'PROSE', markdown: 'Explicación de memoria.' },
          {
            blockId: 'v1',
            type: 'INTERACTIVE_VISUALIZER',
            visualizerKind: 'MEMORY_MODEL',
            title: 'Heap',
            codeContext: 'x = 1\nx = 2',
            payload: {
              memorySteps: [
                {
                  stepNumber: 1,
                  activeLine: 1,
                  stackFrames: [{ frameId: 'f0', name: '<module>', variables: { x: 'id_1' } }],
                  heap: [
                    { id: 'id_1', type: 'int', value: '1', status: 'LIVE' },
                    { id: 'id_2', type: 'int', value: '0', status: 'EXISTING' },
                  ],
                  explanation: 'Asignación inicial',
                },
                {
                  stepNumber: 2,
                  activeLine: 2,
                  stackFrames: [{ frameId: 'f0', name: '<module>', variables: { x: 'id_3' } }],
                  heap: [
                    { id: 'id_1', type: 'int', value: '1', status: 'UNREACHABLE' },
                    { id: 'id_2', type: 'int', value: '0', status: 'DEAD' },
                    { id: 'id_3', type: 'int', value: '2', status: 'CREATED' },
                  ],
                  explanation: 'Reasignación',
                },
              ],
            },
          },
        ],
      },
      { cleanText: '--- page 14 ---\nx = 1\nx = 2' }
    );

    const dirtyGlossary = sanitizeGlossaryMap(
      {
        ':': 'puntuacion invalida que debe descartarse',
        'sentencia de asignación': {
          term: 'sentencia de asignación',
          definition: 'Asocia un nombre a un objeto en memoria.',
          // falta chapterIntroduced
        },
        variable: 'Nombre que referencia un objeto en memoria.',
      },
      2
    );

    expect(dirtyGlossary[':']).toBeUndefined();
    expect(dirtyGlossary['sentencia de asignación']?.chapterIntroduced).toBe(2);
    expect(dirtyGlossary.variable?.definition).toContain('referencia un objeto');

    const repaired = repairCartridgeForRuntime({
      bookId: 'test-valid-cartridge',
      metadata: { title: 'Practical Programming', authors: ['Gries'] },
      glossary: {
        ':': 'bad',
        'sentencia de asignación': { term: 'sentencia de asignación', definition: 'Asocia nombre a valor.' },
      },
      chapters: [
        {
          chapterId: 'ch2',
          number: 2,
          title: 'Hello, Python',
          summary: '',
          microLessons: [dirtyLesson],
        },
      ],
    });

    expect(repaired).not.toBeNull();
    const validation = validateBookCartridge(repaired);
    expect(validation.success).toBe(true);
  });

  it('rejects inline cross-references and broken line fragments in deriveChaptersHeuristic', () => {
    const noisyFrontMatter = [
      'Preface',
      'Chapter 6 ake to the code?',
      'Chapter 11, Storing Data Using Other Collection Types, on page 209.',
      'Chapter 14, Object-Oriented Programming, on page 281.',
      'Chapter 15 testing and debugging), and how to plan your program (algorithms).',
      'Chapter 17, Handling Exceptions, on page 351):',
      'Chapter 1 What Is Programming?',
      'Chapter 2 Hello, Python',
      'Chapter 3 Designing and Using Functions',
    ].join('\n');

    const chapters = deriveChaptersHeuristic(noisyFrontMatter, 250_000);
    expect(chapters.map((c) => c.chapterNumber)).toEqual([1, 2, 3]);
    expect(chapters.map((c) => c.title)).toEqual([
      'What Is Programming?',
      'Hello, Python',
      'Designing and Using Functions',
    ]);
  });

  it('static snippet filter rejects unindented compound headers and orphan clauses before Pyodide', () => {
    const brokenDef = analyzeSnippetStatic('def convert_to_celsius(f):\nreturn (f - 32) * 5 / 9');
    expect(brokenDef.safe).toBe(false);
    expect(brokenDef.reason).toContain('IndentationError');

    const orphanElif = analyzeSnippetStatic('elif x > 0:\n    y = 1');
    expect(orphanElif.safe).toBe(false);

    const validDef = analyzeSnippetStatic('def double(n):\n    return n * 2\nx = double(4)');
    expect(validDef.safe).toBe(true);
  });
});
