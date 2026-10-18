import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Minus, X } from 'lucide-react'
import { formatCount, formatElapsed, overallFraction, scannerLabel, type ScanState } from '../lib/scan'

interface Props {
  state: ScanState
  readingResults?: boolean
  /** Opens the detailed scan window. */
  onDetails?: () => void
}

/** Compact in-page summary of a running scan; the modal has the full view. */
export default function ScanProgress({ state, readingResults, onDetails }: Props) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!state.running) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state.running])

  const elapsed = state.startedAt ? (state.finishedAt ?? now) - state.startedAt : 0
  const fraction = overallFraction(state)
  const total = state.pipeline.total || state.steps.length
  const finished = state.steps.filter((s) => s.status !== 'pending' && s.status !== 'running')
  const current = state.steps.find((s) => s.status === 'running') ?? null
  const count = current ? formatCount(current) : ''

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <LoaderCircle className="w-4 h-4 text-accent animate-spin shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-fg">{readingResults ? 'Reading results' : 'Scanning'}</span>
          <span className="text-xs font-mono tabular-nums text-fg-subtle">{formatElapsed(elapsed)}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {total > 0 && <span className="text-xs font-mono tabular-nums text-fg-subtle">{finished.length}/{total}</span>}
          {onDetails && <button onClick={onDetails} className="btn-secondary py-1">Details</button>}
        </div>
      </div>

      <div className="h-2 bg-subtle rounded-full overflow-hidden mb-4">
        <div
          className={`h-full bg-accent-solid rounded-full transition-all duration-500 ease-out ${fraction === null ? 'animate-pulse w-1/12' : ''}`}
          style={fraction === null ? undefined : { width: `${Math.max(fraction * 100, 2)}%` }}
        />
      </div>

      <div className="font-mono text-sm space-y-0.5">
        {current && !readingResults && (
          <div className="flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-md bg-accent-soft/70 border border-accent/50">
            <span className="w-2 h-2 rounded-full bg-accent-solid animate-pulse shrink-0" />
            <span className="text-sm font-semibold text-fg">{scannerLabel(current.scanner)}</span>
            {count ? (
              <span className="text-fg tabular-nums">{count}</span>
            ) : (
              <span className="text-fg-muted truncate">{current.message}</span>
            )}
            {count && current.detail && <span className="text-fg-muted text-xs truncate">· {current.detail}</span>}
          </div>
        )}

        {[...finished].reverse().slice(0, 6).map((s) => (
          <div key={s.scanner} className="flex items-center gap-2.5 py-1 px-2 -mx-2">
            {s.status === 'failed' ? (
              <X className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />
            ) : s.status === 'skipped' ? (
              <Minus className="w-3.5 h-3.5 text-fg-subtle shrink-0" aria-hidden="true" />
            ) : (
              <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            )}
            <span className="text-sm font-semibold text-fg-muted">{scannerLabel(s.scanner)}</span>
            <span className="text-fg-muted truncate">{s.message}</span>
          </div>
        ))}

        {state.steps.length === 0 && !readingResults && (
          <div className="flex items-center gap-2.5 py-1 text-fg-subtle">
            <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse shrink-0" />
            starting...
          </div>
        )}
      </div>
    </div>
  )
}
