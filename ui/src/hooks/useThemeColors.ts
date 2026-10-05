import { useEffect, useState } from 'react'

// D3/Recharts/SVG need resolved color strings (not Tailwind classes), and the
// light/dark mode is applied by toggling `.dark` on <html>, so chart code can't
// rely on the CSS cascade. This hook resolves the design tokens from index.css
// to hex and re-reads them whenever the mode changes.
export interface ThemeColors {
  canvas: string
  surface: string
  /** Gridlines, borders, separators. */
  border: string
  text: string
  /** Axis tick labels and secondary chart text. */
  axis: string
  /** Recessive marks and tertiary text. */
  muted: string
  accent: string
  /** Status marks: pass / caution / fail. Pair with a label, never color alone. */
  good: string
  warn: string
  bad: string
  /** Severity encodings matching the text tokens used in badges. */
  danger: string
  warning: string
  info: string
  /** Categorical series colors in fixed order. Never cycle: fold extras into `other`. */
  series: string[]
  /** Color for the "Other" bucket once series are exhausted. */
  other: string
}

const SINGLE: Record<Exclude<keyof ThemeColors, 'series'>, string> = {
  canvas: '--canvas',
  surface: '--surface',
  border: '--line',
  text: '--fg',
  axis: '--fg-muted',
  muted: '--fg-subtle',
  accent: '--accent',
  good: '--status-good',
  warn: '--status-warn',
  bad: '--status-bad',
  danger: '--danger',
  warning: '--warning',
  info: '--accent',
  other: '--line-strong',
}

const SERIES_COUNT = 8

function toHex(channels: string): string {
  const parts = channels.trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '#888888'
  return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('')
}

function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement)
  const read = (v: string) => toHex(style.getPropertyValue(v))
  const out = { series: [] as string[] } as ThemeColors
  for (const key of Object.keys(SINGLE) as (keyof typeof SINGLE)[]) {
    out[key] = read(SINGLE[key])
  }
  for (let i = 1; i <= SERIES_COUNT; i++) out.series.push(read(`--series-${i}`))
  return out
}

/** Assigns series colors to keys in order, folding anything past the palette into `other`. */
export function seriesColorMap(keys: string[], colors: ThemeColors): Map<string, string> {
  const m = new Map<string, string>()
  keys.forEach((k, i) => m.set(k, i < colors.series.length ? colors.series[i] : colors.other))
  return m
}

/** Returns the current theme's resolved colors, updating when light/dark mode changes. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(readThemeColors)

  useEffect(() => {
    const update = () => setColors(readThemeColors())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return colors
}
