import { useEffect } from 'react';
import type { ThemeDNA } from '../../types/cartridge.types';

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
    root.style.setProperty(cssVar, theme.colors[colorKey]);
  }
  root.style.setProperty('--font-editorial', EDITORIAL_FONT_STACK[theme.typography.editorialFont]);
  root.style.setProperty('--font-code', `'${theme.typography.codeFont}', 'JetBrains Mono', monospace`);
  root.style.colorScheme = theme.mode;
}

export function ThemeInjector({ theme }: { theme: ThemeDNA | null }): null {
  useEffect(() => {
    if (theme) {
      applyThemeDNA(theme);
    }
  }, [theme]);

  return null;
}
