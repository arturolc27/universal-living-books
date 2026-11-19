import { livingBooksDb } from '../../db/dexieDb';
import type { ThemeDNA } from '../../types/cartridge.types';

export interface OptimizedCoverResult {
  cardDataUrl: string;
  iconBlob?: Blob;
  cardBlob?: Blob;
  extractedThemeDNA?: ThemeDNA;
}

const PALETTE_PRESETS: Array<{ bg: string; surface: string; accent: string; secondary: string }> = [
  { bg: '#0F1419', surface: '#182026', accent: '#38BDF8', secondary: '#F59E0B' },
  { bg: '#111827', surface: '#1F2937', accent: '#34D399', secondary: '#A78BFA' },
  { bg: '#18181B', surface: '#27272A', accent: '#FB7185', secondary: '#FBBF24' },
  { bg: '#0C1222', surface: '#172036', accent: '#60A5FA', secondary: '#F472B6' },
  { bg: '#141619', surface: '#1E2229', accent: '#2DD4BF', secondary: '#FB923C' },
];

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(...hexToRgb(hexA));
  const l2 = relativeLuminance(...hexToRgb(hexB));
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

/**
 * Asegura que un color de acento tenga contraste minimo WCAG AA (>= 4.5)
 * sobre el fondo oscuro del lector aclarando su luminancia si hace falta.
 */
export function ensureAccessibleAccent(accentHex: string, bgHex = '#0F1419'): string {
  let [r, g, b] = hexToRgb(accentHex);
  for (let i = 0; i < 10; i += 1) {
    const candidate = rgbToHex(r, g, b);
    if (contrastRatio(candidate, bgHex) >= 4.5) return candidate;
    r = r + (255 - r) * 0.22;
    g = g + (255 - g) * 0.22;
    b = b + (255 - b) * 0.22;
  }
  return '#38BDF8';
}

export function buildThemeFromSeed(seedTitle: string): ThemeDNA {
  const preset = PALETTE_PRESETS[hashString(seedTitle) % PALETTE_PRESETS.length];
  return {
    themeName: 'Editorial Adaptive',
    mode: 'dark',
    colors: {
      bgCanvas: preset.bg,
      bgSurface: preset.surface,
      bgElevated: '#222D36',
      borderSubtle: '#2E3C48',
      textPrimary: '#F1F5F9',
      textMuted: '#94A3B8',
      accentPrimary: ensureAccessibleAccent(preset.accent, preset.bg),
      accentSecondary: preset.secondary,
      accentSuccess: '#10B981',
      accentDanger: '#F43F5E',
    },
    typography: { editorialFont: 'sans', codeFont: 'JetBrains Mono' },
  };
}

/**
 * Genera una portada editorial limpia en SVG Data URL (para vista previa/fallback)
 * cuando el libro no incluye imagen de portada.
 */
