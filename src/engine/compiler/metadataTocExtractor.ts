import type { ThemeDNA } from '../../types/cartridge.types';
import type { BookMetadataDraft, ChapterIndexEntry } from '../../types/compiler.types';
import type { BookSourceNativeMetadata } from './bookSourceAdapter';
import { cleanText, extractCodeSnippets, type SectionChunk } from './semanticChunker';

/**
 * Fase 0 — Escaneo de Metadatos e Indice Maestro (LLM TOC Extractor).
 *
 * En lugar de adivinar los encabezados de capitulo con expresiones regulares
 * fragiles (que sobre-fragmentan el Capitulo 1 en decenas de trozos y pierden
 * los capitulos 2..N), tomamos unicamente las primeras ~15 paginas del libro
 * (portada, creditos y Table of Contents) y hacemos UNA sola llamada
 * estructurada al LLM para extraer los metadatos y el indice exacto.
 *
 * Con ese indice (paginas reales del PDF o anclas de titulos exactos) el
 * cortador local extrae el texto de cada capitulo con 0% de error y lo agrupa
 * en 4 a 8 micro-lecciones pedagogicas coherentes.
 */

export const TOC_EXTRACTION_SYSTEM_INSTRUCTION = `Eres un bibliotecario experto en ingenieria inversa de indices de libros tecnicos.
Recibes las primeras paginas de un libro (portada, creditos y Table of Contents).
Devuelve EXCLUSIVAMENTE un objeto JSON valido, sin markdown ni texto adicional.

REGLAS:
1. Extrae los metadatos bibliograficos reales (titulo, subtitulo, autores, anio, edicion, total de paginas).
2. Reconstruye el Indice Maestro de Capitulos (chaptersIndex) con el numero de capitulo,
   su titulo exacto y el rango de paginas reales del PDF (startPage/endPage, 1-based).
3. NO inventes capitulos: usa solo los que aparecen en el Table of Contents.
4. Si un dato no aparece, usa un valor razonable y coherente (nunca null).
5. Sugiere una paleta ThemeDNA coherente con la portada del libro.`;

export const BOOK_METADATA_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: 'integer' },
    edition: { type: 'string' },
    totalPages: { type: 'integer' },
    difficulty: { type: 'string', enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] },
    coverAccentIcon: { type: 'string' },
    themeDNA: { type: 'object' },
    chaptersIndex: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chapterNumber: { type: 'integer' },
          title: { type: 'string' },
          startPage: { type: 'integer' },
          endPage: { type: 'integer' },
        },
        required: ['chapterNumber', 'title', 'startPage', 'endPage'],
      },
    },
  },
  required: ['title', 'authors', 'chaptersIndex'],
};

export interface TocExtractorCredentials {
  provider: 'openrouter' | 'gemini' | 'ollama';
  openrouterApiKey: string;
  geminiApiKey: string;
  ollamaBaseUrl: string;
  model: string;
}

export interface TocExtractionResult {
  metadata: BookMetadataDraft;
  chaptersIndex: ChapterIndexEntry[];
  rawLlmResponse: string;
  isScannedLikely: boolean;
}

export interface TocExtractionOptions {
  /** Numero maximo de caracteres del front-matter enviados al LLM. */
  maxFrontMatterChars?: number;
  /** Numero maximo de paginas del front-matter (si el texto trae marcadores). */
  maxFrontMatterPages?: number;
  /** Miniatura de portada (data URL) extraida del PDF/EPUB, si existe. */
  coverImageDataUrl?: string;
  /** Metadatos nativos extraidos de EPUB/PDF para usar como respaldo prioritario. */
  nativeMetadata?: BookSourceNativeMetadata;
  /** Conteo real de paginas/capitulos extraido del archivo fuente. */
  totalPages?: number;
  onLog?: (line: string) => void;
}

const DEFAULT_THEME_DNA: ThemeDNA = {
  themeName: 'Compiled Slate',
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
};

