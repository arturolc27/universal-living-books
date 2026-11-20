import type { BookCartridge, MicroLesson } from '../../types/cartridge.types';
import type { CompilationDetailLevel } from '../../types/compiler.types';
import { sanitizeLesson } from './lessonSanitizer';
import type { SectionChunk, TracedSnippet } from './semanticChunker';

export function buildCompilerSystemInstruction(
  targetLanguage: 'es' | 'en' = 'es',
  detailLevel: CompilationDetailLevel = 'BALANCED'
): string {
  const langDirective =
    targetLanguage === 'es'
      ? 'IDIOMA: Redacta titulos, prosa, explicaciones, preguntas y flashcards en ESPANOL claro (manteniendo codigo Python e identificadores intactos).'
      : 'LANGUAGE: Write titles, prose, explanations, prompts, and flashcards in the ORIGINAL ENGLISH of the source text (keep Python code intact).';

  const depthDirective =
    detailLevel === 'DEEP'
      ? 'PROFUNDIDAD (DETALLADA): Redacta de 3 a 4 bloques "PROSE" completos (600 a 950 palabras en total). Cubre cada concepto, caso borde, matiz tecnico, ejemplo comentado y regla practica presente en "cleanText" sin omitir detalles relevantes.'
      : detailLevel === 'CONCISE'
        ? 'PROFUNDIDAD (AGIL): Redacta de 1 a 2 bloques "PROSE" claros y directos (180 a 280 palabras en total) enfocados en las ideas esenciales y ejemplos clave.'
        : 'PROFUNDIDAD (EQUILIBRADA - RECOMENDADA): Redacta de 2 a 3 bloques "PROSE" pedagogicos bien estructurados (350 a 650 palabras en total). NO hagas un resumen superficial ni recortes conceptos clave del libro, pero tampoco copies relleno repetitivo: sintetiza con fidelidad las explicaciones, el "por que" tecnico, reglas, advertencias y ejemplos reales de "cleanText" usando subtitulos ##, listas claras y bloques ```python``` comentados.';

  return `Eres un Disenador Instruccional y Compilador EdTech de alta precision.
Tu mision es lograr el EQUILIBRIO PERFECTO entre el libro y el aprendizaje activo: destilando y ensenando con profundidad real todo lo valioso de esta seccion ("cleanText") mientras el estudiante tambien tiene acceso a los pasajes originales del libro.

${langDirective}
${depthDirective}

REGLAS ESTRICTAS DE FORMATO:
1. Emite EXCLUSIVAMENTE un objeto JSON valido (sin markdown ni texto fuera del JSON).
2. Usa SIEMPRE los nombres de campo exactos definidos abajo.
3. Incluye al menos 2 bloques "PROSE" (salvo modo agil) con explicacion clara, etiquetas "subgoals" (2-4 subobjetivos del ejemplo), ejemplos en \`\`\`python ... \`\`\`, callouts estrategicos (TIP, WARNING, ERROR_TRAP, BOOK_NOTE) y terminos en [[termino]].
4. Incluye de 3 a 5 ejercicios interactivos variados (OUTPUT_PREDICTION, INTERACTIVE_VISUALIZER, PARSONS_PROBLEM con al menos 1 isDistractor:true, BUG_AUTOPSY cuando haya errores/trampas, SYNTAX_CLOZE, AST_CHALLENGE o CODE_LAB con hiddenTestCode y progressiveHints, FLASHCARD con sourceBlockId apuntando a un reto previo) derivados directamente de "cleanText".
5. Usa "linkedFlashcardId" en los retos para enlazarlos a la FLASHCARD de la leccion, "conceptTags" (1-2 etiquetas) y "gatesNextBlock": true en OUTPUT_PREDICTION y PARSONS_PROBLEM.
6. Usa "sectionTitle" recibido como titulo real de la leccion (o traduccion fiel al idioma elegido).

CONTRATO EXACTO DE CAMPOS POR TIPO DE BLOQUE:
- PROSE:
  { "blockId": "b1", "type": "PROSE", "markdown": "Texto explicativo en Markdown con \`\`\`python ... \`\`\` y [[termino]]", "subgoals": [{ "label": "Inicializar acumulador" }], "callout": { "kind": "TIP|WARNING|BOOK_NOTE|ERROR_TRAP", "title": "...", "body": "..." } }
- OUTPUT_PREDICTION:
  { "blockId": "b2", "type": "OUTPUT_PREDICTION", "gatesNextBlock": true, "conceptTags": ["mutabilidad"], "linkedFlashcardId": "card-1", "prompt": "...", "codeSnippet": "x = 5\\ny = x + 2\\nprint(y)", "options": ["7", "5", "Error", "5 2"], "correctOptionIndex": 0, "expectedReturnType": "int|float|str|bool|NoneType|list|dict|tuple|set|Error", "explanation": "..." }
- INTERACTIVE_VISUALIZER (usar precomputedMemoryTraces cuando existan):
  { "blockId": "b3", "type": "INTERACTIVE_VISUALIZER", "visualizerKind": "MEMORY_MODEL", "title": "...", "codeContext": "x = 10\\ny = x", "payload": { "memorySteps": [{ "stepIndex": 0, "lineNumber": 1, "explanation": "...", "frames": [{ "name": "<module>", "isCurrent": true, "variables": { "x": "id1" } }], "heap": [{ "id": "id1", "type": "int", "value": "10", "status": "NEW" }] }] } }
- BUG_AUTOPSY (cuando el tema tenga errores comunes):
  { "blockId": "b3b", "type": "BUG_AUTOPSY", "title": "...", "prompt": "...", "codeSnippet": "...", "tracebackText": "...", "culpritLineNumber": 2, "options": ["Causa real", "Distractor 1"], "correctOptionIndex": 0, "explanation": "...", "linkedFlashcardId": "card-1" }
- SYNTAX_CLOZE (ideal para movil):
  { "blockId": "b4", "type": "SYNTAX_CLOZE", "title": "...", "prompt": "...", "codeTemplate": "def saludar(___0___):\\n    ___1___ f'Hola {nombre}'", "blanks": [{ "id": "b0", "options": ["nombre", "'nombre'"], "correctOption": "nombre" }, { "id": "b1", "options": ["return", "print"], "correctOption": "return" }], "explanation": "...", "linkedFlashcardId": "card-1" }
- PARSONS_PROBLEM (SIEMPRE incluir >= 1 distractor con isDistractor:true y correctOrder:-1):
  { "blockId": "b5", "type": "PARSONS_PROBLEM", "gatesNextBlock": true, "prompt": "...", "blocks": [{ "id": "p1", "code": "def f(x):", "correctOrder": 0, "correctIndent": 0, "isDistractor": false }, { "id": "p2", "code": "return x * 2", "correctOrder": 1, "correctIndent": 1, "isDistractor": false }, { "id": "p3", "code": "print(x * 2)", "correctOrder": -1, "correctIndent": 1, "isDistractor": true }], "linkedFlashcardId": "card-1" }
- CODE_LAB:
  { "blockId": "b6", "type": "CODE_LAB", "title": "...", "instructions": "...", "scaffoldMode": "FREE_SANDBOX", "labPhase": "MODIFY|FADED|MAKE", "starterCode": "def resolver(n):\\n    pass", "unitTestCode": "assert resolver(3) == 6", "hiddenTestCode": "assert resolver(0) == 0", "progressiveHints": ["Pista conceptual", "Pista estructural"], "linkedFlashcardId": "card-1" }
- AST_CHALLENGE:
  { "blockId": "b6b", "type": "AST_CHALLENGE", "title": "...", "instructions": "...", "starterCode": "...", "astConstraints": { "requiredNodeTypes": ["ListComp"], "customAstMessage": "Usa una comprension de lista." }, "unitTestCode": "...", "hiddenTestCode": "...", "linkedFlashcardId": "card-1" }
- QUICK_QUIZ:
  { "blockId": "b7", "type": "QUICK_QUIZ", "title": "...", "questions": [{ "id": "q1", "question": "...", "options": ["A", "B", "C"], "correctIndex": 0, "explanation": "..." }] }
- FLASHCARD (OBLIGATORIO frontMarkdown, backMarkdown y sourceBlockId apuntando al blockId de un reto previo):
  { "blockId": "b8", "type": "FLASHCARD", "cardId": "card-1", "sourceBlockId": "b2", "frontMarkdown": "Pregunta conceptual", "backMarkdown": "Respuesta clara y concisa", "codeExample": "x = 1", "tags": ["python"] }

CAMPOS RAIZ OBLIGATORIOS DE MicroLesson:
{ "lessonId": "...", "order": 1, "title": "...", "estimatedMinutes": 8, "learningObjectives": ["Objetivo 1", "Objetivo 2"], "takeaways": ["Idea clave 1"], "blocks": [...], "extractedGlossary": { "termino": { "term": "termino", "definition": "...", "chapterIntroduced": 1 } } }`;
}

