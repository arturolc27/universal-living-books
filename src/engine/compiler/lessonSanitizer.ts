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

/**
 * Repara un cartucho ya guardado en IndexedDB si tiene campos menores
 * faltantes o con tipos inesperados del LLM, evitando que sea omitido al recargar.
 */
export function repairCartridgeForRuntime(raw: unknown): import('../../types/cartridge.types').BookCartridge | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const rawChapters = Array.isArray(rec.chapters) ? rec.chapters : [];
  if (rawChapters.length === 0) return null;

  const chapters = rawChapters
    .map((ch, cIdx) => {
      if (!ch || typeof ch !== 'object') return null;
      const chObj = ch as Record<string, unknown>;
      const rawLessons = Array.isArray(chObj.microLessons) ? chObj.microLessons : [];
      const microLessons = rawLessons
        .map((ml) => {
          try {
            return sanitizeLesson(ml);
          } catch {
            return null;
          }
        })
        .filter((ml): ml is MicroLesson => ml !== null);
      if (microLessons.length === 0) return null;
      return {
        chapterId: typeof chObj.chapterId === 'string' && chObj.chapterId ? chObj.chapterId : `ch-${cIdx + 1}`,
        number: Number.isFinite(Number(chObj.number)) && Number(chObj.number) > 0 ? Number(chObj.number) : cIdx + 1,
        title: typeof chObj.title === 'string' && chObj.title ? chObj.title : `Capitulo ${cIdx + 1}`,
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
      title: typeof meta.title === 'string' && meta.title ? meta.title : 'Libro Compilado',
      subtitle: typeof meta.subtitle === 'string' ? meta.subtitle : '',
      authors: Array.isArray(meta.authors) && meta.authors.length > 0 ? meta.authors.map(String) : ['Autor'],
      edition: typeof meta.edition === 'string' && meta.edition ? meta.edition : '1st',
      difficulty:
        meta.difficulty === 'INTERMEDIATE' || meta.difficulty === 'ADVANCED' ? meta.difficulty : 'BEGINNER',
      coverAccentIcon: typeof meta.coverAccentIcon === 'string' && meta.coverAccentIcon ? meta.coverAccentIcon : '📘',
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
    glossary:
      rec.glossary && typeof rec.glossary === 'object' && !Array.isArray(rec.glossary)
        ? (rec.glossary as import('../../types/cartridge.types').BookCartridge['glossary'])
        : {},
    achievements: Array.isArray(rec.achievements) ? rec.achievements : [],
    chapters,
  };
}