const PAGE_MARKER_PATTERN = /(?:^|\n)\s*(?:-{2,}\s*)?(?:page|pagina|pág\.?)\s*(\d+)\s*(?:-{2,})?\s*(?=\n|$)/gi;

/**
 * Extrae unicamente el front-matter (portada, creditos y TOC) del texto crudo.
 * Si el texto contiene marcadores de pagina (`--- page N ---`), respeta el
 * limite de paginas; en caso contrario corta por numero de caracteres.
 */
export function extractFrontMatter(
  rawText: string,
  maxChars = 18000,
  maxPages = 15
): string {
  const hasPageMarkers = PAGE_MARKER_PATTERN.test(rawText);
  PAGE_MARKER_PATTERN.lastIndex = 0;

  if (hasPageMarkers) {
    const matches = [...rawText.matchAll(PAGE_MARKER_PATTERN)];
    if (matches.length > 0) {
      const cutoff = matches.find((m) => Number(m[1]) > maxPages);
      if (cutoff && cutoff.index !== undefined) {
        return rawText.slice(0, cutoff.index);
      }
    }
  }
  return rawText.slice(0, maxChars);
}

function coerceThemeDNA(raw: unknown): ThemeDNA {
  if (!raw || typeof raw !== 'object') return DEFAULT_THEME_DNA;
  const candidate = raw as Partial<ThemeDNA>;
  if (!candidate.colors || !candidate.typography) return DEFAULT_THEME_DNA;
  return {
    themeName: candidate.themeName || DEFAULT_THEME_DNA.themeName,
    mode: candidate.mode === 'light' ? 'light' : 'dark',
    colors: { ...DEFAULT_THEME_DNA.colors, ...candidate.colors },
    typography: { ...DEFAULT_THEME_DNA.typography, ...candidate.typography },
  };
}

export function coerceMetadata(
  raw: Record<string, unknown>,
  totalChars: number,
  coverImageDataUrl?: string
): BookMetadataDraft {
  const authors = Array.isArray(raw.authors)
    ? (raw.authors as unknown[]).map((a) => String(a)).filter(Boolean)
    : [];
  const difficulty = raw.difficulty === 'ADVANCED' || raw.difficulty === 'INTERMEDIATE'
    ? raw.difficulty
    : 'BEGINNER';
  const title = String(raw.title ?? '').trim();
  return {
    title: title || 'Libro sin titulo',
    subtitle: String(raw.subtitle ?? ''),
    authors: authors.length > 0 ? authors : ['Autor Desconocido'],
    year: Number.isFinite(Number(raw.year)) ? Number(raw.year) : new Date().getFullYear(),
    edition: String(raw.edition ?? '1st Edition'),
    totalPages: Number.isFinite(Number(raw.totalPages)) ? Number(raw.totalPages) : 0,
    totalChars,
    difficulty,
    coverAccentIcon: String(raw.coverAccentIcon ?? '📘'),
    themeDNA: coerceThemeDNA(raw.themeDNA),
    coverImageDataUrl,
  };
}

export function countPageMarkers(rawText: string): number {
  const matches = [...rawText.matchAll(PAGE_MARKER_PATTERN)];
  PAGE_MARKER_PATTERN.lastIndex = 0;
  if (matches.length === 0) return 0;
  return Math.max(...matches.map((m) => Number(m[1]) || 0));
}

export function detectScannedPdfLikely(rawText: string, totalPages: number): boolean {
  if (totalPages < 3) return false;
  const cleanLength = rawText.replace(PAGE_MARKER_PATTERN, '').replace(/\s+/g, '').length;
  PAGE_MARKER_PATTERN.lastIndex = 0;
  const avgCharsPerPage = cleanLength / totalPages;
  return avgCharsPerPage < 40;
}

