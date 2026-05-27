import { useEffect, useState } from 'react'
import type { ProgressEvent } from '../api/client'

interface Props {
  events: ProgressEvent[]
  readingResults?: boolean
}

const scannerInfo: Record<string, { label: string; color: string }> = {
  lint:       { label: 'Lint',       color: 'text-blue-600 dark:text-ctp-blue' },
  security:   { label: 'Security',   color: 'text-orange-600 dark:text-ctp-peach' },
  tests:      { label: 'Tests',      color: 'text-green-600 dark:text-ctp-green' },
  benchmark:  { label: 'Benchmark',  color: 'text-purple-600 dark:text-ctp-mauve' },
  profile:    { label: 'Profile',    color: 'text-indigo-600 dark:text-ctp-lavender' },
  deadcode:   { label: 'Dead Code',  color: 'text-rose-600 dark:text-ctp-maroon' },
  depgraph:   { label: 'Deps',       color: 'text-teal-600 dark:text-ctp-teal' },
  git:        { label: 'Git',        color: 'text-cyan-600 dark:text-ctp-sky' },
  complexity: { label: 'Complexity', color: 'text-violet-600 dark:text-ctp-mauve' },
  filestats:  { label: 'Files',      color: 'text-gray-600 dark:text-ctp-overlay1' },
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

      <div className="rounded-xl border border-gray-200 dark:border-ctp-surface1 bg-white dark:bg-ctp-surface0 p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            {readingResults ? (
              <span className="relative flex w-5 h-5">
                <span className="animate-ping absolute inset-0 rounded-full bg-blue-400/30 dark:bg-ctp-sky/30" />
                <span className="relative rounded-full w-5 h-5 border-2 border-blue-500 dark:border-ctp-sky border-t-transparent animate-spin" />
              </span>
            ) : (
              <span className="relative flex w-4 h-4">
                <span className="absolute inset-0 rounded-full border-2 border-blue-500/30 dark:border-ctp-sky/30" />
                <span className="absolute inset-0 rounded-full border-2 border-blue-500 dark:border-ctp-sky border-t-transparent animate-spin" />
              </span>
            )}
            <span className="text-sm font-semibold text-gray-800 dark:text-ctp-text">
              {readingResults ? 'Reading results' : 'Scanning'}
            </span>
            {readingResults && (
              <span className="flex items-center gap-0.5 self-center mb-0.5">
                <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-ctp-overlay1 animate-bounce" style={{ animationDelay: '0s' }} />
                <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-ctp-overlay1 animate-bounce" style={{ animationDelay: '0.15s' }} />
                <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-ctp-overlay1 animate-bounce" style={{ animationDelay: '0.3s' }} />
              </span>
            )}
            {!readingResults && <span className="text-xs font-mono tabular-nums text-gray-400 dark:text-ctp-overlay1">{formatTime(elapsed)}</span>}
          </div>
          <span className="text-xs font-mono tabular-nums text-gray-400 dark:text-ctp-overlay1/70">{completedCount}/{totalCount}</span>
        </div>

        {/* Progress bar or reading results */}
        {readingResults ? (
          <div className="mb-4 flex items-center gap-3 text-xs text-gray-500 dark:text-ctp-overlay1">
            <span>Scan completed in {formatTime(elapsed)}</span>
            <span className="text-gray-300 dark:text-ctp-surface1">&middot;</span>
            <span>{completedCount} scanners ran</span>
          </div>
        ) : (
          <div className="h-2 bg-gray-100 dark:bg-ctp-surface1 rounded-full overflow-hidden mb-4 relative">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 dark:from-ctp-sky dark:via-ctp-blue dark:to-ctp-sky rounded-full transition-all duration-700 ease-out relative overflow-hidden"
              style={{ width: `${Math.max(progressPct, steps.length > 0 ? 4 : 0)}%` }}
            >
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/25 to-transparent shimmer" />
            </div>
          </div>
        )}

        {/* Step list */}
        <div className="font-mono text-[13px] space-y-0.5">
          {/* Current step */}
          {current && !readingResults && (
            <div className="flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-md bg-blue-50/70 dark:bg-ctp-surface1/50 border border-blue-200/50 dark:border-ctp-surface1">
              <span className="w-2 h-2 rounded-full bg-blue-500 dark:bg-ctp-sky animate-pulse shrink-0" />
              <span className={`text-sm font-semibold ${scannerInfo[current.scanner]?.color || 'text-gray-700 dark:text-ctp-subtext0'}`}>
                {scannerInfo[current.scanner]?.label || current.scanner}
              </span>
              <span className="text-gray-500 dark:text-ctp-overlay1 truncate">{current.message}</span>
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
                      <svg className="w-3.5 h-3.5 text-red-500 dark:text-ctp-red shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-green-500 dark:text-ctp-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className={`text-[13px] font-semibold ${info?.color || 'text-gray-600 dark:text-ctp-subtext0'}`}>
                      {info?.label || s.scanner}
                    </span>
                    <span className="text-gray-500 dark:text-ctp-overlay1 truncate">{s.message}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Waiting */}
          {steps.length === 0 && !readingResults && (
            <div className="flex items-center gap-2.5 py-1 text-gray-400 dark:text-ctp-overlay0">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-ctp-surface1 animate-pulse shrink-0" />
              starting...
            </div>
          )}
        </div>
      </div>
    </>
  )
}
