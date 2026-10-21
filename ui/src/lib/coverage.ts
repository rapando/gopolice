import type { TestPackage } from '../api/client'

/** Coverage target the bars and colours are measured against. */
export const COVERAGE_TARGET = 80

export interface RateStatus {
  /** Text colour class. */
  text: string
  /** Bar background class. */
  bar: string
  /** Theme colour key for charts (good/warn/bad/muted). */
  key: 'good' | 'warn' | 'bad' | 'muted'
  label: string
}

/** Coverage or pass-rate status: colour plus a word, never colour alone. */
export function rateStatus(pct: number | null): RateStatus {
  if (pct === null) return { text: 'text-fg-muted', bar: 'bg-muted', key: 'muted', label: 'n/a' }
  if (pct >= COVERAGE_TARGET) return { text: 'text-success', bar: 'bg-success', key: 'good', label: 'good' }
  if (pct >= 50) return { text: 'text-warning', bar: 'bg-warning', key: 'warn', label: 'fair' }
  return { text: 'text-danger', bar: 'bg-danger', key: 'bad', label: 'low' }
}

/** Packages that have tests (or report coverage); the ones averages are taken over. */
export function packagesWithTests(packages: TestPackage[]): TestPackage[] {
  return packages.filter((p) => (p.tests?.length ?? 0) > 0 || p.coverage > 0)
}

export function averageCoverage(packages: TestPackage[]): number | null {
  const tested = packagesWithTests(packages)
  if (tested.length === 0) return null
  return tested.reduce((s, p) => s + p.coverage, 0) / tested.length
}

/** "internal/scanner" for "github.com/x/y/internal/scanner"; the module path shown once elsewhere. */
export function shortPackage(name: string, project?: string): string {
  if (!project) return name
  if (name === project) return '(root)'
  return name.startsWith(project + '/') ? name.slice(project.length + 1) : name
}