export function coerceChaptersIndex(
  raw: unknown,
  totalChars: number,
  totalPages = 0
): ChapterIndexEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ChapterIndexEntry[] = [];
  const seenChapters = new Set<number>();
  const effectivePages = Math.max(1, totalPages || Math.round(totalChars / 2200) || 100);
  const charsPerPage = Math.max(300, totalChars / effectivePages);

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    let chapterNumber = Number(rec.chapterNumber);
    if (!Number.isFinite(chapterNumber)) continue;
    chapterNumber = Math.max(1, Math.trunc(chapterNumber));
    while (seenChapters.has(chapterNumber)) {
      chapterNumber += 1;
    }
    seenChapters.add(chapterNumber);
    const startPage = Number.isFinite(Number(rec.startPage)) ? Number(rec.startPage) : 0;
    const endPage = Number.isFinite(Number(rec.endPage)) ? Number(rec.endPage) : startPage;
    const pageSpan = Math.max(1, endPage - startPage + 1);
    const estimatedChars = Math.max(400, Math.round(charsPerPage * pageSpan));
    entries.push({
      chapterNumber,
      title: String(rec.title ?? `Capitulo ${chapterNumber}`),
      startPage,
      endPage,
      estimatedChars,
      estimatedMicroLessons: Math.min(8, Math.max(4, Math.round(pageSpan / 6))),
      codeBlockCount: 0,
      estimatedCostUsd: 0,
      estimatedTimeSec: 0,
      selectionState: false,
      dbStatus: 'NOT_COMPILED',
    });
  }
  return entries.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

async function callOpenRouter(
  credentials: TocExtractorCredentials,
  frontMatter: string
): Promise<string> {
  const attempt = async (withJsonFormat: boolean): Promise<string> => {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.openrouterApiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://living-books.app',
        'X-Title': 'Universal Living Book Engine',
      },
      body: JSON.stringify({
        model: credentials.model,
        messages: [
          { role: 'system', content: TOC_EXTRACTION_SYSTEM_INSTRUCTION },
          { role: 'user', content: frontMatter },
        ],
        temperature: 0.1,
        ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Respuesta vacia del LLM (TOC).');
    return text;
  };

  try {
    return await attempt(true);
  } catch {
    // Algunos modelos no soportan response_format; reintenta sin el.
    return await attempt(false);
  }
}

async function callGemini(
  credentials: TocExtractorCredentials,
  frontMatter: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${credentials.model}:generateContent?key=${credentials.geminiApiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TOC_EXTRACTION_SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: frontMatter }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: BOOK_METADATA_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Respuesta vacia del LLM (TOC).');
  return text;
}

async function callOllama(
  credentials: TocExtractorCredentials,
  frontMatter: string
): Promise<string> {
  const base = credentials.ollamaBaseUrl || 'http://localhost:11434';
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: credentials.model.replace(/^ollama\//, ''),
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: TOC_EXTRACTION_SYSTEM_INSTRUCTION },
        { role: 'user', content: frontMatter },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { message?: { content?: string } };
  const text = data.message?.content;
  if (!text) throw new Error('Respuesta vacia de Ollama (TOC).');
  return text;
}

export function parseJsonLoose(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Extrae el primer objeto JSON balanceado (por si el LLM agrego prosa).
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('El LLM no devolvio JSON valido.');
  }
}

const METADATA_NOISE = /^(copyright|all rights|isbn|published|printed|table of contents|contents|edition|no starch|the pragmatic|©|http)/i;

