import { COVERAGE_TARGET, rateStatus } from '../lib/coverage'

/** A coverage bar coloured by the shared thresholds, with a tick at the target. */
export default function CoverageBar({ pct, className = '' }: { pct: number; className?: string }) {
  const st = rateStatus(pct)
  return (
    <span className={`relative block h-2 bg-muted rounded-full ${className}`} role="img" aria-label={`${pct.toFixed(0)}% coverage, ${st.label}`}>
      <span className={`block h-full rounded-full ${st.bar}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
      <span className="absolute top-[-2px] h-3 w-px bg-line-strong" style={{ left: `${COVERAGE_TARGET}%` }} aria-hidden="true" />
    </span>
  )
}
