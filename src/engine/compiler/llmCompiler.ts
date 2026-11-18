import type { BookCartridge, MicroLesson } from '../../types/cartridge.types';
import type { SectionChunk, TracedSnippet } from './semanticChunker';

export const COMPILER_SYSTEM_INSTRUCTION = `Eres un Compilador Pedagogico EdTech de alta precision.
Transforma una subseccion cruda de un libro tecnico de Python (junto con sus
trazas de memoria pre-calculadas) en un objeto JSON valido que cumpla
estrictamente con la interfaz MicroLesson del Motor Universal de Libros Vivos.

REGLAS ZERO-WASTE:
1. Emite EXCLUSIVAMENTE JSON valido. Sin saludos ni markdown.
2. Cero alucinacion de memoria: referencia los IDs de precomputedMemoryTraces.
3. Densidad editorial: bloques PROSE de 60 a 110 palabras.

Genera una secuencia de blocks: PROSE con glosario [[termino]],
OUTPUT_PREDICTION con gatesNextBlock, INTERACTIVE_VISUALIZER contextual,
CODE_LAB o AST_CHALLENGE, PARSONS_PROBLEM y FLASHCARD.

Cada block DEBE tener un blockId unico y un campo type valido entre:
PROSE, GPU_ANIMATION, INTERACTIVE_VISUALIZER, CODE_LAB, AST_CHALLENGE,
PARSONS_PROBLEM, OUTPUT_PREDICTION, BUG_AUTOPSY, FLASHCARD, YOUTUBE_REF.`;

export const MICROLESSON_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    lessonId: { type: 'string' },
    order: { type: 'integer' },
    title: { type: 'string' },
    estimatedMinutes: { type: 'number' },
    blocks: { type: 'array', items: { type: 'object' } },
    extractedGlossary: { type: 'object' },
  },
  required: ['lessonId', 'order', 'title', 'estimatedMinutes', 'blocks'],
};

export interface CompileChunkInput {
  chunk: SectionChunk;
  traces: TracedSnippet[];
}

export interface CompileOptions {
  provider: 'openrouter' | 'gemini';
  apiKey: string;
  model: string;
  onProgress?: (message: string) => void;
}

function buildPrompt(input: CompileChunkInput): string {
  const relevantTraces = input.traces.filter((t) => t.sectionId === input.chunk.sectionId);
  return JSON.stringify({
    sectionId: input.chunk.sectionId,
    chapterNumber: input.chunk.chapterNumber,
    chapterTitle: input.chunk.chapterTitle,
    sectionTitle: input.chunk.sectionTitle,
    cleanText: input.chunk.text,
    precomputedMemoryTraces: relevantTraces,
  });
}

async function compileWithGemini(input: CompileChunkInput, options: CompileOptions): Promise<MicroLesson> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: COMPILER_SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: MICROLESSON_RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('La respuesta del LLM no contiene contenido.');

  return JSON.parse(text) as MicroLesson;
}

async function compileWithOpenRouter(input: CompileChunkInput, options: CompileOptions): Promise<MicroLesson> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://living-books.app',
      'X-Title': 'Universal Living Book Engine',
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: 'system', content: COMPILER_SYSTEM_INSTRUCTION },
        { role: 'user', content: buildPrompt(input) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('La respuesta del LLM no contiene contenido.');

  return JSON.parse(text) as MicroLesson;
}

async function compileChunk(input: CompileChunkInput, options: CompileOptions): Promise<MicroLesson> {
  if (options.provider === 'openrouter') {
    return compileWithOpenRouter(input, options);
  }
  return compileWithGemini(input, options);
}

export interface CompileBookMeta {
  bookId: string;
  metadata: BookCartridge['metadata'];
  themeDNA: BookCartridge['themeDNA'];
  runtimeRequirements: BookCartridge['runtimeRequirements'];
}

export async function compileCartridge(
  chunks: SectionChunk[],
  traces: TracedSnippet[],
  meta: CompileBookMeta,
  options: CompileOptions
): Promise<BookCartridge> {
  const chapters = new Map<number, BookCartridge['chapters'][number]>();

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    options.onProgress?.(`Compilando seccion ${i + 1} de ${chunks.length}: ${chunk.sectionTitle}`);
    const lesson = await compileChunk({ chunk, traces }, options);

    const chapter = chapters.get(chunk.chapterNumber) ?? {
      chapterId: `ch${chunk.chapterNumber}`,
      number: chunk.chapterNumber,
      title: chunk.chapterTitle,
      summary: '',
      microLessons: [],
    };
    chapter.microLessons.push(lesson);
    chapters.set(chunk.chapterNumber, chapter);
  }

  const glossary: BookCartridge['glossary'] = {};
  for (const chapter of chapters.values()) {
    for (const lesson of chapter.microLessons) {
      const extracted = (lesson as unknown as { extractedGlossary?: Record<string, unknown> }).extractedGlossary;
      if (extracted) {
        for (const [key, value] of Object.entries(extracted)) {
          if (!glossary[key]) {
            glossary[key] = value as BookCartridge['glossary'][string];
          }
        }
      }
    }
  }

  return {
    schemaVersion: '2.0',
    bookId: meta.bookId,
    metadata: meta.metadata,
    themeDNA: meta.themeDNA,
    runtimeRequirements: meta.runtimeRequirements,
    glossary,
    achievements: [],
    chapters: [...chapters.values()].sort((a, b) => a.number - b.number),
  };
}