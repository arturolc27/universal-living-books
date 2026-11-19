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
  'FLASHCARD',
  'YOUTUBE_REF',
]);

const VALID_CALLOUT_KINDS = new Set<string>(['TIP', 'WARNING', 'BOOK_NOTE', 'ERROR_TRAP']);

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
