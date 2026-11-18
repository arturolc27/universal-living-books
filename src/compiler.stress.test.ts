import { describe, expect, it } from 'vitest';
import { analyzeSnippetStatic, normalizeSnippetCode } from './engine/compiler/snippetStaticFilter';
import {
  coerceChaptersIndex,
  coerceMetadata,
  deriveChaptersHeuristic,
  deriveMetadataHeuristic,
  extractFrontMatter,
  parseJsonLoose,
  segmentBookByIndex,
  splitChapterIntoMicroLessons,
} from './engine/compiler/metadataTocExtractor';
import { sanitizeLesson } from './engine/compiler/lessonSanitizer';
import type { ChapterIndexEntry } from './types/compiler.types';

// --- FIXTURES ---

function buildSyntheticBook(chapterCount: number): { text: string; index: ChapterIndexEntry[] } {
  const parts: string[] = [];
  const index: ChapterIndexEntry[] = [];
  for (let n = 1; n <= chapterCount; n += 1) {
    const title = `Chapter ${n} Topic Number ${n}`;
    parts.push(title);
    for (let s = 1; s <= 6; s += 1) {
      parts.push(`${n}.${s} Subtopic ${s}`);
      parts.push('Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(12));
    }
    index.push({
      chapterNumber: n,
      title,
      startPage: n * 10,
      endPage: n * 10 + 9,
      estimatedChars: 2000,
      estimatedMicroLessons: 6,
      codeBlockCount: 0,
      estimatedCostUsd: 0,
      estimatedTimeSec: 0,
      selectionState: false,
      dbStatus: 'NOT_COMPILED',
    });
  }
  return { text: parts.join('\n\n'), index };
}

// --- FILTRO ESTATICO AST ---

describe('analyzeSnippetStatic (filtro AST pre-ejecucion)', () => {
  it('descarta errores de sintaxis intencionales', () => {
    expect(analyzeSnippetStatic('2 +').safe).toBe(false);
    expect(analyzeSnippetStatic('12 = x').safe).toBe(false);
    expect(analyzeSnippetStatic('x =').safe).toBe(false);
    expect(analyzeSnippetStatic('print((1, 2)').safe).toBe(false);
  });

  it('descarta llamadas bloqueantes o externas', () => {
    expect(analyzeSnippetStatic('name = input("Nombre: ")').safe).toBe(false);
    expect(analyzeSnippetStatic('f = open("data.txt")').safe).toBe(false);
    expect(analyzeSnippetStatic('import os').safe).toBe(false);
    expect(analyzeSnippetStatic('from math import sqrt').safe).toBe(false);
    expect(analyzeSnippetStatic('while True:\n    pass').safe).toBe(false);
  });

  it('descarta expresiones triviales de una linea', () => {
    const verdict = analyzeSnippetStatic('4 + 13');
    expect(verdict.safe).toBe(false);
    expect(verdict.trivial).toBe(true);
    expect(analyzeSnippetStatic('').trivial).toBe(true);
  });

  it('acepta codigo con cambios de estado', () => {
    expect(analyzeSnippetStatic('x = 5').safe).toBe(true);
    expect(analyzeSnippetStatic('def f():\n    return 1').safe).toBe(true);
    expect(analyzeSnippetStatic('nums = [1, 2, 3]\nnums.append(4)').safe).toBe(true);
    expect(analyzeSnippetStatic('for i in range(3):\n    print(i)').safe).toBe(true);
    expect(analyzeSnippetStatic('total = 0\nfor n in [1, 2, 3]:\n    total += n').safe).toBe(true);
  });

  it('normaliza prompts de REPL', () => {
    expect(normalizeSnippetCode('>>> x = 5')).toBe('x = 5');
    expect(normalizeSnippetCode('...     return 1')).toBe('    return 1');
    expect(analyzeSnippetStatic('>>> x = 5').safe).toBe(true);
  });

  it('no se cuelga con entradas grandes (stress)', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `v${i} = ${i}`).join('\n');
    const started = Date.now();
    const verdict = analyzeSnippetStatic(big);
    expect(verdict.safe).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// --- PARSEO Y COERCION DE METADATOS ---

describe('parseJsonLoose', () => {
  it('limpia fences de markdown', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extrae el objeto JSON aunque haya prosa alrededor', () => {
    expect(parseJsonLoose('Aqui esta: {"title":"X"} fin.')).toEqual({ title: 'X' });
  });

  it('lanza si no hay JSON', () => {
    expect(() => parseJsonLoose('sin json aqui')).toThrow();
  });
});

describe('coerceMetadata', () => {
  it('normaliza metadatos completos y adjunta la portada', () => {
    const md = coerceMetadata(
      {
        title: 'Practical Programming',
        subtitle: 'An Introduction',
        authors: ['Paul Gries', 'Jennifer Campbell'],
        year: 2026,
        edition: '4th Edition',
        totalPages: 393,
        difficulty: 'BEGINNER',
      },
      731627,
      'data:image/jpeg;base64,AAAA'
    );
    expect(md.title).toBe('Practical Programming');
    expect(md.authors).toEqual(['Paul Gries', 'Jennifer Campbell']);
    expect(md.totalPages).toBe(393);
    expect(md.coverImageDataUrl).toBe('data:image/jpeg;base64,AAAA');
  });

  it('aplica valores por defecto ante datos vacios', () => {
    const md = coerceMetadata({}, 1000);
    expect(md.title).toBe('Libro sin titulo');
    expect(md.authors).toEqual(['Autor Desconocido']);
    expect(md.difficulty).toBe('BEGINNER');
  });
});

describe('coerceChaptersIndex', () => {
  it('ordena y calcula micro-lecciones', () => {
    const chapters = coerceChaptersIndex(
      [
        { chapterNumber: 3, title: 'C', startPage: 31, endPage: 66 },
        { chapterNumber: 1, title: 'A', startPage: 1, endPage: 6 },
      ],
      100000
    );
    expect(chapters.map((c) => c.chapterNumber)).toEqual([1, 3]);
    expect(chapters[0].estimatedMicroLessons).toBeGreaterThanOrEqual(4);
    expect(chapters[0].estimatedMicroLessons).toBeLessThanOrEqual(8);
  });

  it('ignora entradas invalidas', () => {
    expect(coerceChaptersIndex([{ title: 'sin numero' }, null, 42], 1000)).toEqual([]);
  });
});

describe('deriveMetadataHeuristic (fallback sin LLM)', () => {
  it('extrae titulo y autores del front-matter', () => {
    const frontMatter = [
      'Practical Programming',
      'An Introduction to Computer Science Using Python',
      'by Paul Gries, Jennifer Campbell and Jason Montojo',
      'Copyright 2026',
    ].join('\n');
    const md = deriveMetadataHeuristic(frontMatter, 5000);
    expect(md.title).toBe('Practical Programming');
    expect(md.authors).toContain('Paul Gries');
    expect(md.authors).toContain('Jason Montojo');
  });

  it('devuelve valores por defecto si no hay nada util', () => {
    const md = deriveMetadataHeuristic('Copyright 2026\nISBN 123', 100);
    expect(md.title).toBe('Libro sin titulo');
    expect(md.authors).toEqual(['Autor Desconocido']);
  });
});

describe('deriveChaptersHeuristic (fallback sin LLM)', () => {
  it('detecta capitulos numerados', () => {
    const frontMatter = 'Chapter 1 What is Programming\nChapter 2 Hello Python\nChapter 3 Designing Functions';
    const chapters = deriveChaptersHeuristic(frontMatter, 10000);
    expect(chapters.length).toBe(3);
    expect(chapters[0].chapterNumber).toBe(1);
    expect(chapters[2].title).toContain('Designing');
  });

  it('garantiza al menos un capitulo para poder avanzar', () => {
    const chapters = deriveChaptersHeuristic('texto sin capitulos', 10000);
    expect(chapters.length).toBe(1);
    expect(chapters[0].chapterNumber).toBe(1);
  });
});

describe('extractFrontMatter', () => {
  it('corta por caracteres cuando no hay marcadores de pagina', () => {
    const text = 'a'.repeat(50000);
    expect(extractFrontMatter(text, 1000).length).toBe(1000);
  });

  it('respeta los marcadores de pagina', () => {
    const text = '--- page 1 ---\nContenido\n--- page 20 ---\nMas contenido';
    const fm = extractFrontMatter(text, 100000, 15);
    expect(fm).toContain('Contenido');
    expect(fm).not.toContain('Mas contenido');
  });
});

// --- SEGMENTADOR ---

describe('splitChapterIntoMicroLessons', () => {
  it('respeta los subtitulos y agrupa en 4-8 lecciones', () => {
    const body = [
      'Introduccion del capitulo con suficiente texto. '.repeat(10),
      '1.1 Primera seccion',
      'Contenido de la primera seccion. '.repeat(20),
      '1.2 Segunda seccion',
      'Contenido de la segunda seccion. '.repeat(20),
      '1.3 Tercera seccion',
      'Contenido de la tercera seccion. '.repeat(20),
      '1.4 Cuarta seccion',
      'Contenido de la cuarta seccion. '.repeat(20),
    ].join('\n\n');
    const lessons = splitChapterIntoMicroLessons(body, 1, 'Capitulo 1', 4);
    expect(lessons.length).toBeGreaterThanOrEqual(4);
    expect(lessons.length).toBeLessThanOrEqual(8);
    // La introduccion no se pierde: la primera leccion la incluye.
    expect(lessons[0].text).toContain('Introduccion del capitulo');
  });

  it('agrupa por parrafos cuando no hay subtitulos', () => {
    const body = Array.from({ length: 40 }, (_, i) => `Parrafo ${i} con contenido suficiente. `.repeat(4)).join('\n\n');
    const lessons = splitChapterIntoMicroLessons(body, 2, 'Capitulo 2', 6);
    expect(lessons.length).toBeGreaterThanOrEqual(4);
    expect(lessons.length).toBeLessThanOrEqual(8);
  });
});

describe('segmentBookByIndex (stress: libro de 17 capitulos)', () => {
  it('produce 4-8 micro-lecciones por cada uno de los 17 capitulos', () => {
    const { text, index } = buildSyntheticBook(17);
    const chunks = segmentBookByIndex(text, index, {});
    const chapterNumbers = new Set(chunks.map((c) => c.chapterNumber));
    expect(chapterNumbers.size).toBe(17);
    for (let n = 1; n <= 17; n += 1) {
      const count = chunks.filter((c) => c.chapterNumber === n).length;
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(8);
    }
  });

  it('respeta la seleccion de capitulos', () => {
    const { text, index } = buildSyntheticBook(17);
    const chunks = segmentBookByIndex(text, index, { selectedChapterNumbers: [1, 2] });
    const chapterNumbers = new Set(chunks.map((c) => c.chapterNumber));
    expect([...chapterNumbers].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('no se cuelga con un libro grande (stress)', () => {
    const { text, index } = buildSyntheticBook(40);
    const started = Date.now();
    const chunks = segmentBookByIndex(text, index, {});
    expect(chunks.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// --- SANEADOR DE LECCIONES (defensa contra la salida del LLM) ---

describe('sanitizeLesson (evita la pantalla negra por datos del LLM)', () => {
  it('normaliza un callout.kind desconocido a BOOK_NOTE', () => {
    const lesson = sanitizeLesson({
      lessonId: 'l1',
      order: 1,
      title: 'T',
      estimatedMinutes: 5,
      blocks: [
        {
          blockId: 'b1',
          type: 'PROSE',
          markdown: 'Hola',
          callout: { kind: 'INFO', title: 'X', body: 'Y' },
        },
      ],
    });
    const block = lesson.blocks[0] as { callout?: { kind: string } };
    expect(block.callout?.kind).toBe('BOOK_NOTE');
  });

  it('descarta bloques con tipo desconocido', () => {
    const lesson = sanitizeLesson({
      lessonId: 'l1',
      blocks: [
        { blockId: 'b1', type: 'PROSE', markdown: 'Valido' },
        { blockId: 'b2', type: 'SUPER_BLOCK', markdown: 'Invalido' },
      ],
    });
    expect(lesson.blocks.length).toBe(1);
  });

  it('lanza si no queda ningun bloque valido', () => {
    expect(() => sanitizeLesson({ lessonId: 'l1', blocks: [{ type: 'NOPE' }] })).toThrow();
  });

  it('rellena campos faltantes con valores por defecto', () => {
    const lesson = sanitizeLesson({ blocks: [{ type: 'PROSE', markdown: 'x' }] });
    expect(lesson.lessonId).toBeTruthy();
    expect(lesson.title).toBe('Leccion');
    expect(lesson.estimatedMinutes).toBe(10);
  });

  it('descarta PROSE sin markdown', () => {
    const lesson = sanitizeLesson({
      lessonId: 'l1',
      blocks: [
        { blockId: 'b1', type: 'PROSE', markdown: '   ' },
        { blockId: 'b2', type: 'PROSE', markdown: 'Contenido real' },
      ],
    });
    expect(lesson.blocks.length).toBe(1);
  });
});