/** Heuristica local para derivar metadatos del front-matter si el LLM falla. */
export function deriveMetadataHeuristic(frontMatter: string, totalChars: number): BookMetadataDraft {
  const lines = frontMatter.split('\n').map((l) => l.trim()).filter(Boolean);
  let title = '';
  for (const line of lines.slice(0, 40)) {
    if (line.length >= 4 && line.length <= 90 && !METADATA_NOISE.test(line) && !/^\d+$/.test(line)) {
      title = line;
      break;
    }
  }

  const authors: string[] = [];
  const byMatch = frontMatter.match(/\bby\s+([^\n]+)/i);
  if (byMatch) {
    const raw = byMatch[1].replace(/\b(copyright|isbn|published|printed|all rights)\b.*$/i, '');
    authors.push(
      ...raw
        .split(/\s*(?:,|and|&)\s*/i)
        .map((a) => a.replace(/[.;:].*$/, '').trim())
        .filter((a) => a.length > 1 && /[A-Za-z]/.test(a))
    );
  }

  return {
    title: title || 'Libro sin titulo',
    subtitle: '',
    authors: authors.length > 0 ? authors : ['Autor Desconocido'],
    year: new Date().getFullYear(),
    edition: '1st Edition',
    totalPages: 0,
    totalChars,
    difficulty: 'BEGINNER',
    coverAccentIcon: '📘',
    themeDNA: DEFAULT_THEME_DNA,
  };
}

/** Heuristica local para derivar el indice de capitulos si el LLM falla. */
export function deriveChaptersHeuristic(frontMatter: string, totalChars: number): ChapterIndexEntry[] {
  const entries: ChapterIndexEntry[] = [];
  const chapterPattern = /^(?:chapter|capitulo|capítulo)\s+(\d+)\b[.:\s]*(.*)$/i;
  const numberedPattern = /^(\d{1,2})[.\s]+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\s,:;\-]{2,70})$/;
  const markdownH1Pattern = /^#\s+(.{3,80})$/;

  for (const rawLine of frontMatter.split('\n')) {
    const line = rawLine.trim();
    const match = chapterPattern.exec(line) ?? numberedPattern.exec(line);
    if (match) {
      const number = Number(match[1]);
      if (!Number.isFinite(number) || number <= 0 || number > 60) continue;
      if (entries.some((e) => e.chapterNumber === number)) continue;
      entries.push({
        chapterNumber: number,
        title: (match[2] || `Capitulo ${number}`).trim(),
        startPage: 0,
        endPage: 0,
        estimatedChars: Math.max(400, Math.round(totalChars / 15)),
        estimatedMicroLessons: 6,
        codeBlockCount: 0,
        estimatedCostUsd: 0,
        estimatedTimeSec: 0,
        selectionState: false,
        dbStatus: 'NOT_COMPILED',
      });
    }
  }

  // Fallback para libros Markdown/EPUB con encabezados `# Titulo` sin numeracion
  if (entries.length === 0) {
    let mdChapter = 1;
    for (const rawLine of frontMatter.split('\n')) {
      const mdMatch = markdownH1Pattern.exec(rawLine.trim());
      if (!mdMatch) continue;
      entries.push({
        chapterNumber: mdChapter,
        title: mdMatch[1].trim(),
        startPage: 0,
        endPage: 0,
        estimatedChars: Math.max(400, Math.round(totalChars / 10)),
        estimatedMicroLessons: 5,
        codeBlockCount: 0,
        estimatedCostUsd: 0,
        estimatedTimeSec: 0,
        selectionState: false,
        dbStatus: 'NOT_COMPILED',
      });
      mdChapter += 1;
      if (mdChapter > 40) break;
    }
  }

  if (entries.length === 0) {
    entries.push({
      chapterNumber: 1,
      title: 'Contenido completo',
      startPage: 0,
      endPage: 0,
      estimatedChars: totalChars,
      estimatedMicroLessons: 6,
      codeBlockCount: 0,
      estimatedCostUsd: 0,
      estimatedTimeSec: 0,
      selectionState: false,
      dbStatus: 'NOT_COMPILED',
    });
  }

  return entries.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

/**
 * Fase 0: extrae metadatos + Indice Maestro de Capitulos con una unica llamada
 * estructurada al LLM sobre el front-matter del libro, con respaldo de metadatos
 * nativos (EPUB/PDF) y heuristicas locales.
 */
