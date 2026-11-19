import { describe, expect, it } from 'vitest';
import {
  coerceChaptersIndex,
  countPageMarkers,
  deriveChaptersHeuristic,
  detectScannedPdfLikely,
} from './engine/compiler/metadataTocExtractor';
import {
  buildThemeFromSeed,
  contrastRatio,
  ensureAccessibleAccent,
  generateEditorialCoverDataUrl,
} from './engine/compiler/coverPipeline';

describe('metadataTocExtractor (Fase 2)', () => {
  it('computes estimatedChars dynamically from real totalPages instead of hardcoded 393', () => {
    const chapters = coerceChaptersIndex(
      [
        { chapterNumber: 1, title: 'Intro', startPage: 1, endPage: 10 },
        { chapterNumber: 2, title: 'Lists', startPage: 11, endPage: 30 },
      ],
      100_000,
      100
    );

    expect(chapters).toHaveLength(2);
    expect(chapters[0].estimatedChars).toBe(10_000);
    expect(chapters[1].estimatedChars).toBe(20_000);
  });

  it('detects page markers and low-density scanned PDFs', () => {
    const scanned = '--- page 1 ---\n\n--- page 2 ---\nhi\n--- page 3 ---\n\n--- page 4 ---\nx';
    expect(countPageMarkers(scanned)).toBe(4);
    expect(detectScannedPdfLikely(scanned, 4)).toBe(true);

    const normal =
      '--- page 1 ---\n' +
      'A'.repeat(200) +
      '\n--- page 2 ---\n' +
      'B'.repeat(200) +
      '\n--- page 3 ---\n' +
      'C'.repeat(200);
    expect(detectScannedPdfLikely(normal, 3)).toBe(false);
  });

  it('falls back to Markdown H1 headings when Chapter N is absent', () => {
    const md = `# Fundamentos de Python\nTexto inicial.\n\n# Estructuras de Datos\nListas y diccionarios.`;
    const chapters = deriveChaptersHeuristic(md, md.length);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Fundamentos de Python');
    expect(chapters[1].title).toBe('Estructuras de Datos');
  });
});

describe('coverPipeline (Fase 2)', () => {
  it('ensures WCAG AA contrast (>= 4.5) for ThemeDNA accentPrimary', () => {
    const adjusted = ensureAccessibleAccent('#111827', '#0F1419');
    expect(contrastRatio(adjusted, '#0F1419')).toBeGreaterThanOrEqual(4.5);

    const theme = buildThemeFromSeed('Python Crash Course');
    expect(contrastRatio(theme.colors.accentPrimary, theme.colors.bgCanvas)).toBeGreaterThanOrEqual(4.5);
  });

  it('generates an editorial SVG cover data URL with escaped title and author', () => {
    const url = generateEditorialCoverDataUrl('Python & <AI>', ['Guido'], '🐍');
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = atob(url.replace('data:image/svg+xml;base64,', ''));
    expect(decoded).toContain('Python &amp;');
    expect(decoded).toContain('&lt;AI&gt;');
    expect(decoded).toContain('Guido');
  });
});
