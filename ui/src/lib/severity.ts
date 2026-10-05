// Shared severity/category encodings so badges, icons and text colors stay in
// sync across pages. Severity always pairs a distinct icon shape with its
// label (see components/Severity.tsx), so it never relies on color alone.

const SEVERITIES = ['error', 'warning', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const severities: readonly Severity[] = SEVERITIES

const TEXT_CLASSES: Record<Severity, string> = {
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-accent',
}

const BADGE_CLASSES: Record<Severity, string> = {
  error: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-accent-soft text-accent',
}

export function severityTextClass(severity: string): string {
  return TEXT_CLASSES[severity as Severity] ?? 'text-fg-muted'
}

export function severityBadgeClass(severity: string): string {
  return BADGE_CLASSES[severity as Severity] ?? 'bg-subtle text-fg-muted'
}

const CATEGORY_TEXT_CLASSES: Record<string, string> = {
  bug: 'text-danger',
  security: 'text-orange',
  style: 'text-fg-muted',
  complexity: 'text-violet',
  test: 'text-success',
  deadcode: 'text-fg-muted',
  performance: 'text-warning',
}

export function categoryTextClass(category: string): string {
  return CATEGORY_TEXT_CLASSES[category] ?? CATEGORY_TEXT_CLASSES.style
}
