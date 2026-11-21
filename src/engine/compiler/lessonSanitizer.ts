import type { BookCartridge, LessonBlock, MicroLesson } from '../../types/cartridge.types';

/**
 * Saneador y normalizador de lecciones generadas por LLMs.
 *
 * Mapea alias comunes emitidos por distintos modelos (content/body/text -> markdown,
 * code/snippet -> codeSnippet, front/back -> frontMarkdown/backMarkdown), preserva
 * titulos de seccion reales e inyecta prosa del libro si el modelo la omitio, para
 * que NINGUN libro quede vacio o irrecuperable.
 */

const VALID_BLOCK_TYPES = new Set<string>([
  'PROSE',
  'GPU_ANIMATION',
  'INTERACTIVE_VISUALIZER',
  'CODE_LAB',
  'AST_CHALLENGE',
  'PARSONS_PROBLEM',
  'OUTPUT_PREDICTION',
  'BUG_AUTOPSY',
  'SYNTAX_CLOZE',
  'QUICK_QUIZ',
  'FLASHCARD',
  'YOUTUBE_REF',
]);

const VALID_CALLOUT_KINDS = new Set<string>(['TIP', 'WARNING', 'BOOK_NOTE', 'ERROR_TRAP']);

export interface LessonSanitizeFallback {
  sectionTitle?: string;
  cleanText?: string;
  order?: number;
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.markdown === 'string') return rec.markdown;
    if (typeof rec.text === 'string') return rec.text;
    if (typeof rec.label === 'string') return rec.label;
    if (typeof rec.value === 'string') return rec.value;
    if (typeof rec.code === 'string') return rec.code;
    if (typeof rec.content === 'string') return rec.content;
    return JSON.stringify(value);
  }
  return '';
}

function firstNonEmptyString(...candidates: unknown[]): string {
  for (const c of candidates) {
    const str = coerceString(c).trim();
    if (str.length > 0) return str;
  }
  return '';
}

const VALID_HEAP_STATUSES = new Set(['NEW', 'ACTIVE', 'MUTATED', 'ORPHANED']);

export function normalizeHeapStatus(raw: unknown): 'NEW' | 'ACTIVE' | 'MUTATED' | 'ORPHANED' {
  const s = String(raw ?? '').toUpperCase().trim();
  if (VALID_HEAP_STATUSES.has(s)) {
    return s as 'NEW' | 'ACTIVE' | 'MUTATED' | 'ORPHANED';
  }
  if (s === 'CREATED' || s === 'ALLOCATED' || s === 'INIT' || s === 'INITIAL') return 'NEW';
  if (s === 'MODIFIED' || s === 'CHANGED' || s === 'UPDATED' || s === 'DIRTY') return 'MUTATED';
  if (
    s === 'UNREACHABLE' ||
    s === 'DEAD' ||
    s === 'GC' ||
    s === 'FREED' ||
    s === 'COLLECTED' ||
    s === 'DELETED' ||
    s === 'REMOVED'
  ) {
    return 'ORPHANED';
  }
  // LIVE, EXISTING, ALIVE, REFERENCED, IN_USE, etc.
  return 'ACTIVE';
}

