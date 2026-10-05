/** @type {import('tailwindcss').Config} */
// Colors are replaced (not extended) so only design tokens from index.css are
// available; a stray default palette class such as text-gray-500 generates nothing.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      canvas: 'rgb(var(--canvas) / <alpha-value>)',
      surface: 'rgb(var(--surface) / <alpha-value>)',
      subtle: 'rgb(var(--subtle) / <alpha-value>)',
      muted: 'rgb(var(--muted) / <alpha-value>)',
      line: { DEFAULT: 'rgb(var(--line) / <alpha-value>)', strong: 'rgb(var(--line-strong) / <alpha-value>)' },
      fg: { DEFAULT: 'rgb(var(--fg) / <alpha-value>)', muted: 'rgb(var(--fg-muted) / <alpha-value>)', subtle: 'rgb(var(--fg-subtle) / <alpha-value>)' },
      inverse: 'rgb(var(--inverse) / <alpha-value>)',
      accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)', solid: 'rgb(var(--accent-solid) / <alpha-value>)', soft: 'rgb(var(--accent-soft) / <alpha-value>)' },
      danger: { DEFAULT: 'rgb(var(--danger) / <alpha-value>)', solid: 'rgb(var(--danger-solid) / <alpha-value>)', soft: 'rgb(var(--danger-soft) / <alpha-value>)' },
      warning: { DEFAULT: 'rgb(var(--warning) / <alpha-value>)', solid: 'rgb(var(--warning-solid) / <alpha-value>)', soft: 'rgb(var(--warning-soft) / <alpha-value>)' },
      success: { DEFAULT: 'rgb(var(--success) / <alpha-value>)', solid: 'rgb(var(--success-solid) / <alpha-value>)', soft: 'rgb(var(--success-soft) / <alpha-value>)' },
      violet: { DEFAULT: 'rgb(var(--violet) / <alpha-value>)', solid: 'rgb(var(--violet-solid) / <alpha-value>)', soft: 'rgb(var(--violet-soft) / <alpha-value>)' },
      orange: { DEFAULT: 'rgb(var(--orange) / <alpha-value>)', solid: 'rgb(var(--orange-solid) / <alpha-value>)', soft: 'rgb(var(--orange-soft) / <alpha-value>)' },
      series: { 1: 'rgb(var(--series-1) / <alpha-value>)', 2: 'rgb(var(--series-2) / <alpha-value>)', 3: 'rgb(var(--series-3) / <alpha-value>)', 4: 'rgb(var(--series-4) / <alpha-value>)', 5: 'rgb(var(--series-5) / <alpha-value>)', 6: 'rgb(var(--series-6) / <alpha-value>)', 7: 'rgb(var(--series-7) / <alpha-value>)', 8: 'rgb(var(--series-8) / <alpha-value>)' },
      status: { good: 'rgb(var(--status-good) / <alpha-value>)', warn: 'rgb(var(--status-warn) / <alpha-value>)', bad: 'rgb(var(--status-bad) / <alpha-value>)' },
    },
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
      },
    },
  },
  plugins: [],
}
