/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['SF Mono', 'Fira Code', 'JetBrains Mono', 'monospace'],
      },

      colors: {
        ctp: {
          base: 'var(--ctp-base)',
          mantle: 'var(--ctp-mantle)',
          crust: 'var(--ctp-crust)',
          surface0: 'var(--ctp-surface0)',
          surface1: 'var(--ctp-surface1)',
          surface2: 'var(--ctp-surface2)',
          overlay0: 'var(--ctp-overlay0)',
          overlay1: 'var(--ctp-overlay1)',
          overlay2: 'var(--ctp-overlay2)',
          subtext0: 'var(--ctp-subtext0)',
          subtext1: 'var(--ctp-subtext1)',
          text: 'var(--ctp-text)',
          lavender: 'var(--ctp-lavender)',
          blue: 'var(--ctp-blue)',
          sapphire: 'var(--ctp-sapphire)',
          sky: 'var(--ctp-sky)',
          teal: 'var(--ctp-teal)',
          green: 'var(--ctp-green)',
          yellow: 'var(--ctp-yellow)',
          peach: 'var(--ctp-peach)',
          maroon: 'var(--ctp-maroon)',
          red: 'var(--ctp-red)',
          mauve: 'var(--ctp-mauve)',
          pink: 'var(--ctp-pink)',
          flamingo: 'var(--ctp-flamingo)',
          rosewater: 'var(--ctp-rosewater)',
        },

        theme: {
          bg: 'var(--theme-bg)',
          surface: 'var(--theme-surface)',
          border: 'var(--theme-border)',
          text: 'var(--theme-text)',
          muted: 'var(--theme-muted)',
        },
      },
    },
  },
  plugins: [],
}
