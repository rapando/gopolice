import type { ReactNode } from 'react'

export type StatTone = 'default' | 'success' | 'warning' | 'danger' | 'orange' | 'muted'

const TONE: Record<StatTone, string> = {
  default: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  orange: 'text-orange',
  muted: 'text-fg-muted',
}

interface Props {
  /** Sentence case, e.g. "Median time/op". */
  label: string
  value: ReactNode
  /** One short line under the value: a unit, a name, or why the value is what it is. */
  sub?: ReactNode
  tone?: StatTone
  /** Smaller value text, for strings such as branch names. */
  dense?: boolean
  className?: string
  title?: string
}

/** The one stat tile every page uses, so labels, sizes and padding match. */
export default function StatTile({ label, value, sub, tone = 'default', dense = false, className = '', title }: Props) {
  return (
    <div className={`card px-5 py-4 min-w-0 ${className}`} title={title}>
      <p className="text-sm text-fg-muted mb-0.5">{label}</p>
      <p className={`${dense ? 'text-base' : 'text-2xl'} font-semibold tabular-nums truncate ${TONE[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle mt-0.5 truncate">{sub}</p>}
    </div>
  )
}
