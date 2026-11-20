import { unzipSync, strFromU8 } from 'fflate';
import { extractPdfInWorker } from './pdfExtractor';

export type BookSourceFormat = 'pdf' | 'epub' | 'markdown' | 'text';

export interface BookSourceExtractionProgress {
  phase: 'READING';
  current: number;
  total: number;
  detail: string;
}

export interface BookSourceNativeMetadata {
  title?: string;
  authors?: string[];
  language?: string;
}

export interface NativeChapterEntry {
  chapterNumber: number;
  title: string;
  startPage: number;
  endPage: number;
}

export interface BookSourceExtractionResult {
  format: BookSourceFormat;
  text: string;
  totalPages: number;
  coverDataUrl: string | null;
  nativeMetadata?: BookSourceNativeMetadata;
  nativeChapters?: NativeChapterEntry[];
}

export function detectBookFormat(fileName: string): BookSourceFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'text';
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#0*39);/gi, "'")
    .replace(/&(mdash|#0*8212|#x2014);/gi, '—')
    .replace(/&(ndash|#0*8211|#x2013);/gi, '–')
    .replace(/&(hellip|#0*8230|#x2026);/gi, '...')
    .replace(/&(lsquo|rsquo|#0*8216|#0*8217);/gi, "'")
    .replace(/&(ldquo|rdquo|#0*8220|#0*8221);/gi, '"')
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function stripSimpleHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePythonSnippet(code: string): boolean {
  return /^\s*(def |class |import |from |for |while |if |elif |else:|try:|except|with |return |print\(|>>>|\w+\s*=)/m.test(
    code
  );
}

/**
 * Convierte XHTML/HTML de un EPUB en texto estructurado conservando:
 *  - Bloques `<pre>` completos con su indentacion Python intacta (` ```python `).
 *  - Encabezados `<h1>..<h4>` como `#`, `##`, `###`.
 *  - Saltos de parrafo y elementos de lista limpios.
 */
export function htmlToStructuredBookText(html: string): string {
  const codeBlocks: string[] = [];
  let work = html
    .replace(/<\?xml[\s\S]*?\?>/gi, ' ')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');

  // Extraer bloques <pre>...</pre> ANTES de normalizar espacios para proteger indentacion Python
  work = work.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
    const rawCode = decodeHtmlEntities(
      inner
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    )
      .replace(/\r\n/g, '\n')
      .replace(/^\n+|\n+$/g, '');

    if (!rawCode.trim()) return '\n\n';
    const lang = looksLikePythonSnippet(rawCode) ? 'python' : '';
    const token = `__ULB_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`\`\`\`${lang}\n${rawCode}\n\`\`\``);
    return `\n\n${token}\n\n`;
  });

  // Convertir encabezados a Markdown
  work = work
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner: string) => {
      const t = stripSimpleHtml(inner);
      return t ? `\n\n# ${t}\n\n` : '\n\n';
    })
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner: string) => {
      const t = stripSimpleHtml(inner);
      return t ? `\n\n## ${t}\n\n` : '\n\n';
    })
    .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, (_m, inner: string) => {
      const t = stripSimpleHtml(inner);
      return t ? `\n\n### ${t}\n\n` : '\n\n';
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|tr|table|ul|ol|figure|figcaption)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  let text = decodeHtmlEntities(work)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  for (let i = 0; i < codeBlocks.length; i += 1) {
    text = text.replace(`__ULB_CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeZipKey(path: string): string {
  return safeDecode(path).replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

function findZipEntry(files: Record<string, Uint8Array>, targetPath: string): Uint8Array | undefined {
  if (files[targetPath]) return files[targetPath];
  const normalized = normalizeZipKey(targetPath);
  if (files[normalized]) return files[normalized];
  const lower = normalized.toLowerCase();
  for (const [key, value] of Object.entries(files)) {
    if (normalizeZipKey(key).toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

function resolveZipPath(baseDir: string, href: string): string {
  const cleanHref = safeDecode(href.split('#')[0]).replace(/\\/g, '/');
  if (cleanHref.startsWith('/')) return cleanHref.replace(/^\/+/, '');
  const parts = (baseDir ? `${baseDir}/${cleanHref}` : cleanHref).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = tag.match(re);
  return match ? match[1] : null;
}

const EPUB_STRUCTURAL_RE = /\.(xml|opf|ncx|xhtml|html|htm|txt|smil)$/i;
const EPUB_HEAVY_ASSET_RE = /\.(ttf|otf|woff2?|eot|mp[34]|m4[av]|ogg|wav|webm|mov|avi)$/i;

/**
 * Divide un texto XHTML largo en sub-paginas logicas (~2800 chars en limites de parrafo)
 * sin partir bloques de codigo ```...``` ni alterar capitulos cortos (< 3600 chars).
 */
function splitLongSectionIntoPages(text: string, targetChars = 2800): string[] {
  if (text.length <= 3600) return [text];

  const paragraphs: string[] = [];
  const rawParts = text.split(/\n\n+/);
  let fenceBuffer = '';
  let insideFence = false;

  for (const part of rawParts) {
    const fenceToggles = (part.match(/```/g) ?? []).length;
    if (!insideFence) {
      if (fenceToggles % 2 === 1) {
        insideFence = true;
        fenceBuffer = part;
      } else {
        paragraphs.push(part);
      }
    } else {
      fenceBuffer += `\n\n${part}`;
      if (fenceToggles % 2 === 1) {
        insideFence = false;
        paragraphs.push(fenceBuffer);
        fenceBuffer = '';
      }
    }
  }
  if (fenceBuffer) paragraphs.push(fenceBuffer);

  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > targetChars) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

const TOC_NOISE_TITLE_RE =
  /^(cover|title\s*page|copyright|dedication|table\s*of\s*contents|contents|indice|índice|portada|acknowledg|about\s*the\s*author|colophon|index|glossary|appendix)/i;

function extractTocEntriesFromNcxOrNav(
  files: Record<string, Uint8Array>,
  opfDir: string,
  opfXml: string,
  manifest: Map<string, { href: string; mediaType: string; properties: string }>,
  spineStartPageByPath: Map<string, number>,
  totalPages: number
): NativeChapterEntry[] {
  const rawEntries: Array<{ title: string; fullPath: string }> = [];

  // 1. Intentar EPUB 3 Nav XHTML (properties="nav")
  let navItem: { href: string } | undefined;
  for (const item of manifest.values()) {
    if (/\bnav\b/i.test(item.properties)) {
      navItem = item;
      break;
    }
  }
  if (navItem) {
    const navPath = resolveZipPath(opfDir, navItem.href);
    const navDir = navPath.includes('/') ? navPath.slice(0, navPath.lastIndexOf('/')) : '';
    const navBytes = findZipEntry(files, navPath);
    if (navBytes) {
      const navHtml = strFromU8(navBytes);
      const tocBlock =
        navHtml.match(/<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ??
        navHtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1] ??
        '';
      for (const link of tocBlock.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const title = stripSimpleHtml(link[2]);
        const target = resolveZipPath(navDir, link[1]);
        if (title && target) rawEntries.push({ title, fullPath: target });
      }
    }
  }

  // 2. Respaldo EPUB 2 NCX (`toc.ncx`)
  if (rawEntries.length === 0) {
    const spineTocId = extractAttr(opfXml.match(/<spine\b([^>]*)>/i)?.[1] ?? '', 'toc');
    const ncxItem =
      (spineTocId ? manifest.get(spineTocId) : undefined) ??
      [...manifest.values()].find((m) => m.mediaType.toLowerCase().includes('ncx'));
    if (ncxItem) {
      const ncxPath = resolveZipPath(opfDir, ncxItem.href);
      const ncxDir = ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/')) : '';
      const ncxBytes = findZipEntry(files, ncxPath);
      if (ncxBytes) {
        const ncxXml = strFromU8(ncxBytes);
        const navMap = ncxXml.match(/<navMap\b[^>]*>([\s\S]*?)<\/navMap>/i)?.[1] ?? ncxXml;
        for (const np of navMap.matchAll(
          /<navPoint\b[^>]*>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi
        )) {
          const title = stripSimpleHtml(np[1]);
          const target = resolveZipPath(ncxDir, np[2]);
          if (title && target) rawEntries.push({ title, fullPath: target });
        }
      }
    }
  }

  if (rawEntries.length === 0) return [];

  // Mapear a startPage evitando duplicar multiples anclas #id dentro de la misma pagina de capitulo
  const mapped: Array<{ title: string; startPage: number }> = [];
  const seenStartPages = new Set<number>();
  for (const entry of rawEntries) {
    const startPage = spineStartPageByPath.get(normalizeZipKey(entry.fullPath).toLowerCase());
    if (!startPage || seenStartPages.has(startPage)) continue;
    seenStartPages.add(startPage);
    mapped.push({ title: entry.title, startPage });
  }

  const substantive = mapped.filter((m) => !TOC_NOISE_TITLE_RE.test(m.title));
  const selected = substantive.length >= 2 ? substantive : mapped;
  if (selected.length === 0) return [];

  selected.sort((a, b) => a.startPage - b.startPage);
  return selected.map((item, idx) => {
    const nextStart = idx + 1 < selected.length ? selected[idx + 1].startPage - 1 : totalPages;
    return {
      chapterNumber: idx + 1,
      title: item.title.slice(0, 120),
      startPage: item.startPage,
      endPage: Math.max(item.startPage, nextStart),
    };
  });
}

export function extractEpubFromBuffer(
  buffer: ArrayBuffer,
  onProgress?: (progress: BookSourceExtractionProgress) => void
): BookSourceExtractionResult {
  const zipBytes = new Uint8Array(buffer);
  const largeEpub = zipBytes.byteLength > 8 * 1024 * 1024;
  const files = unzipSync(zipBytes, {
    filter: (file) => {
      if (EPUB_HEAVY_ASSET_RE.test(file.name)) return false;
      if (largeEpub) {
        return (
          file.name.toLowerCase() === 'meta-inf/container.xml' ||
          EPUB_STRUCTURAL_RE.test(file.name)
        );
      }
      return true;
    },
  });

  const containerBytes = findZipEntry(files, 'META-INF/container.xml');
  if (!containerBytes) {
    throw new Error('El archivo EPUB no contiene META-INF/container.xml valido.');
  }

  const containerXml = strFromU8(containerBytes);
  const opfMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!opfMatch) {
    throw new Error('No se encontro la ruta del paquete OPF en el EPUB.');
  }

  const opfPath = normalizeZipKey(opfMatch[1]);
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfBytes = findZipEntry(files, opfPath);
  if (!opfBytes) {
    throw new Error(`No se encontro el archivo OPF: ${opfPath}`);
  }
  const opfXml = strFromU8(opfBytes);

  // Metadatos Dublin Core
  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatches = [...opfXml.matchAll(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/gi)];
  const languageMatch = opfXml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);
  const title = titleMatch ? stripSimpleHtml(titleMatch[1]) : undefined;
  const authors = creatorMatches.map((m) => stripSimpleHtml(m[1])).filter(Boolean);
  const language = languageMatch ? stripSimpleHtml(languageMatch[1]) : undefined;

  // Manifest: id -> { href, mediaType, properties }
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const itemMatch of opfXml.matchAll(/<(?:[a-z0-9_-]+:)?item\b([^>]+?)\/?>/gi)) {
    const attrs = itemMatch[1];
    const id = extractAttr(attrs, 'id');
    const href = extractAttr(attrs, 'href');
    const mediaType = extractAttr(attrs, 'media-type') ?? '';
    const properties = extractAttr(attrs, 'properties') ?? '';
    if (id && href) {
      manifest.set(id, { href, mediaType, properties });
    }
  }

  // Portada del EPUB
  let coverDataUrl: string | null = null;
  let coverItem: { href: string; mediaType: string } | undefined;
  for (const item of manifest.values()) {
    if (/\bcover-image\b/i.test(item.properties)) {
      coverItem = item;
      break;
    }
  }
  if (!coverItem) {
    const metaCoverMatch =
      opfXml.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i) ??
      opfXml.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']cover["']/i);
    if (metaCoverMatch) {
      coverItem = manifest.get(metaCoverMatch[1]);
    }
  }
  if (coverItem) {
    const coverPath = resolveZipPath(opfDir, coverItem.href);
    let coverBytes = findZipEntry(files, coverPath);
    if (!coverBytes && largeEpub) {
      const targetLower = normalizeZipKey(coverPath).toLowerCase();
      const single = unzipSync(zipBytes, {
        filter: (f) => normalizeZipKey(f.name).toLowerCase() === targetLower,
      });
      coverBytes = findZipEntry(single, coverPath);
    }
    if (coverBytes && coverBytes.length > 0 && coverBytes.length < 6 * 1024 * 1024) {
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < coverBytes.length; i += chunkSize) {
        binary += String.fromCharCode(...coverBytes.subarray(i, i + chunkSize));
      }
      const mime = coverItem.mediaType.startsWith('image/') ? coverItem.mediaType : 'image/jpeg';
      if (mime !== 'image/svg+xml') {
        coverDataUrl = `data:${mime};base64,${btoa(binary)}`;
      }
    }
  }

  // Spine ordenado
  const spineIds: string[] = [];
  for (const itemref of opfXml.matchAll(/<(?:[a-z0-9_-]+:)?itemref\b([^>]+?)\/?>/gi)) {
    const idref = extractAttr(itemref[1], 'idref');
    if (idref) spineIds.push(idref);
  }

  const pages: string[] = [];
  const spineStartPageByPath = new Map<string, number>();
  const total = spineIds.length;
  for (let i = 0; i < spineIds.length; i += 1) {
    const item = manifest.get(spineIds[i]);
    if (!item) continue;
    const fullPath = resolveZipPath(opfDir, item.href);
    const bytes = findZipEntry(files, fullPath);
    if (!bytes) continue;
    const structured = htmlToStructuredBookText(strFromU8(bytes));
    if (structured.length > 0) {
      const startPage = pages.length + 1;
      spineStartPageByPath.set(normalizeZipKey(fullPath).toLowerCase(), startPage);
      const subPages = splitLongSectionIntoPages(structured);
      for (const sub of subPages) {
        pages.push(`--- page ${pages.length + 1} ---\n${sub}`);
      }
    }
    onProgress?.({
      phase: 'READING',
      current: i + 1,
      total,
      detail: `Extrayendo seccion EPUB ${i + 1} de ${total}...`,
    });
  }

  const nativeChapters = extractTocEntriesFromNcxOrNav(
    files,
    opfDir,
    opfXml,
    manifest,
    spineStartPageByPath,
    pages.length
  );

  return {
    format: 'epub',
    text: pages.join('\n\n'),
    totalPages: pages.length,
    coverDataUrl,
    nativeMetadata: {
      title,
      authors: authors.length > 0 ? authors : undefined,
      language,
    },
    nativeChapters: nativeChapters.length > 0 ? nativeChapters : undefined,
  };
}

