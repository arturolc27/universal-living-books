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

export interface BookSourceExtractionResult {
  format: BookSourceFormat;
  text: string;
  totalPages: number;
  coverDataUrl: string | null;
  nativeMetadata?: BookSourceNativeMetadata;
}

export function detectBookFormat(fileName: string): BookSourceFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'text';
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveZipPath(baseDir: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split('#')[0]);
  if (!baseDir) return cleanHref.replace(/^\/+/, '');
  const parts = `${baseDir}/${cleanHref}`.split('/');
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

export function extractEpubFromBuffer(
  buffer: ArrayBuffer,
  onProgress?: (progress: BookSourceExtractionProgress) => void
): BookSourceExtractionResult {
  const files = unzipSync(new Uint8Array(buffer));
  const containerBytes = files['META-INF/container.xml'];
  if (!containerBytes) {
    throw new Error('El archivo EPUB no contiene META-INF/container.xml valido.');
  }

  const containerXml = strFromU8(containerBytes);
  const opfMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!opfMatch) {
    throw new Error('No se encontro la ruta del paquete OPF en el EPUB.');
  }

  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfBytes = files[opfPath];
  if (!opfBytes) {
    throw new Error(`No se encontro el archivo OPF: ${opfPath}`);
  }
  const opfXml = strFromU8(opfBytes);

  // Metadatos Dublin Core
  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatches = [...opfXml.matchAll(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/gi)];
  const languageMatch = opfXml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]) : undefined;
  const authors = creatorMatches.map((m) => stripHtmlTags(m[1])).filter(Boolean);
  const language = languageMatch ? stripHtmlTags(languageMatch[1]) : undefined;

  // Manifest: id -> { href, mediaType, properties }
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const itemMatch of opfXml.matchAll(/<item\b([^>]+?)\/?>/gi)) {
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
    if (item.properties.includes('cover-image')) {
      coverItem = item;
      break;
    }
  }
  if (!coverItem) {
    const metaCoverMatch = opfXml.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i);
    if (metaCoverMatch) {
      coverItem = manifest.get(metaCoverMatch[1]);
    }
  }
  if (coverItem) {
    const coverPath = resolveZipPath(opfDir, coverItem.href);
    const coverBytes = files[coverPath];
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
  for (const itemref of opfXml.matchAll(/<itemref\b([^>]+?)\/?>/gi)) {
    const idref = extractAttr(itemref[1], 'idref');
    if (idref) spineIds.push(idref);
  }

  const pages: string[] = [];
  const total = spineIds.length;
  for (let i = 0; i < spineIds.length; i += 1) {
    const item = manifest.get(spineIds[i]);
    if (!item) continue;
    const fullPath = resolveZipPath(opfDir, item.href);
    const bytes = files[fullPath];
    if (!bytes) continue;
    const plain = stripHtmlTags(strFromU8(bytes));
    if (plain.length > 0) {
      pages.push(`--- page ${pages.length + 1} ---\n${plain}`);
    }
    onProgress?.({
      phase: 'READING',
      current: i + 1,
      total,
      detail: `Extrayendo seccion EPUB ${i + 1} de ${total}...`,
    });
  }

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
