import type { MemoryStep } from '../../types/cartridge.types';

export interface SectionChunk {
  sectionId: string;
  chapterNumber: number;
  chapterTitle: string;
  sectionTitle: string;
  text: string;
  codeSnippets: string[];
}

const NOISE_PATTERNS: RegExp[] = [
  /report erratum/i,
  /discuss this/i,
  /^\s*\d+\s*$/,
  /^\s*chapter\s+\d+\s*$/i,
  /^\s*copyright\s+\d{4}/i,
  /^\s*all rights reserved/i,
];

const MIN_SECTION_CHARS = 200;
const MAX_SECTION_CHARS = 9000;

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return NOISE_PATTERNS.some((p) => p.test(trimmed));
}

export function cleanText(raw: string): string {
  const lines = raw.split(/\r?\n/).filter((ln) => !isNoiseLine(ln));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractCodeSnippets(text: string): string[] {
  const snippets: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fencePython = true;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        if (current.length > 0) {
          snippets.push(current.join('\n'));
          current = [];
        }
        const lang = trimmed.slice(3).trim().toLowerCase();
        fencePython = !lang || lang === 'python' || lang === 'py' || lang === 'pycon';
        inFence = true;
      } else {
        if (fencePython && current.length > 0) {
          snippets.push(current.join('\n'));
        }
        current = [];
        inFence = false;
      }
      continue;
    }

    if (inFence) {
      if (fencePython) current.push(line);
      continue;
    }

    const looksLikeCode =
      trimmed.startsWith('>>>') ||
      line.startsWith('    ') ||
      /^\s*(def |class |import |from )/.test(line);
    if (looksLikeCode) {
      current.push(line);
    } else if (current.length > 0) {
      snippets.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0 && (!inFence || fencePython)) {
    snippets.push(current.join('\n'));
  }
  return snippets.filter((s) => s.trim().length > 12);
}

interface HeadingMatch {
  index: number;
  level: number;
  title: string;
}

function findHeadings(text: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    const md = line.match(/^(#{1,3})\s+(.+)$/);
    const numbered = line.match(/^(\d+(?:\.\d+)*)\s+([A-Z].{2,80})$/);
    if (md) {
      headings.push({ index: offset, level: md[1].length, title: md[2].trim() });
    } else if (numbered) {
      headings.push({ index: offset, level: numbered[1].split('.').length, title: numbered[2].trim() });
    }
    offset += line.length + 1;
  }
  return headings;
}

/**
 * Client-side port of 01_semantic_chunker.py. Splits raw book text into clean
 * micro-sections ready for the LLM compiler.
 */
export function chunkText(rawText: string): SectionChunk[] {
  const text = cleanText(rawText);
  const headings = findHeadings(text);
  const chunks: SectionChunk[] = [];

  if (headings.length === 0) {
    const paragraphs = text.split(/\n\n+/);
    let buffer = '';
    let sectionIndex = 1;
    for (const para of paragraphs) {
      buffer += (buffer ? '\n\n' : '') + para;
      if (buffer.length >= MIN_SECTION_CHARS) {
        chunks.push({
          sectionId: `sec-${sectionIndex}`,
          chapterNumber: 1,
          chapterTitle: 'Contenido',
          sectionTitle: `Seccion ${sectionIndex}`,
          text: buffer.slice(0, MAX_SECTION_CHARS),
          codeSnippets: extractCodeSnippets(buffer),
        });
        buffer = '';
        sectionIndex += 1;
      }
    }
    if (buffer.trim().length > 0) {
      chunks.push({
        sectionId: `sec-${sectionIndex}`,
        chapterNumber: 1,
        chapterTitle: 'Contenido',
        sectionTitle: `Seccion ${sectionIndex}`,
        text: buffer.slice(0, MAX_SECTION_CHARS),
        codeSnippets: extractCodeSnippets(buffer),
      });
    }
    return chunks;
  }

  let chapterNumber = 0;
  let chapterTitle = 'Introduccion';

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const nextIndex = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const body = text.slice(heading.index, nextIndex).trim();

    if (heading.level === 1) {
      chapterTitle = heading.title;
      const numMatch = heading.title.match(/(\d+)/);
      chapterNumber = numMatch ? Number(numMatch[1]) : chapterNumber + 1;
      continue;
    }

    if (body.length < MIN_SECTION_CHARS) continue;

    chunks.push({
      sectionId: `ch${chapterNumber}-sec${chunks.length + 1}`,
      chapterNumber,
      chapterTitle,
      sectionTitle: heading.title,
      text: body.slice(0, MAX_SECTION_CHARS),
      codeSnippets: extractCodeSnippets(body),
    });
  }

  return chunks;
}

export interface TracedSnippet {
  sectionId: string;
  snippetIndex: number;
  code: string;
  memorySteps: MemoryStep[];
}

export function normalizeSnippet(snippet: string): string {
  return snippet
    .split('\n')
    .map((line) => (line.startsWith('>>> ') ? line.slice(4) : line))
    .join('\n');
}