async function extractTextStream(
  file: File,
  format: 'markdown' | 'text',
  onProgress?: (progress: BookSourceExtractionProgress) => void
): Promise<BookSourceExtractionResult> {
  if (typeof file.stream !== 'function') {
    const text = await file.text();
    return { format, text, totalPages: Math.max(1, Math.ceil(text.length / 2500)), coverDataUrl: null };
  }

  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let loaded = 0;
  const total = Math.max(1, file.size);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      loaded += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      onProgress?.({
        phase: 'READING',
        current: loaded,
        total,
        detail: `Leyendo archivo (${Math.round((loaded / total) * 100)}%)...`,
      });
    }
  }
  chunks.push(decoder.decode());
  const text = chunks.join('');
  return {
    format,
    text,
    totalPages: Math.max(1, Math.ceil(text.length / 2500)),
    coverDataUrl: null,
  };
}

export async function extractBookSource(
  file: File,
  onProgress?: (progress: BookSourceExtractionProgress) => void
): Promise<BookSourceExtractionResult> {
  const format = detectBookFormat(file.name);

  if (format === 'pdf') {
    let lastTotal = 0;
    const result = await extractPdfInWorker(
      file,
      ({ page, total }) => {
        lastTotal = total;
        onProgress?.({
          phase: 'READING',
          current: page,
          total,
          detail: `Extrayendo PDF: pagina ${page} de ${total}...`,
        });
      },
      { wantCover: true }
    );
    return {
      format: 'pdf',
      text: result.text,
      totalPages: lastTotal || Math.max(1, Math.ceil(result.text.length / 2500)),
      coverDataUrl: result.coverDataUrl,
    };
  }

  if (format === 'epub') {
    const buffer = await file.arrayBuffer();
    return extractEpubFromBuffer(buffer, onProgress);
  }

  return extractTextStream(file, format, onProgress);
}
