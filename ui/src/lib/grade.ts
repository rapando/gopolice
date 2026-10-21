import { computeGrade } from '../api/client'

/** Points per issue, as computeGrade scores them. */
export const GRADE_POINTS: Record<string, number> = { error: 10, warning: 3, info: 1 }

/** Highest score that still earns the grade. */
export const GRADE_CEILING: Record<string, number> = { A: 0, B: 15, C: 40, D: 80 }

export interface GradeDetails {
  grade: string
  score: number
  counts: { error: number; warning: number; info: number }
  /** The grade one step better, and what it takes to get there. Null for A. */
  next: { grade: string; ceiling: number; fix: number; severity: string } | null
  /** How far into the current band the score is, 0..1, for a small bar. */
  bandFraction: number
}

/** Explains computeGrade: the score, how it was reached, and the next step up. */
export function gradeDetails(issues: { severity: string }[]): GradeDetails {
  const counts = { error: 0, warning: 0, info: 0 }
  let score = 0
  for (const i of issues) {
    const sev = (i.severity in GRADE_POINTS ? i.severity : 'info') as keyof typeof counts
    counts[sev]++
    score += GRADE_POINTS[sev]
  }
  const grade = computeGrade(issues)
  const order = ['A', 'B', 'C', 'D', 'F']
  const idx = order.indexOf(grade)
  let next: GradeDetails['next'] = null
  if (idx > 0) {
    const nextGrade = order[idx - 1]
    const ceiling = GRADE_CEILING[nextGrade]
    // Fixing the heaviest issues first gets there fastest.
    const severity = counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'info'
    const fix = Math.max(1, Math.ceil((score - ceiling) / GRADE_POINTS[severity]))
    next = { grade: nextGrade, ceiling, fix: Math.min(fix, counts[severity as keyof typeof counts] || fix), severity }
  }
  const lower = idx > 0 ? GRADE_CEILING[order[idx - 1]] : 0
  const upper = grade === 'F' ? Math.max(score, lower + 1) : GRADE_CEILING[grade]
  const bandFraction = upper > lower ? Math.min(1, Math.max(0, (score - lower) / (upper - lower))) : 1
  return { grade, score, counts, next, bandFraction }
}
