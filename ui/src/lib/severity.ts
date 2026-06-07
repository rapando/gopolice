// Shared severity/category visual encodings — single source of truth so
// badges, icons, and text colors stay in sync (and themed) across pages.

const SEVERITIES = ['error', 'warning', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const severities: readonly Severity[] = SEVERITIES

// Shapes are deliberately distinct (filled circle / filled triangle / outlined
// circle), not just filled circle vs. diamond, so severity reads at a glance
// without relying on color alone (colorblind-safe redundant encoding).
const ICONS: Record<Severity, string> = { error: '●', warning: '▲', info: '○' }

// "warning" is amber/orange rather than yellow — increases perceptual distance
// from "error" red for red-green and blue-yellow colorblindness.
const TEXT_CLASSES: Record<Severity, string> = {
  error: 'text-red-500 dark:text-ctp-red',
  warning: 'text-amber-600 dark:text-ctp-peach',
  info: 'text-blue-500 dark:text-ctp-blue',
}

const BADGE_CLASSES: Record<Severity, string> = {
  error: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-ctp-red',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-ctp-peach',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-ctp-blue',
}

const FALLBACK_ICON = '○'
const FALLBACK_TEXT = 'text-gray-400 dark:text-ctp-overlay0'
const FALLBACK_BADGE = 'bg-gray-50 text-gray-600 dark:bg-ctp-mantle dark:text-ctp-subtext0'

export function severityIcon(severity: string): string {
  return ICONS[severity as Severity] ?? FALLBACK_ICON
}

export function severityTextClass(severity: string): string {
  return TEXT_CLASSES[severity as Severity] ?? FALLBACK_TEXT
}

export function severityBadgeClass(severity: string): string {
  return BADGE_CLASSES[severity as Severity] ?? FALLBACK_BADGE
}

const CATEGORY_TEXT_CLASSES: Record<string, string> = {
  bug: 'text-red-700 dark:text-ctp-red',
  security: 'text-orange-700 dark:text-ctp-peach',
  style: 'text-gray-600 dark:text-ctp-subtext0',
  complexity: 'text-purple-700 dark:text-ctp-mauve',
  test: 'text-green-700 dark:text-ctp-green',
  deadcode: 'text-rose-700 dark:text-ctp-flamingo',
}

export function categoryTextClass(category: string): string {
  return CATEGORY_TEXT_CLASSES[category] ?? CATEGORY_TEXT_CLASSES.style
}