export async function extractMetadataAndToc(
  rawText: string,
  credentials: TocExtractorCredentials,
  options: TocExtractionOptions = {}
): Promise<TocExtractionResult> {
  const totalChars = rawText.length;
  const detectedPages = options.totalPages || countPageMarkers(rawText);
  const isScannedLikely = detectScannedPdfLikely(rawText, detectedPages);

  if (isScannedLikely) {
    options.onLog?.(
      `⚠️ Alerta: baja densidad de texto (${Math.round(totalChars / Math.max(1, detectedPages))} chars/pag en ${detectedPages} pags). Posible PDF escaneado.`
    );
  }

  const frontMatter = extractFrontMatter(
    rawText,
    options.maxFrontMatterChars ?? 18000,
    options.maxFrontMatterPages ?? 15
  );
  options.onLog?.(`Fase 0: enviando ${frontMatter.length} caracteres de front-matter al LLM.`);

  let raw = '';
  let parsed: Record<string, unknown> | null = null;
  try {
    if (credentials.provider === 'gemini') {
      raw = await callGemini(credentials, frontMatter);
    } else if (credentials.provider === 'ollama') {
      raw = await callOllama(credentials, frontMatter);
    } else {
      raw = await callOpenRouter(credentials, frontMatter);
    }
    parsed = parseJsonLoose(raw);
  } catch (err) {
    options.onLog?.(
      `Fase 0: el LLM fallo (${err instanceof Error ? err.message : String(err)}). Usando heuristica local.`
    );
  }

  // Algunos modelos anidan la respuesta bajo "metadata"/"book"; lo aplanamos.
  const root: Record<string, unknown> | null = parsed
    ? parsed.metadata && typeof parsed.metadata === 'object'
      ? { ...parsed, ...(parsed.metadata as Record<string, unknown>) }
      : parsed
    : null;

  const metadata = root
    ? coerceMetadata(root, totalChars, options.coverImageDataUrl)
    : deriveMetadataHeuristic(frontMatter, totalChars);

  // Respaldo prioritario con metadatos nativos del archivo (EPUB OPF / PDF Info)
  if (options.nativeMetadata) {
    if ((!metadata.title || metadata.title === 'Libro sin titulo') && options.nativeMetadata.title) {
      metadata.title = options.nativeMetadata.title;
    }
    if (
      (metadata.authors.length === 0 || metadata.authors[0] === 'Autor Desconocido') &&
      options.nativeMetadata.authors &&
      options.nativeMetadata.authors.length > 0
    ) {
      metadata.authors = options.nativeMetadata.authors;
    }
  }

  // Si aun faltan titulo/autores, los completa con la heuristica local.
  if (!metadata.title || metadata.title === 'Libro sin titulo' || metadata.authors[0] === 'Autor Desconocido') {
    const heuristic = deriveMetadataHeuristic(frontMatter, totalChars);
    if (!metadata.title || metadata.title === 'Libro sin titulo') metadata.title = heuristic.title;
    if (metadata.authors.length === 0 || metadata.authors[0] === 'Autor Desconocido') {
      metadata.authors = heuristic.authors;
    }
  }

  if (detectedPages > 0 && (!metadata.totalPages || metadata.totalPages <= 0)) {
    metadata.totalPages = detectedPages;
  }
  if (options.coverImageDataUrl) metadata.coverImageDataUrl = options.coverImageDataUrl;

  const effectiveTotalPages = metadata.totalPages || detectedPages;
  let chaptersIndex = root ? coerceChaptersIndex(root.chaptersIndex, totalChars, effectiveTotalPages) : [];
  if (chaptersIndex.length === 0) {
    // Si el archivo es Markdown sin front-matter de TOC, escanear encabezados sobre mas texto
    const scanSample = rawText.length > frontMatter.length ? rawText.slice(0, 120_000) : frontMatter;
    chaptersIndex = deriveChaptersHeuristic(scanSample, totalChars);
    options.onLog?.(`Fase 0: indice no detectado por el LLM; heuristica genero ${chaptersIndex.length} capitulos.`);
  }
  options.onLog?.(`Fase 0: ${chaptersIndex.length} capitulos detectados en el indice.`);

  return { metadata, chaptersIndex, rawLlmResponse: raw, isScannedLikely };
}