export const COMPILER_SYSTEM_INSTRUCTION = buildCompilerSystemInstruction('es', 'BALANCED');

export const MICROLESSON_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    lessonId: { type: 'string' },
    order: { type: 'integer' },
    title: { type: 'string' },
    estimatedMinutes: { type: 'number' },
    learningObjectives: { type: 'array', items: { type: 'string' } },
    takeaways: { type: 'array', items: { type: 'string' } },
    blocks: { type: 'array', items: { type: 'object' } },
    extractedGlossary: { type: 'object' },
  },
  required: ['lessonId', 'order', 'title', 'estimatedMinutes', 'blocks'],
};

export interface CompileChunkInput {
  chunk: SectionChunk;
  traces: TracedSnippet[];
  targetLanguage?: 'es' | 'en';
}

export interface CompileOptions {
  provider: 'openrouter' | 'gemini';
  apiKey: string;
  model: string;
  targetLanguage?: 'es' | 'en';
  onProgress?: (message: string) => void;
}

function buildPrompt(input: CompileChunkInput): string {
  const relevantTraces = input.traces.filter((t) => t.sectionId === input.chunk.sectionId);
  return JSON.stringify({
    sectionId: input.chunk.sectionId,
    chapterNumber: input.chunk.chapterNumber,
    chapterTitle: input.chunk.chapterTitle,
    sectionTitle: input.chunk.sectionTitle,
    targetLanguage: input.targetLanguage ?? 'es',
    cleanText: input.chunk.text,
    precomputedMemoryTraces: relevantTraces,
  });
}

