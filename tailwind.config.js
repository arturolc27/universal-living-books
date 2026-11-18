/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        subtle: 'var(--border-subtle)',
        primary: 'var(--text-primary)',
        muted: 'var(--text-muted)',
        accent: 'var(--accent-primary)',
        'accent-secondary': 'var(--accent-secondary)',
        success: 'var(--accent-success)',
        danger: 'var(--accent-danger)',
      },
      fontFamily: {
        editorial: 'var(--font-editorial)',
        code: 'var(--font-code)',
      },
    },
  },
  plugins: [],
};