function sanitizeMemorySteps(rawSteps: unknown): unknown[] | undefined {
  if (!Array.isArray(rawSteps)) return undefined;
  return rawSteps
    .map((step, idx) => {
      if (!step || typeof step !== 'object') return null;
      const s = step as Record<string, unknown>;
      const rawFrames = Array.isArray(s.frames)
        ? s.frames
        : Array.isArray(s.stackFrames)
          ? s.stackFrames
          : [];
      const frames = rawFrames
        .map((frame, fIdx) => {
          if (!frame || typeof frame !== 'object') return null;
          const f = frame as Record<string, unknown>;
          const rawVars =
            f.variables && typeof f.variables === 'object' && !Array.isArray(f.variables)
              ? (f.variables as Record<string, unknown>)
              : {};
          const variables: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawVars)) {
            if (k) variables[k] = coerceString(v);
          }
          return {
            name: firstNonEmptyString(f.name) || '<module>',
            isCurrent:
              typeof f.isCurrent === 'boolean' ? f.isCurrent : fIdx === rawFrames.length - 1,
            variables,
            ...(typeof f.returnValue === 'string' ? { returnValue: f.returnValue } : {}),
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      const rawHeap = Array.isArray(s.heap) ? s.heap : [];
      const heap = rawHeap
        .map((obj, hIdx) => {
          if (!obj || typeof obj !== 'object') return null;
          const o = obj as Record<string, unknown>;
          return {
            id: firstNonEmptyString(o.id, o.address) || `id_${hIdx}`,
            type: firstNonEmptyString(o.type) || 'object',
            value: coerceString(o.value),
            status: normalizeHeapStatus(o.status),
          };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null);

      const rawStepIndex = Number(s.stepIndex ?? s.stepNumber);
      const rawLineNumber = Number(s.lineNumber ?? s.activeLine);
      const result: Record<string, unknown> = {
        stepIndex:
          Number.isFinite(rawStepIndex) && rawStepIndex >= 0 ? Math.trunc(rawStepIndex) : idx,
        lineNumber:
          Number.isFinite(rawLineNumber) && rawLineNumber >= 0 ? Math.trunc(rawLineNumber) : 1,
        explanation: firstNonEmptyString(s.explanation, s.note, s.description) || `Paso ${idx + 1}`,
        frames,
        heap,
      };
      if (s.interactiveDragTask && typeof s.interactiveDragTask === 'object') {
        const drag = s.interactiveDragTask as Record<string, unknown>;
        const fromFrame = firstNonEmptyString(drag.fromFrame);
        const variable = firstNonEmptyString(drag.variable);
        const expectedHeapId = firstNonEmptyString(drag.expectedHeapId);
        if (fromFrame && variable && expectedHeapId) {
          result.interactiveDragTask = {
            fromFrame,
            variable,
            expectedHeapId,
            hint: firstNonEmptyString(drag.hint) || 'Conecta la variable con su objeto en el heap.',
          };
        }
      }
      return result;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

/**
 * Normaliza un diccionario de glosario para garantizar compatibilidad estricta
 * con `GlossaryEntrySchema` (filtra claves vacias/puntuacion, convierte strings
 * sueltos a objetos y asegura `chapterIntroduced`).
 */
export function sanitizeGlossaryMap(
  raw: unknown,
  defaultChapter = 1
): BookCartridge['glossary'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const fallbackChapter =
    Number.isFinite(defaultChapter) && defaultChapter >= 1 ? Math.trunc(defaultChapter) : 1;
  const out: BookCartridge['glossary'] = {};

  for (const [rawKey, rawVal] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim();
    // Descartar claves vacias o que solo contienen signos de puntuacion (ej. ":")
    if (!key || key.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_]/g, '').length === 0) continue;

    if (typeof rawVal === 'string') {
      const def = rawVal.trim();
      if (!def) continue;
      out[key] = {
        term: key,
        definition: def,
        chapterIntroduced: fallbackChapter,
      };
      continue;
    }

    if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
      const rec = rawVal as Record<string, unknown>;
      const definition = firstNonEmptyString(
        rec.definition,
        rec.meaning,
        rec.explanation,
        rec.description
      );
      if (!definition) continue;
      const term = firstNonEmptyString(rec.term, rec.name) || key;
      const chNum = Number(rec.chapterIntroduced);
      const chapterIntroduced =
        Number.isFinite(chNum) && chNum >= 1 ? Math.trunc(chNum) : fallbackChapter;
      const exampleCode = firstNonEmptyString(rec.exampleCode, rec.example, rec.code) || undefined;
      out[key] = {
        term,
        definition,
        chapterIntroduced,
        ...(exampleCode ? { exampleCode } : {}),
      };
    }
  }

  return out;
}

export function sanitizeBlock(raw: unknown, index: number): LessonBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const block = raw as Record<string, unknown>;
  const type = String(block.type ?? '').toUpperCase().trim();
  if (!VALID_BLOCK_TYPES.has(type)) return null;

  const blockId =
    typeof block.blockId === 'string' && block.blockId ? block.blockId : `block-${index}`;
  const base: Record<string, unknown> = { ...block, blockId, type };

  if (type === 'PROSE') {
    const markdown = firstNonEmptyString(
      block.markdown,
      block.content,
      block.body,
      block.text,
      block.explanation
    );
    if (!markdown) return null;
    const rawCallout = block.callout as Record<string, unknown> | undefined;
    if (rawCallout && typeof rawCallout === 'object') {
      const kind = String(rawCallout.kind ?? 'BOOK_NOTE');
      base.callout = {
        kind: VALID_CALLOUT_KINDS.has(kind) ? kind : 'BOOK_NOTE',
        title: firstNonEmptyString(rawCallout.title) || 'Nota',
        body: firstNonEmptyString(rawCallout.body, rawCallout.text, rawCallout.content),
      };
    } else {
      delete base.callout;
    }
    base.markdown = markdown;
  }

  if (type === 'OUTPUT_PREDICTION' || type === 'BUG_AUTOPSY') {
    const rawOpts = Array.isArray(block.options)
      ? block.options
      : Array.isArray(block.choices)
        ? block.choices
        : null;
    const options = rawOpts
      ? rawOpts.map((opt) => coerceString(opt)).filter(Boolean)
      : ['Error / Ninguno', 'Salida valida'];
    base.options = options.length >= 2 ? options : ['Salida 1', 'Salida 2'];
    base.prompt =
      firstNonEmptyString(block.prompt, block.question, block.instructions) ||
      'Analiza el siguiente fragmento:';
    const rawCode = firstNonEmptyString(
      block.codeSnippet,
      block.code,
      block.snippet,
      block.sourceCode,
      block.codeContext
    );
    base.codeSnippet = rawCode || '# Sin codigo provisto';
    base.explanation = firstNonEmptyString(block.explanation, block.rationale, block.feedback);

    let correctIdx = Number(block.correctOptionIndex ?? block.correctIndex);
    if (!Number.isFinite(correctIdx) && block.correctAnswer !== undefined) {
      const target = coerceString(block.correctAnswer).trim();
      const found = options.findIndex((o) => o.trim() === target);
      if (found >= 0) correctIdx = found;
    }
    base.correctOptionIndex = Number.isFinite(correctIdx)
      ? Math.max(0, Math.min(options.length - 1, Math.trunc(correctIdx)))
      : 0;

    if (type === 'BUG_AUTOPSY') {
      base.title = firstNonEmptyString(block.title) || 'Autopsia de Bug';
      base.tracebackText = firstNonEmptyString(block.tracebackText, block.traceback, block.error);
      base.culpritLineNumber = Number.isFinite(Number(block.culpritLineNumber))
        ? Math.max(1, Math.trunc(Number(block.culpritLineNumber)))
        : 1;
    } else {
      base.expectedReturnType =
        firstNonEmptyString(block.expectedReturnType, block.returnType, block.typeHint) || 'str';
    }
  }

  if (type === 'PARSONS_PROBLEM') {
    base.prompt =
      firstNonEmptyString(block.prompt, block.instructions, block.question) ||
      'Ordena las lineas en el orden correcto:';
    const rawLines = Array.isArray(block.blocks)
      ? block.blocks
      : Array.isArray(block.lines)
        ? block.lines
        : Array.isArray(block.items)
          ? block.items
          : [];
    base.blocks = rawLines.map((line, idx) => {
      if (typeof line === 'string') {
        return {
          id: `line-${idx}`,
          code: line,
          correctOrder: idx,
          correctIndent: 0,
          isDistractor: false,
        };
      }
      const lObj = (line ?? {}) as Record<string, unknown>;
      return {
        id: firstNonEmptyString(lObj.id) || `line-${idx}`,
        code: firstNonEmptyString(lObj.code, lObj.text, lObj.line) || 'pass',
        correctOrder: Number.isFinite(Number(lObj.correctOrder)) ? Number(lObj.correctOrder) : idx,
        correctIndent: Number.isFinite(Number(lObj.correctIndent))
          ? Math.max(0, Number(lObj.correctIndent))
          : 0,
        isDistractor: Boolean(lObj.isDistractor),
      };
    });
  }

  if (type === 'CODE_LAB' || type === 'AST_CHALLENGE') {
    base.title = firstNonEmptyString(block.title) || 'Laboratorio Python';
    base.instructions =
      firstNonEmptyString(block.instructions, block.prompt, block.description) ||
      'Resuelve el ejercicio en Python.';
    base.starterCode =
      typeof block.starterCode === 'string'
        ? block.starterCode
        : typeof block.code === 'string'
          ? block.code
          : '# Escribe tu codigo aqui\n';
    base.unitTestCode =
      typeof block.unitTestCode === 'string'
        ? block.unitTestCode
        : typeof block.tests === 'string'
          ? block.tests
          : '';
    if (type === 'CODE_LAB') {
      const mode = String(block.scaffoldMode ?? 'FREE_SANDBOX');
      base.scaffoldMode =
        mode === 'FDR_5_STEPS' || mode === 'MULTI_FILE_PROJECT' ? mode : 'FREE_SANDBOX';
    } else {
      const rawAst = (block.astConstraints && typeof block.astConstraints === 'object'
        ? block.astConstraints
        : {}) as Record<string, unknown>;
      base.astConstraints = {
        requiredNodeTypes: Array.isArray(rawAst.requiredNodeTypes)
          ? rawAst.requiredNodeTypes.map(String)
          : ['FunctionDef'],
        forbiddenNodeTypes: Array.isArray(rawAst.forbiddenNodeTypes)
          ? rawAst.forbiddenNodeTypes.map(String)
          : [],
        forbiddenCalls: Array.isArray(rawAst.forbiddenCalls)
          ? rawAst.forbiddenCalls.map(String)
          : [],
        customAstMessage:
          firstNonEmptyString(rawAst.customAstMessage) || 'Cumple las reglas estructurales.',
      };
    }
  }

  if (type === 'INTERACTIVE_VISUALIZER') {
    const allowedKinds = new Set([
      'MEMORY_MODEL',
      'AST_COLLAPSER',
      'DATAFRAME_DIFF',
      'OOP_CLASS_GRAPH',
      'FILE_CURSOR_TAPE',
    ]);
    const kind = String(block.visualizerKind ?? 'MEMORY_MODEL');
    base.visualizerKind = allowedKinds.has(kind) ? kind : 'MEMORY_MODEL';
    base.title = firstNonEmptyString(block.title) || 'Visualizador Interactivo';
    base.codeContext = firstNonEmptyString(block.codeContext, block.code, block.snippet);
    const rawPayload =
      block.payload && typeof block.payload === 'object'
        ? { ...(block.payload as Record<string, unknown>) }
        : {};
    if (Array.isArray(rawPayload.memorySteps)) {
      rawPayload.memorySteps = sanitizeMemorySteps(rawPayload.memorySteps);
    }
    base.payload = rawPayload;
  }

  if (type === 'FLASHCARD') {
    const front = firstNonEmptyString(
      block.frontMarkdown,
      block.front,
      block.question,
      block.prompt,
      block.term
    );
    const back = firstNonEmptyString(
      block.backMarkdown,
      block.back,
      block.answer,
      block.explanation,
      block.definition
    );
    if (!front && !back) return null;
    base.cardId = firstNonEmptyString(block.cardId, block.id) || `card-${index}`;
    base.frontMarkdown = front || 'Concepto clave';
    base.backMarkdown = back || 'Revisa la explicacion de la leccion.';
    base.tags = Array.isArray(block.tags) ? block.tags.map(String) : ['python'];
  }

  if (type === 'SYNTAX_CLOZE') {
    base.title = firstNonEmptyString(block.title) || 'Completa la sintaxis';
    base.prompt = firstNonEmptyString(block.prompt, block.instructions) || 'Completa los huecos:';
    base.codeTemplate = firstNonEmptyString(block.codeTemplate, block.code) || 'x = ___0___';
    base.blanks = Array.isArray(block.blanks) ? block.blanks : [];
    base.explanation = firstNonEmptyString(block.explanation);
  }

  if (type === 'QUICK_QUIZ') {
    base.title = firstNonEmptyString(block.title) || 'Evaluacion rapida';
    base.questions = Array.isArray(block.questions) ? block.questions : [];
  }

  return base as unknown as LessonBlock;
}

/**
 * Formatea el texto crudo de una seccion del libro en Markdown limpio y legible,
 * preservando bloques de codigo Python (`>>>` o indentados) y marcadores de pagina.
 */
export function formatBookSourceMarkdown(rawText: string): {
  markdown: string;
  pageRange?: string;
} {
  const trimmed = rawText.trim();
  if (!trimmed) return { markdown: '' };

  const pages: number[] = [];
  const lines = trimmed.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inFence = false;
  let codeLines: string[] = [];

  const flushCode = () => {
    if (codeLines.length === 0) return;
    out.push('```python\n' + codeLines.join('\n') + '\n```');
    codeLines = [];
    inCode = false;
  };

  for (const rawLine of lines) {
    if (rawLine.trim().startsWith('```')) {
      flushCode();
      inFence = !inFence;
      out.push(rawLine);
      continue;
    }
    if (inFence) {
      out.push(rawLine);
      continue;
    }

    const pageMatch = rawLine.match(/^\s*-{2,}\s*(?:page|pagina|pág\.?)\s*(\d+)\s*-{2,}\s*$/i);
    if (pageMatch) {
      flushCode();
      const pageNum = Number(pageMatch[1]);
      if (Number.isFinite(pageNum)) pages.push(pageNum);
      out.push(`\n---\n\n##### Página ${pageNum}\n`);
      continue;
    }

    const isReplOrDef =
      /^\s*>>>\s?/.test(rawLine) ||
      /^\s*\.\.\.\s?/.test(rawLine) ||
      (/^(?:\s{4}|\t)\S/.test(rawLine) && inCode);

    if (isReplOrDef) {
      inCode = true;
      codeLines.push(rawLine.replace(/^\s*(?:>>>|\.\.\.)\s?/, ''));
    } else {
      flushCode();
      out.push(rawLine);
    }
  }
  flushCode();

  const markdown = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let pageRange: string | undefined;
  if (pages.length > 0) {
    const minP = Math.min(...pages);
    const maxP = Math.max(...pages);
    pageRange = minP === maxP ? `Pág. ${minP}` : `Págs. ${minP}–${maxP}`;
  }
  return { markdown, pageRange };
}

/** Sanea una leccion completa; preserva el texto real del libro e inyecta prosa si falta. */
export function sanitizeLesson(
  raw: unknown,
  fallback: LessonSanitizeFallback = {}
): MicroLesson {
  const lesson = (raw ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(lesson.blocks)
    ? lesson.blocks
        .map((b, i) => sanitizeBlock(b, i))
        .filter((b): b is LessonBlock => b !== null)
    : [];

  // Si el LLM no genero ningun bloque PROSE pero tenemos el texto fuente, lo preservamos al inicio.
  const hasProse = blocks.some((b) => b.type === 'PROSE');
  if (!hasProse && fallback.cleanText && fallback.cleanText.trim().length > 0) {
    const formatted = formatBookSourceMarkdown(fallback.cleanText);
    blocks.unshift({
      blockId: `fallback-prose-${Date.now()}`,
      type: 'PROSE',
      markdown: formatted.markdown.slice(0, 3500),
    });
  }

  if (blocks.length === 0) {
    throw new Error('La leccion no contiene bloques validos.');
  }

  const rawTitle = firstNonEmptyString(lesson.title);
  const resolvedTitle =
    rawTitle && rawTitle.toLowerCase() !== 'leccion'
      ? rawTitle
      : fallback.sectionTitle?.trim() || 'Leccion';

  let sourceBookMarkdown =
    typeof lesson.sourceBookMarkdown === 'string' && lesson.sourceBookMarkdown.trim().length > 0
      ? lesson.sourceBookMarkdown
      : undefined;
  let sourcePageRange =
    typeof lesson.sourcePageRange === 'string' && lesson.sourcePageRange.trim().length > 0
      ? lesson.sourcePageRange
      : undefined;

  if (!sourceBookMarkdown && fallback.cleanText && fallback.cleanText.trim().length > 0) {
    const formatted = formatBookSourceMarkdown(fallback.cleanText);
    if (formatted.markdown) {
      sourceBookMarkdown = formatted.markdown;
      sourcePageRange = sourcePageRange ?? formatted.pageRange;
    }
  }

  const rawDeepDive = lesson.deepDive as Record<string, unknown> | undefined;
  const deepDive =
    rawDeepDive &&
    typeof rawDeepDive === 'object' &&
    typeof rawDeepDive.internalMechanics === 'string' &&
    rawDeepDive.internalMechanics.trim().length > 0
      ? {
          internalMechanics: rawDeepDive.internalMechanics.trim(),
          edgeCases: Array.isArray(rawDeepDive.edgeCases)
            ? rawDeepDive.edgeCases.map(String).filter(Boolean)
            : [],
          commonPitfalls: Array.isArray(rawDeepDive.commonPitfalls)
            ? rawDeepDive.commonPitfalls.map(String).filter(Boolean)
            : [],
          realWorldContrast:
            typeof rawDeepDive.realWorldContrast === 'string' && rawDeepDive.realWorldContrast.trim()
              ? rawDeepDive.realWorldContrast.trim()
              : 'Aplicar buenas prácticas y pruebas unitarias de casos borde.',
          codeExample:
            typeof rawDeepDive.codeExample === 'string' && rawDeepDive.codeExample.trim()
              ? rawDeepDive.codeExample.trim()
              : undefined,
        }
      : undefined;

  const exerciseBank = Array.isArray(lesson.exerciseBank)
    ? lesson.exerciseBank
        .map((b, i) => sanitizeBlock(b, 100 + i))
        .filter((b): b is LessonBlock => b !== null)
    : undefined;

  const competencyIds = Array.isArray(lesson.competencyIds)
    ? lesson.competencyIds.map(String).filter(Boolean)
    : undefined;

  const sanitized: MicroLesson & { extractedGlossary?: Record<string, unknown> } = {
    lessonId:
      typeof lesson.lessonId === 'string' && lesson.lessonId
        ? lesson.lessonId
        : `lesson-${Date.now()}`,
    order: Number.isFinite(Number(lesson.order))
      ? Number(lesson.order)
      : fallback.order ?? 1,
    title: resolvedTitle,
    estimatedMinutes: Number.isFinite(Number(lesson.estimatedMinutes))
      ? Math.max(1, Number(lesson.estimatedMinutes))
      : 10,
    learningObjectives: Array.isArray(lesson.learningObjectives)
      ? lesson.learningObjectives.map(String).filter(Boolean)
      : undefined,
    takeaways: Array.isArray(lesson.takeaways)
      ? lesson.takeaways.map(String).filter(Boolean)
      : undefined,
    sourceBookMarkdown,
    sourcePageRange,
    deepDive,
    competencyIds,
    exerciseBank: exerciseBank && exerciseBank.length > 0 ? exerciseBank : undefined,
    blocks,
  };

  if (
    lesson.extractedGlossary &&
    typeof lesson.extractedGlossary === 'object' &&
    !Array.isArray(lesson.extractedGlossary)
  ) {
    const cleanGlossary = sanitizeGlossaryMap(lesson.extractedGlossary, fallback.order ?? 1);
    if (Object.keys(cleanGlossary).length > 0) {
      sanitized.extractedGlossary = cleanGlossary as unknown as Record<string, unknown>;
    }
  }
  return sanitized;
}

/**
 * Repara un cartucho ya guardado en IndexedDB si tiene campos menores
 * faltantes, capitulos duplicados o bloques con alias del LLM.
 */
export function repairCartridgeForRuntime(raw: unknown): BookCartridge | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const rawChapters = Array.isArray(rec.chapters) ? rec.chapters : [];
  if (rawChapters.length === 0) return null;

  const seenNumbers = new Set<number>();
  const chapters = rawChapters
    .map((ch, cIdx) => {
      if (!ch || typeof ch !== 'object') return null;
      const chObj = ch as Record<string, unknown>;
      const rawLessons = Array.isArray(chObj.microLessons) ? chObj.microLessons : [];
      const chTitle = firstNonEmptyString(chObj.title) || `Modulo ${cIdx + 1}`;
      const microLessons = rawLessons
        .map((ml, lIdx) => {
          try {
            return sanitizeLesson(ml, {
              sectionTitle: `${chTitle} — Parte ${lIdx + 1}`,
              order: lIdx + 1,
            });
          } catch {
            return null;
          }
        })
        .filter((ml): ml is MicroLesson => ml !== null);
      if (microLessons.length === 0) return null;

      let num =
        Number.isFinite(Number(chObj.number)) && Number(chObj.number) > 0
          ? Math.trunc(Number(chObj.number))
          : cIdx + 1;
      while (seenNumbers.has(num)) {
        num += 1;
      }
      seenNumbers.add(num);

      return {
        chapterId:
          typeof chObj.chapterId === 'string' && chObj.chapterId
            ? `${chObj.chapterId}-${num}`
            : `ch-${num}`,
        number: num,
        title: chTitle,
        summary: typeof chObj.summary === 'string' ? chObj.summary : '',
        microLessons,
      };
    })
    .filter((ch): ch is NonNullable<typeof ch> => ch !== null);

  if (chapters.length === 0) return null;

  const meta = (rec.metadata && typeof rec.metadata === 'object' ? rec.metadata : {}) as Record<string, unknown>;
  const rawTheme = (rec.themeDNA && typeof rec.themeDNA === 'object' ? rec.themeDNA : {}) as Record<string, unknown>;
  const rawColors = (rawTheme.colors && typeof rawTheme.colors === 'object' ? rawTheme.colors : {}) as Record<string, unknown>;
  const rawTypo = (rawTheme.typography && typeof rawTheme.typography === 'object' ? rawTheme.typography : {}) as Record<string, unknown>;
  const rawRuntime = (rec.runtimeRequirements && typeof rec.runtimeRequirements === 'object'
    ? rec.runtimeRequirements
    : {}) as Record<string, unknown>;

  return {
    schemaVersion: '2.0',
    bookId: typeof rec.bookId === 'string' && rec.bookId ? rec.bookId : `book-${Date.now()}`,
    metadata: {
      title: firstNonEmptyString(meta.title) || 'Libro Compilado',
      subtitle: typeof meta.subtitle === 'string' ? meta.subtitle : '',
      authors: Array.isArray(meta.authors) && meta.authors.length > 0 ? meta.authors.map(String) : ['Autor'],
      edition: firstNonEmptyString(meta.edition) || '1st',
      difficulty:
        meta.difficulty === 'INTERMEDIATE' || meta.difficulty === 'ADVANCED' ? meta.difficulty : 'BEGINNER',
      coverAccentIcon: firstNonEmptyString(meta.coverAccentIcon) || '📘',
      coverImageDataUrl: typeof meta.coverImageDataUrl === 'string' ? meta.coverImageDataUrl : undefined,
    },
    themeDNA: {
      themeName: typeof rawTheme.themeName === 'string' ? rawTheme.themeName : 'Compiled Slate',
      mode: rawTheme.mode === 'light' ? 'light' : 'dark',
      colors: {
        bgCanvas: typeof rawColors.bgCanvas === 'string' ? rawColors.bgCanvas : '#0F1419',
        bgSurface: typeof rawColors.bgSurface === 'string' ? rawColors.bgSurface : '#182026',
        bgElevated: typeof rawColors.bgElevated === 'string' ? rawColors.bgElevated : '#222D36',
        borderSubtle: typeof rawColors.borderSubtle === 'string' ? rawColors.borderSubtle : '#2E3C48',
        textPrimary: typeof rawColors.textPrimary === 'string' ? rawColors.textPrimary : '#F1F5F9',
        textMuted: typeof rawColors.textMuted === 'string' ? rawColors.textMuted : '#94A3B8',
        accentPrimary: typeof rawColors.accentPrimary === 'string' ? rawColors.accentPrimary : '#38BDF8',
        accentSecondary: typeof rawColors.accentSecondary === 'string' ? rawColors.accentSecondary : '#F59E0B',
        accentSuccess: typeof rawColors.accentSuccess === 'string' ? rawColors.accentSuccess : '#10B981',
        accentDanger: typeof rawColors.accentDanger === 'string' ? rawColors.accentDanger : '#F43F5E',
      },
      typography: {
        editorialFont: rawTypo.editorialFont === 'serif' ? 'serif' : 'sans',
        codeFont: typeof rawTypo.codeFont === 'string' ? rawTypo.codeFont : 'JetBrains Mono',
      },
    },
    runtimeRequirements: {
      pythonVersion: typeof rawRuntime.pythonVersion === 'string' ? rawRuntime.pythonVersion : '3.12',
      packages: Array.isArray(rawRuntime.packages) ? rawRuntime.packages.map(String) : [],
      enableLiveMemoryTracer: Boolean(rawRuntime.enableLiveMemoryTracer),
      virtualFileSystemSeed:
        rawRuntime.virtualFileSystemSeed && typeof rawRuntime.virtualFileSystemSeed === 'object'
          ? (rawRuntime.virtualFileSystemSeed as Record<string, string>)
          : {},
    },
    glossary: sanitizeGlossaryMap(rec.glossary, chapters[0]?.number ?? 1),
    achievements: Array.isArray(rec.achievements) ? rec.achievements : [],
    chapters,
  };
}