export function generateEditorialCoverDataUrl(
  title: string,
  authors: string[],
  accentIcon = '📘'
): string {
  const theme = buildThemeFromSeed(title || 'Libro');
  const safeTitle = escapeXml((title || 'Curso Interactivo').slice(0, 64));
  const safeAuthor = escapeXml((authors[0] || 'Universal Living Books').slice(0, 42));
  const safeIcon = escapeXml(accentIcon.slice(0, 4));

  const words = safeTitle.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > 18 && current) {
      lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
    if (lines.length >= 3) break;
  }
  if (current && lines.length < 4) lines.push(current);

  const titleSvg = lines
    .map(
      (line, idx) =>
        `<text x="36" y="${210 + idx * 38}" fill="#F8FAFC" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700">${line}</text>`
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.colors.bgCanvas}"/>
      <stop offset="100%" stop-color="${theme.colors.bgSurface}"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${theme.colors.accentPrimary}"/>
      <stop offset="100%" stop-color="${theme.colors.accentSecondary}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="560" rx="16" fill="url(#bg)"/>
  <rect x="0" y="0" width="12" height="560" fill="url(#bar)"/>
  <circle cx="320" cy="96" r="56" fill="${theme.colors.accentPrimary}" fill-opacity="0.12"/>
  <text x="36" y="106" font-size="44">${safeIcon}</text>
  <text x="36" y="150" fill="${theme.colors.accentPrimary}" font-family="system-ui, sans-serif" font-size="12" font-weight="600" letter-spacing="2">LIVING COURSE EDITION</text>
  ${titleSvg}
  <line x1="36" y1="455" x2="364" y2="455" stroke="${theme.colors.borderSubtle}" stroke-width="1"/>
  <text x="36" y="492" fill="#94A3B8" font-family="system-ui, sans-serif" font-size="16" font-weight="500">${safeAuthor}</text>
</svg>`;

  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo convertir Blob a DataURL.'));
    reader.readAsDataURL(blob);
  });
}

async function resizeDataUrlToWebP(
  sourceDataUrl: string,
  width: number,
  height: number,
  quality = 0.84
): Promise<{ blob: Blob; avgRgb?: [number, number, number] } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        // Muestreo rapido de color dominante para ThemeDNA
        const sample = ctx.getImageData(0, 0, Math.min(width, 32), Math.min(height, 32)).data;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;
        for (let i = 0; i < sample.length; i += 16) {
          const r = sample[i];
          const g = sample[i + 1];
          const b = sample[i + 2];
          // Ignorar negros o blancos puros para capturar color tematico real
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min > 18) {
            rSum += r;
            gSum += g;
            bSum += b;
            count += 1;
          }
        }
        const avgRgb: [number, number, number] | undefined =
          count > 0 ? [rSum / count, gSum / count, bSum / count] : undefined;

        canvas.toBlob(
          (blob) => {
            if (!blob) resolve(null);
            else resolve({ blob, avgRgb });
          },
          'image/webp',
          quality
        );
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = sourceDataUrl;
  });
}

/**
 * Optimiza una portada (o genera una portada editorial si falta) en WebP
 * tamano icono (128x176) y tarjeta (400x560), y extrae una paleta ThemeDNA accesible.
 */
export async function optimizeBookCover(
  rawCoverDataUrl: string | null | undefined,
  title: string,
  authors: string[],
  accentIcon = '📘'
): Promise<OptimizedCoverResult> {
  const source = rawCoverDataUrl || generateEditorialCoverDataUrl(title, authors, accentIcon);
  const cardRes = await resizeDataUrlToWebP(source, 400, 560, 0.84);
  const iconRes = await resizeDataUrlToWebP(source, 128, 176, 0.8);

  const baseTheme = buildThemeFromSeed(title);
  if (cardRes?.avgRgb) {
    const rawAccent = rgbToHex(...cardRes.avgRgb);
    baseTheme.colors.accentPrimary = ensureAccessibleAccent(rawAccent, baseTheme.colors.bgCanvas);
  }

  let cardDataUrl = rawCoverDataUrl || '';
  if (cardRes?.blob) {
    cardDataUrl = await blobToDataUrl(cardRes.blob);
  } else if (!cardDataUrl) {
    // Fallback si estamos en entorno headless sin canvas: no guardar svg+xml en coverImageDataUrl
    // porque isSafeCoverImageUrl bloquea svg+xml; devolvemos vacio para que UI use fallback limpio.
    cardDataUrl = '';
  }

  return {
    cardDataUrl,
    iconBlob: iconRes?.blob,
    cardBlob: cardRes?.blob,
    extractedThemeDNA: baseTheme,
  };
}

export async function saveBookCoverAssets(bookId: string, optimized: OptimizedCoverResult): Promise<void> {
  const now = Date.now();
  const records = [];
  if (optimized.iconBlob) {
    records.push({
      bookId,
      kind: 'icon' as const,
      mimeType: optimized.iconBlob.type || 'image/webp',
      blob: optimized.iconBlob,
      updatedAt: now,
    });
  }
  if (optimized.cardBlob) {
    records.push({
      bookId,
      kind: 'card' as const,
      mimeType: optimized.cardBlob.type || 'image/webp',
      blob: optimized.cardBlob,
      updatedAt: now,
    });
  }
  if (records.length > 0) {
    await livingBooksDb.bookAssets.bulkPut(records);
  }
}
