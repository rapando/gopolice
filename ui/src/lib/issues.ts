import type { Issue } from '../api/client'

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 }

/** The number an issue is about (cyclomatic complexity today) and its threshold. */
export interface Measure {
  value: number
  threshold?: number
  unit: string
}

/**
 * The measured value behind an issue, when there is one. Prefers the fields
 * the scanner records; older results only carry it in the message text.
 */
export function issueMeasure(issue: Issue): Measure | null {
  if (typeof issue.value === 'number' && issue.value > 0) {
    return { value: issue.value, threshold: issue.threshold || undefined, unit: issue.rule === 'high-complexity' ? 'complexity' : '' }
  }
  const m = /complexity of (\d+)(?: \(threshold: (\d+)\))?/.exec(issue.message)
  if (m) return { value: Number(m[1]), threshold: m[2] ? Number(m[2]) : undefined, unit: 'complexity' }
  return null
}

/** Function name from a complexity message, else the rule. */
export function issueSubject(issue: Issue): string {
  const m = /^Function (\S+) has/.exec(issue.message)
  if (m) return m[1]
  return issue.rule || issue.scanner
}

/** Errors first, then warnings, then the largest measured value. */
export function compareBySeverityThenValue(a: Issue, b: Issue): number {
  const r = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  if (r !== 0) return r
  const va = issueMeasure(a)?.value ?? 0
  const vb = issueMeasure(b)?.value ?? 0
  if (va !== vb) return vb - va
  return a.file.localeCompare(b.file) || a.line - b.line
}

/** The file name, and the directory it sits in, for highlighting the name. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}
