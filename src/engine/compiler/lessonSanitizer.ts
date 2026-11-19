import type { LessonBlock, MicroLesson } from '../../types/cartridge.types';

/**
 * Saneador de lecciones generadas por el LLM.
 *
 * Modulo sin dependencias (ni Dexie ni Workers) para poder testearlo de forma
 * pura. Descarta bloques con tipos desconocidos y normaliza campos criticos
 * (p. ej. `callout.kind`) para que el renderer nunca reciba datos que lo hagan
 * fallar (causa de la "pantalla negra").
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

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.text === 'string') return rec.text;
    if (typeof rec.label === 'string') return rec.label;
    if (typeof rec.value === 'string') return rec.value;
    if (typeof rec.code === 'string') return rec.code;
    return JSON.stringify(value);
  }
  return '';
}

export function sanitizeBlock(raw: unknown, index: number): LessonBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const block = raw as Record<string, unknown>;
  const type = String(block.type ?? '');
  if (!VALID_BLOCK_TYPES.has(type)) return null;

  const blockId =
    typeof block.blockId === 'string' && block.blockId ? block.blockId : `block-${index}`;
  const base: Record<string, unknown> = { ...block, blockId, type };

  if (type === 'PROSE') {
    const markdown = typeof block.markdown === 'string' ? block.markdown : '';
    if (!markdown.trim()) return null;
    const rawCallout = block.callout as Record<string, unknown> | undefined;
    if (rawCallout && typeof rawCallout === 'object') {
      const kind = String(rawCallout.kind ?? 'BOOK_NOTE');
      base.callout = {
        kind: VALID_CALLOUT_KINDS.has(kind) ? kind : 'BOOK_NOTE',
        title: typeof rawCallout.title === 'string' ? rawCallout.title : 'Nota',
        body: typeof rawCallout.body === 'string' ? rawCallout.body : '',
      };
    } else {
      delete base.callout;
    }
    base.markdown = markdown;
  }

  if (type === 'OUTPUT_PREDICTION' || type === 'BUG_AUTOPSY') {
    base.options = Array.isArray(block.options)
      ? block.options.map((opt) => coerceString(opt))
      : ['Error / Ninguno', 'Salida valida'];
    base.prompt = coerceString(block.prompt) || 'Analiza el siguiente fragmento:';
    base.codeSnippet = coerceString(block.codeSnippet) || '# codigo';
    base.explanation = coerceString(block.explanation);
    if (type === 'BUG_AUTOPSY') {
      base.title = coerceString(block.title) || 'Autopsia de Bug';
      base.tracebackText = coerceString(block.tracebackText);
      base.culpritLineNumber = Number.isFinite(Number(block.culpritLineNumber))
        ? Math.max(1, Number(block.culpritLineNumber))
        : 1;
    } else {
      base.expectedReturnType = coerceString(block.expectedReturnType) || 'str';
    }
    base.correctOptionIndex = Number.isFinite(Number(block.correctOptionIndex))
      ? Math.max(0, Number(block.correctOptionIndex))
      : 0;
  }

  if (type === 'PARSONS_PROBLEM') {
    base.prompt = coerceString(block.prompt) || 'Ordena las lineas:';
    base.blocks = Array.isArray(block.blocks) ? block.blocks : [];
  }

  if (type === 'CODE_LAB' || type === 'AST_CHALLENGE') {
    base.title = coerceString(block.title) || 'Laboratorio';
    base.instructions = coerceString(block.instructions) || 'Completa el ejercicio.';
    base.starterCode = typeof block.starterCode === 'string' ? block.starterCode : '';
    base.unitTestCode = typeof block.unitTestCode === 'string' ? block.unitTestCode : '';
  }

  if (type === 'INTERACTIVE_VISUALIZER') {
    base.title = coerceString(block.title) || 'Visualizador';
    base.codeContext = typeof block.codeContext === 'string' ? block.codeContext : '';
    base.payload = block.payload && typeof block.payload === 'object' ? block.payload : {};
  }

  return base as unknown as LessonBlock;
}

/** Sanea una leccion completa; lanza si no queda ningun bloque valido. */
export function sanitizeLesson(raw: unknown): MicroLesson {
  const lesson = (raw ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(lesson.blocks)
    ? lesson.blocks
        .map((b, i) => sanitizeBlock(b, i))
        .filter((b): b is LessonBlock => b !== null)
    : [];
  if (blocks.length === 0) {
    throw new Error('La leccion no contiene bloques validos.');
  }
  const sanitized: MicroLesson & { extractedGlossary?: Record<string, unknown> } = {
    lessonId:
      typeof lesson.lessonId === 'string' && lesson.lessonId
        ? lesson.lessonId
        : `lesson-${Date.now()}`,
    order: Number.isFinite(Number(lesson.order)) ? Number(lesson.order) : 1,
    title: typeof lesson.title === 'string' && lesson.title ? lesson.title : 'Leccion',
    estimatedMinutes: Number.isFinite(Number(lesson.estimatedMinutes))
      ? Number(lesson.estimatedMinutes)
      : 10,
    blocks,
  };
  if (lesson.extractedGlossary && typeof lesson.extractedGlossary === 'object' && !Array.isArray(lesson.extractedGlossary)) {
    sanitized.extractedGlossary = lesson.extractedGlossary as Record<string, unknown>;
  }
  return sanitized;
}
