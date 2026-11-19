import { describe, expect, it } from 'vitest';
import {
  classifyBlockStage,
  groupBlocksIntoStages,
  isPcOnlyBlock,
} from './engine/course/courseStages';
import { validateBookCartridge } from './types/cartridge.schema';
import type { BookCartridge, MicroLesson } from './types/cartridge.types';

describe('Course stages & multiplatform rules (Fases 3-4)', () => {
  const sampleLesson: MicroLesson = {
    lessonId: 'l1',
    order: 0,
    title: 'Listas en Python',
    estimatedMinutes: 8,
    learningObjectives: ['Crear listas mutables', 'Usar slicing seguro'],
    takeaways: ['Las listas son mutables y se indexan desde 0'],
    blocks: [
      { blockId: 'b1', type: 'PROSE', markdown: 'Introduccion a **listas**.' },
      {
        blockId: 'b2',
        type: 'INTERACTIVE_VISUALIZER',
        visualizerKind: 'MEMORY_MODEL',
        title: 'Heap',
        codeContext: 'xs = [1, 2]',
        payload: { memorySteps: [] },
      },
      {
        blockId: 'b3',
        type: 'SYNTAX_CLOZE',
        title: 'Completa el slice',
        prompt: 'Completa el slicing',
        codeTemplate: 'xs[___0___:___1___]',
        blanks: [
          { id: 's0', options: ['0', '1'], correctOption: '0' },
          { id: 's1', options: ['2', '3'], correctOption: '2' },
        ],
        explanation: 'El slice [0:2] toma los dos primeros elementos.',
      },
      {
        blockId: 'b4',
        type: 'CODE_LAB',
        title: 'Laboratorio de listas',
        instructions: 'Escribe una funcion',
        scaffoldMode: 'FREE_SANDBOX',
        starterCode: 'def f(): pass',
        unitTestCode: 'assert True',
      },
      {
        blockId: 'b5',
        type: 'QUICK_QUIZ',
        title: 'Test rapido',
        questions: [
          {
            id: 'q1',
            question: '¿Las listas son mutables?',
            options: ['Si', 'No'],
            correctIndex: 0,
            explanation: 'Si, permiten append y asignacion por indice.',
          },
        ],
      },
    ],
  };

  it('groups blocks into the 5 pedagogical stages preserving original block indices', () => {
    const groups = groupBlocksIntoStages(sampleLesson);
    expect(groups.map((g) => g.stage.id)).toEqual([
      'FOUNDATION',
      'MENTAL_MODEL',
      'QUICK_CHECK',
      'PRACTICE',
      'EVALUATION',
    ]);
    expect(groups[0].blockIndices).toEqual([0]);
    expect(groups[2].blockIndices).toEqual([2]);
    expect(groups[3].blockIndices).toEqual([3]);
    expect(groups[4].blockIndices).toEqual([4]);
  });

  it('marks CODE_LAB and AST_CHALLENGE as PC-only while keeping micro-learning blocks cross-platform', () => {
    expect(isPcOnlyBlock(sampleLesson.blocks[3])).toBe(true);
    expect(isPcOnlyBlock({ blockId: 'a1', type: 'AST_CHALLENGE', title: 'AST', instructions: 'i', starterCode: 'x=1', astConstraints: { requiredNodeTypes: ['Assign'], customAstMessage: 'ok' }, unitTestCode: '' })).toBe(true);
    expect(isPcOnlyBlock(sampleLesson.blocks[2])).toBe(false);
    expect(isPcOnlyBlock(sampleLesson.blocks[4])).toBe(false);
    expect(classifyBlockStage('PARSONS_PROBLEM')).toBe('PRACTICE');
  });

  it('validates v2.1 SYNTAX_CLOZE, QUICK_QUIZ, learningObjectives, and takeaways in cartridge schema', () => {
    const cartridge: BookCartridge = {
      schemaVersion: '2.0',
      bookId: 'test-course',
      metadata: {
        title: 'Test Course',
        subtitle: 'Sub',
        authors: ['Ada'],
        edition: '1st',
        difficulty: 'BEGINNER',
        coverAccentIcon: '📘',
      },
      themeDNA: {
        themeName: 'Dark',
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
          chapterId: 'ch1',
          number: 1,
          title: 'Modulo 1',
          summary: 'Resumen',
          microLessons: [sampleLesson],
        },
      ],
    };

    const res = validateBookCartridge(cartridge);
    expect(res.success).toBe(true);
  });
});
