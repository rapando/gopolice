// Light/dark mode. "system" follows the OS setting and is the default; an
// explicit choice is remembered in localStorage. index.html applies the same
// logic before first paint to avoid a flash of the wrong mode.

export type ThemeMode = 'light' | 'dark' | 'system'

const KEY = 'gopolice-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // storage unavailable: fall through to system
  }
  return 'system'
}

function resolve(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && media().matches)
}

export function applyThemeMode(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', resolve(mode))
  try {
    if (mode === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // ignore: the choice just won't persist
  }
}

/** Re-applies the mode when the OS setting changes while in "system" mode. */
export function watchSystemTheme(): () => void {
  const m = media()
  const onChange = () => {
    if (getThemeMode() === 'system') applyThemeMode('system')
  }
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
