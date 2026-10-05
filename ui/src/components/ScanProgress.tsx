import { useEffect, useState } from 'react'
import type { ProgressEvent } from '../api/client'

interface Props {
  events: ProgressEvent[]
  readingResults?: boolean
}

const scannerInfo: Record<string, { label: string; color: string }> = {
  lint:       { label: 'Lint',       color: 'text-fg' },
  security:   { label: 'Security',   color: 'text-fg' },
  tests:      { label: 'Tests',      color: 'text-fg' },
  benchmark:  { label: 'Benchmark',  color: 'text-fg' },
  profile:    { label: 'Profile',    color: 'text-fg' },
  deadcode:   { label: 'Dead Code',  color: 'text-fg' },
  depgraph:   { label: 'Deps',       color: 'text-fg' },
  git:        { label: 'Git',        color: 'text-fg' },
  complexity: { label: 'Complexity', color: 'text-fg' },
  filestats:  { label: 'Files',      color: 'text-fg' },
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export default function ScanProgress({ events, readingResults }: Props) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (events.length === 0) {
      setElapsed(0)
      return
    }
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 200)
    return () => clearInterval(id)
  }, [events.length === 0])

  const seen = new Set<string>()
  const steps: ProgressEvent[] = []
  for (const e of events) {
    if (e.scanner === 'pipeline' || e.scanner === 'workspace') continue
    if (!seen.has(e.scanner)) {
      seen.add(e.scanner)
      steps.push(e)
    } else {
      const idx = steps.findIndex((s) => s.scanner === e.scanner)
      if (idx >= 0) steps[idx] = e
    }
  }

  const completedCount = steps.filter((s) => s.status === 'completed' || s.status === 'failed').length
  const totalCount = Math.max(completedCount, steps.length)
  const pending = steps.filter((s) => s.status !== 'completed' && s.status !== 'failed')
  const current = pending.length > 0 ? pending[pending.length - 1] : null
  const done = steps.filter((s) => s.status === 'completed' || s.status === 'failed')
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .shimmer {
          animation: shimmer 1.8s ease-in-out infinite;
        }
      `}</style>

      <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            {readingResults ? (
              <span className="relative flex w-5 h-5">
                <span className="animate-ping absolute inset-0 rounded-full bg-accent-solid/30" />
                <span className="relative rounded-full w-5 h-5 border-2 border-accent border-t-transparent animate-spin" />
              </span>
            ) : (
              <span className="relative flex w-4 h-4">
                <span className="absolute inset-0 rounded-full border-2 border-accent/30" />
                <span className="absolute inset-0 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              </span>
            )}
            <span className="text-sm font-semibold text-fg">
              {readingResults ? 'Reading results' : 'Scanning'}
            </span>
            {readingResults && (
              <span className="flex items-center gap-0.5 self-center mb-0.5">
                <span className="w-1 h-1 rounded-full bg-line-strong animate-bounce" style={{ animationDelay: '0s' }} />
                <span className="w-1 h-1 rounded-full bg-line-strong animate-bounce" style={{ animationDelay: '0.15s' }} />
                <span className="w-1 h-1 rounded-full bg-line-strong animate-bounce" style={{ animationDelay: '0.3s' }} />
              </span>
            )}
            {!readingResults && <span className="text-xs font-mono tabular-nums text-fg-subtle">{formatTime(elapsed)}</span>}
          </div>
          <span className="text-xs font-mono tabular-nums text-fg-subtle">{completedCount}/{totalCount}</span>
        </div>

        {/* Progress bar or reading results */}
        {readingResults ? (
          <div className="mb-4 flex items-center gap-3 text-xs text-fg-muted">
            <span>Scan completed in {formatTime(elapsed)}</span>
            <span className="text-line-strong">&middot;</span>
            <span>{completedCount} scanners ran</span>
          </div>
        ) : (
          <div className="h-2 bg-subtle rounded-full overflow-hidden mb-4 relative">
            <div
              className="h-full bg-gradient-to-r from-accent via-accent to-accent rounded-full transition-all duration-700 ease-out relative overflow-hidden"
              style={{ width: `${Math.max(progressPct, steps.length > 0 ? 4 : 0)}%` }}
            >
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/25 to-transparent shimmer" />
            </div>
          </div>
        )}

        {/* Step list */}
        <div className="font-mono text-sm space-y-0.5">
          {/* Current step */}
          {current && !readingResults && (
            <div className="flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-md bg-accent-soft/70 border border-accent/50">
              <span className="w-2 h-2 rounded-full bg-accent-solid animate-pulse shrink-0" />
              <span className={`text-sm font-semibold ${scannerInfo[current.scanner]?.color || 'text-fg'}`}>
                {scannerInfo[current.scanner]?.label || current.scanner}
              </span>
              <span className="text-fg-muted truncate">{current.message}</span>
            </div>
          )}

          {/* Completed steps */}
          {done.length > 0 && (
            <div className={current && !readingResults ? 'pt-0.5' : ''}>
              {[...done].reverse().slice(0, 8).map((s) => {
                const info = scannerInfo[s.scanner]
                return (
                  <div key={s.scanner} className="flex items-center gap-2.5 py-1 px-2 -mx-2">
                    {s.status === 'failed' ? (
                      <svg className="w-3.5 h-3.5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className={`text-sm font-semibold ${info?.color || 'text-fg-muted'}`}>
                      {info?.label || s.scanner}
                    </span>
                    <span className="text-fg-muted truncate">{s.message}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Waiting */}
          {steps.length === 0 && !readingResults && (
            <div className="flex items-center gap-2.5 py-1 text-fg-subtle">
              <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse shrink-0" />
              starting...
            </div>
          )}
        </div>
      </div>
    </>
  )
}
