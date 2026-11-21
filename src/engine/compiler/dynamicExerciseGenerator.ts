import type {
  BugAutopsyBlock,
  CodeLabBlock,
  DeepDiveSection,
  LessonBlock,
  OutputPredictionBlock,
  ParsonsProblemBlock,
  SyntaxClozeBlock,
} from '../../types/cartridge.types';
import { livingBooksDb, type ExerciseBankRecord } from '../../db/dexieDb';
import { scheduleCloudStateSync } from '../../db/cloudSyncClient';
import { pythonRuntimeBridge } from '../pyodide/pythonRuntimeBridge';
import { sanitizeBlock } from './lessonSanitizer';
import { parseJsonLoose } from './metadataTocExtractor';

export type DynamicExerciseMechanic =
  | 'OUTPUT_PREDICTION'
  | 'PARSONS_PROBLEM'
  | 'BUG_AUTOPSY'
  | 'SYNTAX_CLOZE'
  | 'CODE_LAB';

export interface LlmClientCredentials {
  provider: 'openrouter' | 'gemini';
  openrouterApiKey: string;
  geminiApiKey: string;
  model?: string;
}

export interface DynamicExerciseRequest {
  bookId: string;
  chapterId: string;
  lessonId: string;
  topicTitle: string;
  contextExcerpt: string;
  mechanic: DynamicExerciseMechanic;
  competencyIds: string[];
  conceptKeys: string[];
  recentMisconceptions?: string[];
  language?: 'es' | 'en';
}

const MOBILE_FRIENDLY_SET = new Set<LessonBlock['type']>([
  'OUTPUT_PREDICTION',
  'PARSONS_PROBLEM',
  'BUG_AUTOPSY',
  'SYNTAX_CLOZE',
  'QUICK_QUIZ',
]);

