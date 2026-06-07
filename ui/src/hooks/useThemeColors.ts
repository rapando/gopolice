import { useEffect, useState } from 'react'

// D3/Recharts/SVG need resolved color strings (not Tailwind classes), and the
// app's theme is applied by toggling `data-theme`/`.dark` on <html> — so chart
// code can't simply rely on CSS cascade. This hook snapshots the active
// theme's CSS custom properties and re-reads them whenever the theme changes,
// letting visualizations stay in sync with Catppuccin/Nord/Dracula/Gruvbox.
export interface ThemeColors {
  bg: string
  surface: string
  surface1: string
  surface2: string
  border: string
  text: string
  muted: string
  overlay0: string
  overlay1: string
  red: string
  maroon: string
  yellow: string
  peach: string
  green: string
  teal: string
  blue: string
  sapphire: string
  sky: string
  lavender: string
  mauve: string
  pink: string
  flamingo: string
}

const VAR_MAP: Record<keyof ThemeColors, string> = {
  bg: '--theme-bg',
  surface: '--theme-surface',
  surface1: '--ctp-surface1',
  surface2: '--ctp-surface2',
  border: '--theme-border',
  text: '--theme-text',
  muted: '--theme-muted',
  overlay0: '--ctp-overlay0',
  overlay1: '--ctp-overlay1',
  red: '--ctp-red',
  maroon: '--ctp-maroon',
  yellow: '--ctp-yellow',
  peach: '--ctp-peach',
  green: '--ctp-green',
  teal: '--ctp-teal',
  blue: '--ctp-blue',
  sapphire: '--ctp-sapphire',
  sky: '--ctp-sky',
  lavender: '--ctp-lavender',
  mauve: '--ctp-mauve',
  pink: '--ctp-pink',
  flamingo: '--ctp-flamingo',
}

function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement)
  const out = {} as ThemeColors
  for (const key of Object.keys(VAR_MAP) as (keyof ThemeColors)[]) {
    out[key] = style.getPropertyValue(VAR_MAP[key]).trim()
  }
  return out
}

/** Returns the current theme's resolved colors, updating when the user switches scheme or light/dark mode. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(readThemeColors)

  useEffect(() => {
    const update = () => setColors(readThemeColors())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => observer.disconnect()
  }, [])

  return colors
}
