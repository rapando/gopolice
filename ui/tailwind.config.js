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
        surface: {
          DEFAULT: '#ffffff',
          dark: '#0d1117',
        },
        sidebar: {
          DEFAULT: '#161b22',
          hover: '#1c2333',
          active: '#1f2937',
        },
        border: {
          DEFAULT: '#e5e7eb',
          dark: '#30363d',
        },
        muted: {
          DEFAULT: '#6b7280',
          dark: '#8b949e',
        },
      },
    },
  },
  plugins: [],
}
