/**
 * Utilidades de sanitizacion y validacion de URLs / propiedades CSS provenientes
 * de cartuchos JSON o configuraciones de usuario para prevenir XSS / inyeccion.
 */

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR_RE = /^(?:rgb|hsl)a?\(\s*[\d.,%\s/]+\s*\)$/i;
const SAFE_FONT_RE = /^[a-zA-Z0-9\s\-_]+$/;

export function sanitizeYouTubeId(videoId: string | undefined | null): string | null {
  if (!videoId) return null;
  const trimmed = videoId.trim();
  return YOUTUBE_ID_RE.test(trimmed) ? trimmed : null;
}

export function isSafeAssetUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('blob:')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeCoverImageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(trimmed)) {
    return true;
  }
  return isSafeAssetUrl(trimmed);
}

export function isSafeSupabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

export function sanitizeCssColor(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (HEX_COLOR_RE.test(trimmed) || FUNC_COLOR_RE.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function sanitizeFontName(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  return SAFE_FONT_RE.test(trimmed) ? trimmed : fallback;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeVfsPath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('/')) return null;
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || FORBIDDEN_KEYS.has(seg)) return null;
  }
  return segments.join('/');
}

export function sanitizeVirtualFileSystemSeed(
  seed: Record<string, string> | undefined | null
): Record<string, string> {
  if (!seed || typeof seed !== 'object') return {};
  const clean: Record<string, string> = {};
  for (const [rawKey, val] of Object.entries(seed)) {
    const safeKey = sanitizeVfsPath(rawKey);
    if (safeKey && typeof val === 'string') {
      clean[safeKey] = val;
    }
  }
  return clean;
}

export function toDisplayText(value: unknown): string {
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
