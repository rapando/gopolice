// Single source of truth for color-scheme/appearance state, shared between
// the quick-access ThemeSwitcher (top bar) and the full Config page so the
// two never drift out of sync.

export interface ThemeOption {
  id: string
  label: string
}

export const themes: ThemeOption[] = [
  { id: 'catppuccin', label: 'Catppuccin' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'gruvbox', label: 'Gruvbox' },
]

export function getScheme(): string {
  return localStorage.getItem('scheme') || 'catppuccin'
}

export function getDark(): boolean {
  return localStorage.getItem('dark') === 'true' ||
    (localStorage.getItem('dark') === null && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function applyScheme(scheme: string, dark: boolean) {
  document.documentElement.setAttribute('data-theme', scheme)
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem('scheme', scheme)
  localStorage.setItem('dark', String(dark))
}
