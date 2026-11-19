import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  detectBookFormat,
  extractEpubFromBuffer,
} from './engine/compiler/bookSourceAdapter';
import {
  isSafeAssetUrl,
  isSafeCoverImageUrl,
  isSafeSupabaseUrl,
  sanitizeCssColor,
  sanitizeFontName,
  sanitizeVfsPath,
  sanitizeVirtualFileSystemSeed,
  sanitizeYouTubeId,
} from './ui/utils/sanitize';

describe('bookSourceAdapter', () => {
  it('detects supported book formats by extension', () => {
    expect(detectBookFormat('python-handbook.pdf')).toBe('pdf');
    expect(detectBookFormat('BOOK.EPUB')).toBe('epub');
    expect(detectBookFormat('guide.md')).toBe('markdown');
    expect(detectBookFormat('notes.markdown')).toBe('markdown');
    expect(detectBookFormat('draft.txt')).toBe('text');
  });

  it('extracts metadata, spine text, and cover from a valid EPUB buffer', () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Python Estructurado</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>es</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.png" media-type="image/png"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

    const ch1 = `<html><body><h1>Capitulo 1</h1><p>Variables y tipos en Python.</p></body></html>`;
    const ch2 = `<html><body><h1>Capitulo 2</h1><p>Ciclos for y while.</p></body></html>`;
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const zipped = zipSync({
      'META-INF/container.xml': strToU8(containerXml),
      'OEBPS/content.opf': strToU8(contentOpf),
      'OEBPS/text/ch1.xhtml': strToU8(ch1),
      'OEBPS/text/ch2.xhtml': strToU8(ch2),
      'OEBPS/images/cover.png': fakePng,
    });

    const result = extractEpubFromBuffer(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));

    expect(result.format).toBe('epub');
    expect(result.totalPages).toBe(2);
    expect(result.nativeMetadata?.title).toBe('Python Estructurado');
    expect(result.nativeMetadata?.authors).toEqual(['Ada Lovelace']);
    expect(result.nativeMetadata?.language).toBe('es');
    expect(result.text).toContain('Variables y tipos en Python.');
    expect(result.text).toContain('Ciclos for y while.');
    expect(result.text).toContain('--- page 1 ---');
    expect(result.text).toContain('--- page 2 ---');
    expect(result.coverDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('throws a clear error when EPUB lacks container.xml', () => {
    const zipped = zipSync({ 'hello.txt': strToU8('not an epub') });
    expect(() =>
      extractEpubFromBuffer(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength))
    ).toThrow(/container\.xml/i);
  });
});

describe('sanitize utilities', () => {
  it('validates YouTube IDs strictly', () => {
    expect(sanitizeYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(sanitizeYouTubeId('https://evil.com/x?a=1')).toBeNull();
    expect(sanitizeYouTubeId('<script>')).toBeNull();
  });

  it('validates safe asset and cover URLs', () => {
    expect(isSafeAssetUrl('https://example.com/img.png')).toBe(true);
    expect(isSafeAssetUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeCoverImageUrl('data:image/webp;base64,AAAA')).toBe(true);
    expect(isSafeCoverImageUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isSafeSupabaseUrl('https://xyz.supabase.co')).toBe(true);
    expect(isSafeSupabaseUrl('http://localhost:54321')).toBe(true);
    expect(isSafeSupabaseUrl('ftp://bad.example.com')).toBe(false);
  });

  it('sanitizes CSS colors and font names', () => {
    expect(sanitizeCssColor('#38bdf8', '#000')).toBe('#38bdf8');
    expect(sanitizeCssColor('rgb(10, 20, 30)', '#000')).toBe('rgb(10, 20, 30)');
    expect(sanitizeCssColor('red; background: url(x)', '#000')).toBe('#000');
    expect(sanitizeFontName('Fira Code', 'system-ui')).toBe('Fira Code');
    expect(sanitizeFontName('Inter; }</style><script>', 'system-ui')).toBe('system-ui');
  });

  it('blocks VFS path traversal, absolute paths, and prototype pollution keys', () => {
    expect(sanitizeVfsPath('src/main.py')).toBe('src/main.py');
    expect(sanitizeVfsPath('../etc/passwd')).toBeNull();
    expect(sanitizeVfsPath('/etc/passwd')).toBeNull();
    expect(sanitizeVfsPath('__proto__/x')).toBeNull();

    const cleaned = sanitizeVirtualFileSystemSeed({
      'app/main.py': 'print(1)',
      '../../secret.txt': 'bad',
      '/abs.py': 'bad',
      constructor: 'bad',
    });
    expect(cleaned).toEqual({ 'app/main.py': 'print(1)' });
  });
});