// --- SEGMENTADOR ROBUSTO BASADO EN EL INDICE DETECTADO ---

const MIN_SECTION_CHARS = 200;
const MAX_SECTION_CHARS = 9000;
const MIN_MICRO_LESSONS = 4;
const MAX_MICRO_LESSONS = 8;

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Localiza la posicion (offset) del titulo o pagina inicial de un capitulo dentro del texto. */
function findChapterAnchor(text: string, chapter: ChapterIndexEntry): number {
  const normalizedTitle = normalizeForMatch(chapter.title);
  if (normalizedTitle) {
    const haystack = normalizeForMatch(text);
    const direct = haystack.indexOf(normalizedTitle);
    if (direct >= 0) {
      return approximateOriginalOffset(text, normalizedTitle);
    }
  }

  // Fallback 1: buscar "chapter N" / "capitulo N".
  const chapterPattern = new RegExp(`(?:chapter|capitulo|capítulo)\\s+${chapter.chapterNumber}\\b`, 'i');
  const match = chapterPattern.exec(text);
  if (match) return match.index;

  // Fallback 2: marcador de pagina real `--- page N ---` cuando startPage > 0
  if (chapter.startPage > 0) {
    const pageMarker = new RegExp(`(?:^|\\n)\\s*-{2,}\\s*page\\s+${chapter.startPage}\\s*-{2,}`, 'i');
    const pageMatch = pageMarker.exec(text);
    if (pageMatch) return pageMatch.index;
  }

  return -1;
}

function approximateOriginalOffset(text: string, normalizedTitle: string): number {
  const words = normalizedTitle.split(' ').filter(Boolean).slice(0, 4);
  if (words.length === 0) return -1;
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]{0,40}'), 'i');
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

interface SubHeading {
  index: number;
  title: string;
}

function findSubHeadings(body: string): SubHeading[] {
  const headings: SubHeading[] = [];
  const lines = body.split('\n');
  let offset = 0;
  for (const line of lines) {
    const md = line.match(/^(#{2,4})\s+(.+)$/);
    const numbered = line.match(/^(\d+\.\d+(?:\.\d+)?)\s+([A-Z].{2,80})$/);
    if (md) {
      headings.push({ index: offset, title: md[2].trim() });
    } else if (numbered) {
      headings.push({ index: offset, title: `${numbered[1]} ${numbered[2].trim()}` });
    }
    offset += line.length + 1;
  }
  return headings;
}

function splitByParagraphs(body: string, targetCount: number): string[] {
  const paragraphs = body.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [body];
  const perChunk = Math.max(1, Math.ceil(paragraphs.length / targetCount));
  const groups: string[] = [];
  for (let i = 0; i < paragraphs.length; i += perChunk) {
    groups.push(paragraphs.slice(i, i + perChunk).join('\n\n'));
  }
  return groups;
}

/**
 * Agrupa el cuerpo de un capitulo en 4 a 8 micro-lecciones pedagogicas.
 * Si el capitulo tiene sub-encabezados claros, los respeta; en caso contrario
 * agrupa parrafos relacionados por tamano objetivo.
 */
export function splitChapterIntoMicroLessons(
  body: string,
  chapterNumber: number,
  chapterTitle: string,
  targetCount: number
): SectionChunk[] {
  const cleanBody = cleanText(body);
  if (cleanBody.length < MIN_SECTION_CHARS) return [];

  const desired = Math.min(MAX_MICRO_LESSONS, Math.max(MIN_MICRO_LESSONS, targetCount));
  const headings = findSubHeadings(cleanBody);

  const chunks: SectionChunk[] = [];
  const pushChunk = (title: string, text: string, index: number) => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_SECTION_CHARS) return;
    chunks.push({
      sectionId: `ch${chapterNumber}-sec${index}`,
      chapterNumber,
      chapterTitle,
      sectionTitle: title,
      text: trimmed.slice(0, MAX_SECTION_CHARS),
      codeSnippets: extractCodeSnippets(trimmed),
    });
  };

  if (headings.length >= MIN_MICRO_LESSONS && headings.length <= MAX_MICRO_LESSONS) {
    for (let i = 0; i < headings.length; i += 1) {
      // La primera leccion incluye la introduccion previa al primer subtitulo.
      const start = i === 0 ? 0 : headings[i].index;
      const end = i + 1 < headings.length ? headings[i + 1].index : cleanBody.length;
      pushChunk(headings[i].title, cleanBody.slice(start, end), i + 1);
    }
    return chunks;
  }

  const groups = splitByParagraphs(cleanBody, desired);
  groups.forEach((group, i) => {
    const firstLine = group.split('\n').find((l) => l.trim().length > 0) ?? '';
    const title = firstLine.trim().slice(0, 70) || `${chapterTitle} (${i + 1})`;
    pushChunk(title, group, i + 1);
  });

  return chunks;
}