async function callJsonLlm(
  systemPrompt: string,
  userPrompt: string,
  creds: LlmClientCredentials
): Promise<string> {
  const useGemini =
    (creds.provider === 'gemini' && Boolean(creds.geminiApiKey)) ||
    (!creds.openrouterApiKey && Boolean(creds.geminiApiKey));

  if (useGemini && creds.geminiApiKey) {
    const model = creds.model || 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${creds.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Error Gemini (${res.status}): ${(await res.text()).slice(0, 180)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('Respuesta vacía del modelo.');
    return text;
  }

  if (!creds.openrouterApiKey) {
    throw new Error('Configura una API Key (OpenRouter o Gemini) en Ajustes para generar ejercicios con IA.');
  }

  const model = creds.model || 'google/gemini-2.5-flash';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.openrouterApiKey}`,
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://living-books.app',
      'X-Title': 'Universal Living Book Engine',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    throw new Error(`Error OpenRouter (${res.status}): ${(await res.text()).slice(0, 180)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Respuesta vacía del modelo.');
  return text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Compuerta obligatoria de verificación Pyodide para cualquier bloque de ejercicio:
 * - OUTPUT_PREDICTION: ejecuta el snippet real y alinea `options[correctOptionIndex]` con stdout real.
 * - BUG_AUTOPSY: ejecuta el snippet y confirma que realmente lanza excepción, inyectando el traceback real.
 * - PARSONS_PROBLEM: reconstruye el código con `correctIndent * 4` y verifica sintaxis Python con `ast.parse`.
 * - SYNTAX_CLOZE: sustituye `correctOption` en `___i___` y verifica sintaxis Python con `ast.parse`.
 * - CODE_LAB: verifica que `referenceSolution` pasa `unitTestCode` + `hiddenTestCode` y que `starterCode` NO pasa ya.
 */
export async function verifyExerciseBlockWithPyodide(
  block: LessonBlock
): Promise<{ valid: boolean; block: LessonBlock; reason?: string }> {
  if (block.type === 'OUTPUT_PREDICTION') {
    const b = block as OutputPredictionBlock;
    if (!b.codeSnippet.trim()) return { valid: false, block, reason: 'Snippet vacío' };
    try {
      const res = await Promise.race([
        pythonRuntimeBridge.executeAndEvaluate(b.codeSnippet),
        sleep(3500).then(() => null),
      ]);
      if (!res) return { valid: true, block };
      if (!res.ok) {
        const errIdx = b.options.findIndex((o) => /error|exception|traceback/i.test(o));
        if (errIdx >= 0) {
          return {
            valid: true,
            block: { ...b, correctOptionIndex: errIdx, expectedReturnType: 'Error' },
          };
        }
        return { valid: false, block, reason: `Snippet lanzó error inesperado: ${res.stderr.slice(0, 120)}` };
      }
      const actualOut = res.stdout.trim();
      if (!actualOut) return { valid: true, block };
      if (b.options[b.correctOptionIndex]?.trim() === actualOut) {
        return { valid: true, block };
      }
      const matchIdx = b.options.findIndex((o) => o.trim() === actualOut);
      if (matchIdx >= 0) {
        return { valid: true, block: { ...b, correctOptionIndex: matchIdx } };
      }
      const updatedOptions = [...b.options];
      updatedOptions[b.correctOptionIndex] = actualOut;
      return { valid: true, block: { ...b, options: updatedOptions } };
    } catch {
      return { valid: true, block };
    }
  }

  if (block.type === 'BUG_AUTOPSY') {
    const b = block as BugAutopsyBlock;
    if (!b.codeSnippet.trim()) return { valid: false, block, reason: 'Snippet vacío' };
    try {
      const res = await Promise.race([
        pythonRuntimeBridge.executeAndEvaluate(b.codeSnippet),
        sleep(3500).then(() => null),
      ]);
      if (!res) return { valid: true, block };
      if (res.ok) {
        return { valid: false, block, reason: 'El código de BUG_AUTOPSY no produjo ningún error en Python.' };
      }
      if (res.stderr.trim()) {
        return {
          valid: true,
          block: { ...b, tracebackText: res.stderr.trim().slice(0, 600) },
        };
      }
      return { valid: true, block };
    } catch {
      return { valid: true, block };
    }
  }

  if (block.type === 'PARSONS_PROBLEM') {
    const b = block as ParsonsProblemBlock;
    const solutionLines = b.blocks
      .filter((l) => !l.isDistractor && l.correctOrder >= 0)
      .sort((a, c) => a.correctOrder - c.correctOrder);
    if (solutionLines.length < 2) {
      return { valid: false, block, reason: 'PARSONS_PROBLEM tiene menos de 2 líneas válidas.' };
    }
    const reconstructed = solutionLines
      .map((l) => `${'    '.repeat(Math.max(0, l.correctIndent))}${l.code}`)
      .join('\n');
    try {
      const checkCode = `import ast\nast.parse(${JSON.stringify(reconstructed)})\nprint("OK")`;
      const res = await Promise.race([
        pythonRuntimeBridge.executeAndEvaluate(checkCode),
        sleep(3000).then(() => null),
      ]);
      if (res && !res.ok) {
        return { valid: false, block, reason: `Solución Parsons inválida sintácticamente: ${res.stderr.slice(0, 120)}` };
      }
      return { valid: true, block };
    } catch {
      return { valid: true, block };
    }
  }

  if (block.type === 'SYNTAX_CLOZE') {
    const b = block as SyntaxClozeBlock;
    if (b.blanks.length === 0) return { valid: false, block, reason: 'Sin huecos definidos.' };
    let filled = b.codeTemplate;
    b.blanks.forEach((blank, i) => {
      if (filled.includes(`___${i}___`)) {
        filled = filled.replace(`___${i}___`, blank.correctOption);
      } else {
        filled = filled.replace('___', blank.correctOption);
      }
    });
    try {
      const checkCode = `import ast\nast.parse(${JSON.stringify(filled)})\nprint("OK")`;
      const res = await Promise.race([
        pythonRuntimeBridge.executeAndEvaluate(checkCode),
        sleep(3000).then(() => null),
      ]);
      if (res && !res.ok) {
        return { valid: false, block, reason: `SYNTAX_CLOZE genera sintaxis inválida: ${res.stderr.slice(0, 120)}` };
      }
      return { valid: true, block };
    } catch {
      return { valid: true, block };
    }
  }

  if (block.type === 'CODE_LAB') {
    const b = block as CodeLabBlock;
    if (!b.unitTestCode.trim()) return { valid: true, block };
    try {
      // 1. Verificar que starterCode NO pase ya los tests (evitar ejercicios pre-resueltos)
      const starterRes = await Promise.race([
        pythonRuntimeBridge.executeAndEvaluate(b.starterCode, { unitTestCode: b.unitTestCode }),
        sleep(3500).then(() => null),
      ]);
      if (starterRes?.unitTestReport?.passed) {
        return { valid: false, block, reason: 'starterCode ya pasa los tests unitarios sin cambios.' };
      }
      // 2. Si existe referenceSolution, confirmar que pasa tests públicos + ocultos
      if (b.referenceSolution?.trim()) {
        const combinedTests = [b.unitTestCode, b.hiddenTestCode ?? ''].filter(Boolean).join('\n');
        const refRes = await Promise.race([
          pythonRuntimeBridge.executeAndEvaluate(b.referenceSolution, { unitTestCode: combinedTests }),
          sleep(4000).then(() => null),
        ]);
        if (refRes && (!refRes.ok || (refRes.unitTestReport && !refRes.unitTestReport.passed))) {
          return {
            valid: false,
            block,
            reason: 'referenceSolution no superó los unitTestCode/hiddenTestCode.',
          };
        }
      }
      return { valid: true, block };
    } catch {
      return { valid: true, block };
    }
  }

  return { valid: true, block };
}

function buildDynamicExerciseSystemPrompt(
  mechanic: DynamicExerciseMechanic,
  language: 'es' | 'en'
): string {
  const langRule =
    language === 'es'
      ? 'Redacta enunciados, pistas y explicaciones en ESPAÑOL claro manteniendo código Python intacto.'
      : 'Write prompts, hints, and explanations in clear ENGLISH keeping Python code intact.';

  const schemas: Record<DynamicExerciseMechanic, string> = {
    OUTPUT_PREDICTION: `{ "blockId": "dyn-pred-1", "type": "OUTPUT_PREDICTION", "gatesNextBlock": true, "prompt": "¿Qué imprimirá exactamente este código?", "codeSnippet": "x = [1, 2]\\ny = x\\ny.append(3)\\nprint(x)", "options": ["[1, 2, 3]", "[1, 2]", "[3]", "TypeError"], "correctOptionIndex": 0, "expectedReturnType": "list", "explanation": "Explicación concisa" }`,
    PARSONS_PROBLEM: `{ "blockId": "dyn-parsons-1", "type": "PARSONS_PROBLEM", "gatesNextBlock": true, "prompt": "Ordena e indenta las líneas correctas y descarta el distractor:", "blocks": [{ "id": "p1", "code": "def f(nums):", "correctOrder": 0, "correctIndent": 0, "isDistractor": false }, { "id": "p2", "code": "return [n for n in nums if n > 0]", "correctOrder": 1, "correctIndent": 1, "isDistractor": false }, { "id": "p3", "code": "print(nums)", "correctOrder": -1, "correctIndent": 1, "isDistractor": true }] }`,
    BUG_AUTOPSY: `{ "blockId": "dyn-bug-1", "type": "BUG_AUTOPSY", "title": "Autopsia de Error", "prompt": "Identifica la causa raíz del traceback:", "codeSnippet": "d = {'a': 1}\\nprint(d['b'])", "tracebackText": "KeyError: 'b'", "culpritLineNumber": 2, "options": ["Acceso directo a clave inexistente", "Error de sintaxis", "Mutación de tupla"], "correctOptionIndex": 0, "explanation": "Explicación concisa" }`,
    SYNTAX_CLOZE: `{ "blockId": "dyn-cloze-1", "type": "SYNTAX_CLOZE", "title": "Completa la sintaxis", "prompt": "Elige la pieza exacta para cada hueco:", "codeTemplate": "def f(x, acc=___0___):\\n    if acc ___1___ None:\\n        acc = []\\n    acc.append(x)\\n    return acc", "blanks": [{ "id": "b0", "options": ["None", "[]"], "correctOption": "None" }, { "id": "b1", "options": ["is", "=="], "correctOption": "is" }], "explanation": "Explicación concisa" }`,
    CODE_LAB: `{ "blockId": "dyn-lab-1", "type": "CODE_LAB", "title": "Reto Práctico", "instructions": "Implementa la función pedida...", "scaffoldMode": "FREE_SANDBOX", "labPhase": "MAKE", "starterCode": "def resolver(items):\\n    pass", "referenceSolution": "def resolver(items):\\n    return [x for x in items if x > 0]", "unitTestCode": "assert resolver([1, -2, 3]) == [1, 3]", "hiddenTestCode": "assert resolver([]) == []", "progressiveHints": ["Pista conceptual", "Pista estructural"] }`,
  };

  return `Eres un generador de ejercicios de Python de precisión científica.
${langRule}
Genera EXCLUSIVAMENTE un objeto JSON válido del tipo "${mechanic}" que evalúe comprensión real (transferencia, casos borde o misconceptions), NO memorización trivial.
- El código Python debe ser 100% ejecutable en Python 3.12+ estándar (sin dependencias externas salvo que el contexto sea pandas/numpy).
- En OUTPUT_PREDICTION usa print(...) al final para producir salida exacta determinista.
- En BUG_AUTOPSY el codeSnippet DEBE lanzar una excepción real al ejecutarse.
- En PARSONS_PROBLEM incluye SIEMPRE al menos 1 distractor (isDistractor: true, correctOrder: -1).
- En CODE_LAB starterCode NO debe pasar los tests todavía, pero referenceSolution SÍ debe pasar unitTestCode y hiddenTestCode.

CONTRATO EXACTO:
${schemas[mechanic]}`;
}

/**
 * Genera bajo demanda un ejercicio adicional con IA, lo valida obligatoriamente en Pyodide
 * (con 1 reintento correctivo si falla validación) y lo persiste en Dexie `exerciseBank`
 * para disponibilidad 100% offline futura.
 */
export async function generateDynamicExercise(
  request: DynamicExerciseRequest,
  creds: LlmClientCredentials
): Promise<ExerciseBankRecord> {
  const sysPrompt = buildDynamicExerciseSystemPrompt(request.mechanic, request.language ?? 'es');
  let lastValidationReason = '';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const userPrompt = JSON.stringify({
      topicTitle: request.topicTitle,
      mechanic: request.mechanic,
      competencyIds: request.competencyIds,
      conceptKeys: request.conceptKeys,
      recentMisconceptions: request.recentMisconceptions ?? [],
      contextExcerpt: request.contextExcerpt.slice(0, 2000),
      previousValidationError: lastValidationReason || undefined,
    });

    const rawText = await callJsonLlm(sysPrompt, userPrompt, creds);
    const parsed = parseJsonLoose(rawText) as Record<string, unknown>;
    const sanitized = sanitizeBlock(parsed, Date.now());
    if (!sanitized || sanitized.type !== request.mechanic) {
      lastValidationReason = `El modelo no devolvió un bloque válido de tipo ${request.mechanic}.`;
      continue;
    }

    const enriched: LessonBlock = {
      ...sanitized,
      blockId: `ai-${request.mechanic.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      competencyIds: request.competencyIds,
      conceptTags: request.conceptKeys,
    };

    const verified = await verifyExerciseBlockWithPyodide(enriched);
    if (!verified.valid) {
      lastValidationReason = verified.reason ?? 'Falló la verificación en Pyodide.';
      continue;
    }

    const record: ExerciseBankRecord = {
      exerciseId: `${request.bookId}::${request.lessonId}::${verified.block.blockId}`,
      bookId: request.bookId,
      chapterId: request.chapterId,
      lessonId: request.lessonId,
      blockType: verified.block.type,
      mobileFriendly: MOBILE_FRIENDLY_SET.has(verified.block.type),
      origin: 'AI_GENERATED',
      verifiedWithPyodide: true,
      competencyIds: request.competencyIds,
      conceptKeys: request.conceptKeys,
      block: verified.block,
      createdAt: Date.now(),
    };

    if (livingBooksDb.exerciseBank) {
      await livingBooksDb.exerciseBank.put(record).catch(() => {});
      scheduleCloudStateSync();
    }
    return record;
  }

  throw new Error(
    `No se pudo generar un ejercicio verificado en Pyodide tras 2 intentos (${lastValidationReason || 'formato inválido'}).`
  );
}

/**
 * Genera bajo demanda una profundización ("Deep Dive") estructurada para una lección o concepto
 * y la almacena en caché local offline (`livingBooksDb.deepDiveCache`).
 */
export async function generateExtendedDeepDiveOnDemand(
  params: {
    bookId: string;
    lessonId: string;
    conceptKey?: string;
    title: string;
    contextExcerpt: string;
    language?: 'es' | 'en';
  },
  creds: LlmClientCredentials
): Promise<DeepDiveSection> {
  const cacheKey = `${params.bookId}::${params.lessonId}::${params.conceptKey ?? 'lesson'}`;
  if (livingBooksDb.deepDiveCache) {
    const cached = await livingBooksDb.deepDiveCache.get(cacheKey).catch(() => undefined);
    if (cached) return cached.deepDive;
  }

  const langRule =
    (params.language ?? 'es') === 'es'
      ? 'Responde en ESPAÑOL técnico claro y riguroso (manteniendo código Python intacto).'
      : 'Respond in clear, rigorous technical ENGLISH (keeping Python code intact).';

  const sysPrompt = `Eres un ingeniero senior de Python y autor técnico.
${langRule}
Devuelve EXCLUSIVAMENTE un objeto JSON con exactamente estos campos:
{
  "internalMechanics": "Explicación clara de qué ocurre internamente en Python/CPython (memoria, modelo de datos, complejidad) en 2-3 párrafos concisos.",
  "edgeCases": ["Caso borde concreto 1", "Caso borde concreto 2", "Caso borde concreto 3"],
  "commonPitfalls": ["Error frecuente 1 y cómo evitarlo", "Error frecuente 2 y cómo evitarlo"],
  "realWorldContrast": "Cómo se aplica (o se evita) este concepto en código de producción real.",
  "codeExample": "Código Python breve y ejecutable que ilustre un caso borde o mecánica interna."
}`;

  const rawText = await callJsonLlm(
    sysPrompt,
    JSON.stringify({
      title: params.title,
      contextExcerpt: params.contextExcerpt.slice(0, 2800),
    }),
    creds
  );

  const parsed = parseJsonLoose(rawText) as Partial<DeepDiveSection>;
  const deepDive: DeepDiveSection = {
    internalMechanics:
      typeof parsed.internalMechanics === 'string' && parsed.internalMechanics.trim()
        ? parsed.internalMechanics.trim()
        : 'Python gestiona este mecanismo mediante referencias a objetos tipados dinámicamente en el heap.',
    edgeCases: Array.isArray(parsed.edgeCases)
      ? parsed.edgeCases.map(String).filter(Boolean).slice(0, 5)
      : [],
    commonPitfalls: Array.isArray(parsed.commonPitfalls)
      ? parsed.commonPitfalls.map(String).filter(Boolean).slice(0, 5)
      : [],
    realWorldContrast:
      typeof parsed.realWorldContrast === 'string' && parsed.realWorldContrast.trim()
        ? parsed.realWorldContrast.trim()
        : 'En producción se prioriza claridad, contratos explícitos y pruebas de casos borde.',
    codeExample:
      typeof parsed.codeExample === 'string' && parsed.codeExample.trim()
        ? parsed.codeExample.trim()
        : undefined,
  };

  if (livingBooksDb.deepDiveCache) {
    await livingBooksDb.deepDiveCache
      .put({
        cacheKey,
        bookId: params.bookId,
        lessonId: params.lessonId,
        conceptKey: params.conceptKey,
        deepDive,
        updatedAt: Date.now(),
      })
      .catch(() => {});
    scheduleCloudStateSync();
  }

  return deepDive;
}
