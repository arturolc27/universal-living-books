import { useEffect } from 'react';
import type { ThemeDNA } from '../../types/cartridge.types';
import { sanitizeCssColor, sanitizeFontName } from '../utils/sanitize';

const DEFAULT_THEME_DNA: ThemeDNA = {
  themeName: 'Living Books Default',
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

const CSS_VAR_MAP: Record<string, keyof ThemeDNA['colors']> = {
  '--bg-canvas': 'bgCanvas',
  '--bg-surface': 'bgSurface',
  '--bg-elevated': 'bgElevated',
  '--border-subtle': 'borderSubtle',
  '--text-primary': 'textPrimary',
  '--text-muted': 'textMuted',
  '--accent-primary': 'accentPrimary',
  '--accent-secondary': 'accentSecondary',
  '--accent-success': 'accentSuccess',
  '--accent-danger': 'accentDanger',
};

const EDITORIAL_FONT_STACK: Record<ThemeDNA['typography']['editorialFont'], string> = {
  serif: "'Newsreader', Georgia, 'Times New Roman', serif",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
};

export function applyThemeDNA(theme: ThemeDNA): void {
  const root = document.documentElement;
  for (const [cssVar, colorKey] of Object.entries(CSS_VAR_MAP)) {
    const safeColor = sanitizeCssColor(theme.colors[colorKey], DEFAULT_THEME_DNA.colors[colorKey]);
    root.style.setProperty(cssVar, safeColor);
  }
  const editorialFont = theme.typography.editorialFont === 'serif' ? 'serif' : 'sans';
  const safeCodeFont = sanitizeFontName(theme.typography.codeFont, 'JetBrains Mono');
  root.style.setProperty('--font-editorial', EDITORIAL_FONT_STACK[editorialFont]);
  root.style.setProperty('--font-code', `'${safeCodeFont}', 'JetBrains Mono', monospace`);
  root.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark';
}

export function ThemeInjector({ theme }: { theme: ThemeDNA | null }): null {
  useEffect(() => {
    applyThemeDNA(theme ?? DEFAULT_THEME_DNA);
  }, [theme]);

  return null;
}
