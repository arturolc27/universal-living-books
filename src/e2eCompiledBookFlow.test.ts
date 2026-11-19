import { describe, expect, it } from 'vitest';
import { repairCartridgeForRuntime, sanitizeBlock } from './engine/compiler/lessonSanitizer';

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
    const cloze = sanitizeBlock({ blockId: 'c1', type: 'SYNTAX_CLOZE', title: 'Cloze', prompt: 'p', codeTemplate: 'x=___', blanks: [], explanation: 'e' }, 0);
    const quiz = sanitizeBlock({ blockId: 'q1', type: 'QUICK_QUIZ', title: 'Quiz', questions: [] }, 1);
    expect(cloze?.type).toBe('SYNTAX_CLOZE');
    expect(quiz?.type).toBe('QUICK_QUIZ');
  });
});