export interface SegmentBookOptions {
  /** Si se indica, solo se segmentan estos numeros de capitulo. */
  selectedChapterNumbers?: number[];
  onLog?: (line: string) => void;
}

/**
 * Corta el libro completo en micro-lecciones usando el Indice Maestro detectado.
 * Devuelve 4 a 8 micro-lecciones por capitulo (nunca 27 fragmentos sueltos).
 */
export function segmentBookByIndex(
  rawText: string,
  chaptersIndex: ChapterIndexEntry[],
  options: SegmentBookOptions = {}
): SectionChunk[] {
  const text = cleanText(rawText);
  const selected = options.selectedChapterNumbers
    ? new Set(options.selectedChapterNumbers)
    : null;

  const ordered = [...chaptersIndex].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const anchors = ordered.map((chapter) => ({
    chapter,
    pos: findChapterAnchor(text, chapter),
  }));

  const located = anchors.filter((a) => a.pos >= 0).sort((a, b) => a.pos - b.pos);
  const chunks: SectionChunk[] = [];

  if (located.length === 0) {
    options.onLog?.('Segmentador: no se hallaron anclas de capitulo; usando reparto proporcional.');
    return segmentByProportionalSplit(text, ordered, selected, options);
  }

  for (let i = 0; i < located.length; i += 1) {
    const { chapter, pos } = located[i];
    if (selected && !selected.has(chapter.chapterNumber)) continue;
    const end = i + 1 < located.length ? located[i + 1].pos : text.length;
    const body = text.slice(pos, end);
    const lessons = splitChapterIntoMicroLessons(
      body,
      chapter.chapterNumber,
      chapter.title,
      chapter.estimatedMicroLessons
    );
    chunks.push(...lessons);
    options.onLog?.(`Capitulo ${chapter.chapterNumber}: ${lessons.length} micro-lecciones.`);
  }

  return chunks;
}

function segmentByProportionalSplit(
  text: string,
  chaptersIndex: ChapterIndexEntry[],
  selected: Set<number> | null,
  options: SegmentBookOptions
): SectionChunk[] {
  const totalEstimated = chaptersIndex.reduce((acc, c) => acc + c.estimatedChars, 0) || text.length;
  const chunks: SectionChunk[] = [];
  let cursor = 0;

  for (const chapter of chaptersIndex) {
    const share = Math.round((chapter.estimatedChars / totalEstimated) * text.length);
    const start = cursor;
    const end = Math.min(text.length, cursor + share);
    cursor = end;
    if (selected && !selected.has(chapter.chapterNumber)) continue;
    const body = text.slice(start, end);
    const lessons = splitChapterIntoMicroLessons(
      body,
      chapter.chapterNumber,
      chapter.title,
      chapter.estimatedMicroLessons
    );
    chunks.push(...lessons);
    options.onLog?.(`Capitulo ${chapter.chapterNumber} (proporcional): ${lessons.length} micro-lecciones.`);
  }

  return chunks;
}