async function compileWithGemini(input: CompileChunkInput, options: CompileOptions): Promise<MicroLesson> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`;
  const sysPrompt = buildCompilerSystemInstruction(options.targetLanguage ?? 'es');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysPrompt }] },
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

  return sanitizeLesson(JSON.parse(text), {
    sectionTitle: input.chunk.sectionTitle,
    cleanText: input.chunk.text,
  });
}

async function compileWithOpenRouter(input: CompileChunkInput, options: CompileOptions): Promise<MicroLesson> {
  const sysPrompt = buildCompilerSystemInstruction(options.targetLanguage ?? 'es');
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
        { role: 'system', content: sysPrompt },
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

  return sanitizeLesson(JSON.parse(text), {
    sectionTitle: input.chunk.sectionTitle,
    cleanText: input.chunk.text,
  });
}

async function compileChunk(input: CompileChunkInput, options: CompileOptions): Promise<MicroLesson> {
  if (options.provider === 'openrouter') {
    return compileWithOpenRouter(input, options);
  }
  return compileWithGemini(input, options);
}

/**
 * Traducción económica bajo demanda (On-Demand Bilingual Cache):
 * Compila el libro una sola vez (1x costo) y traduce únicamente la lección activa
 * usando el modelo más económico, preservando exactamente todos los IDs y el código Python.
 */
export async function translateMicroLessonOnDemand(
  lesson: MicroLesson,
  targetLang: 'es' | 'en',
  credentials: {
    provider: 'openrouter' | 'gemini';
    openrouterApiKey: string;
    geminiApiKey: string;
    model?: string;
  }
): Promise<MicroLesson> {
  const langLabel = targetLang === 'es' ? 'Spanish (Español)' : 'English';
  const systemPrompt = `You are a precise EdTech JSON translator. Translate human-readable text fields (title, learningObjectives, takeaways, markdown, callout.title, callout.body, prompt, instructions, explanation, question, options when prose, frontMarkdown, backMarkdown) into ${langLabel}.
STRICT RULES:
- Return ONLY valid JSON matching the exact MicroLesson structure.
- NEVER modify blockId, lessonId, cardId, type, visualizerKind, codeSnippet, starterCode, unitTestCode, codeContext, codeTemplate, codeExample, correctOptionIndex, correctIndex, or Python code inside \`\`\`python\`\`\` blocks.
- Keep [[glossary]] bracket markers intact.`;

  const userJson = JSON.stringify(lesson);
  let rawOut = '';

  if (credentials.provider === 'gemini' && credentials.geminiApiKey) {
    const model = credentials.model || 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credentials.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userJson }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    if (!res.ok) throw new Error(`Error al traducir (${res.status})`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    rawOut = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } else if (credentials.openrouterApiKey) {
    const model = credentials.model || 'google/gemini-2.5-flash-lite';
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.openrouterApiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://living-books.app',
        'X-Title': 'Universal Living Book Engine',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userJson },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });
    if (!res.ok) throw new Error(`Error al traducir (${res.status})`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawOut = data.choices?.[0]?.message?.content ?? '';
  } else {
    throw new Error('Configura una API Key en Ajustes para traducir esta lección bajo demanda.');
  }

  const cleaned = rawOut.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned) as unknown;
  const translated = sanitizeLesson(parsed, { sectionTitle: lesson.title, order: lesson.order });
  if (lesson.sourceBookMarkdown && !translated.sourceBookMarkdown) {
    translated.sourceBookMarkdown = lesson.sourceBookMarkdown;
  }
  if (lesson.sourcePageRange && !translated.sourcePageRange) {
    translated.sourcePageRange = lesson.sourcePageRange;
  }
  return translated;
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
    const lesson = await compileChunk(
      { chunk, traces, targetLanguage: options.targetLanguage ?? 'es' },
      options
    );

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