import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, CircleCheck, CircleX, LoaderCircle, Minus, X } from 'lucide-react'
import {
  formatCount, formatDuration, formatElapsed, overallFraction, scannerLabel, stepFraction,
  type ScanState, type ScanStep,
} from '../lib/scan'

interface Props {
  state: ScanState
  projectName?: string
  /** True while the finished scan's results are still being fetched. */
  readingResults?: boolean
  onClose: () => void
  onViewResults: () => void
}

function useElapsed(state: ScanState): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!state.running) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state.running])
  if (!state.startedAt) return 0
  return (state.finishedAt ?? (state.running ? now : Date.now())) - state.startedAt
}

/** Live view of a running scan: every scanner, its counts, and the log. */
export default function ScanModal({ state, projectName, readingResults, onClose, onViewResults }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const elapsed = useElapsed(state)
  const [showLog, setShowLog] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fraction = overallFraction(state)
  const total = state.pipeline.total || state.steps.length
  const finishedSteps = state.steps.filter((s) => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped').length
  const failedSteps = state.steps.filter((s) => s.status === 'failed').length

  let title = projectName ? `Scanning ${projectName}` : 'Scanning'
  if (state.finished) title = 'Scan complete'
  if (state.failed) title = 'Scan failed'

  return (
    <div
      className="fixed inset-0 z-50 bg-inverse/60 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl outline-none"
      >
        <header className="px-5 py-4 border-b border-line flex items-center gap-3">
          {state.failed ? (
            <CircleX className="w-5 h-5 text-danger shrink-0" aria-hidden="true" />
          ) : state.finished ? (
            <CircleCheck className="w-5 h-5 text-success shrink-0" aria-hidden="true" />
          ) : (
            <LoaderCircle className="w-5 h-5 text-accent animate-spin shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold truncate">{title}</h2>
            <p className="text-xs text-fg-muted font-mono tabular-nums">
              {formatElapsed(elapsed)}
              {total > 0 && <> · {finishedSteps} of {total} scanners{failedSteps > 0 && <span className="text-danger"> · {failedSteps} failed</span>}</>}
              {state.module && <> · module {state.module.done + 1} of {state.module.total}: {state.module.name}</>}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="px-5 pt-4">
          <div className="h-2 bg-subtle rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}>
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${state.failed ? 'bg-danger' : 'bg-accent-solid'} ${fraction === null && state.running ? 'animate-pulse w-1/12' : ''}`}
              style={fraction === null ? undefined : { width: `${Math.max(fraction * 100, state.running ? 2 : 0)}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <ol className="space-y-1" aria-label="Scanners">
            {state.steps.length === 0 && (
              <li className="text-sm text-fg-muted flex items-center gap-2 py-1">
                <LoaderCircle className="w-4 h-4 animate-spin text-accent" aria-hidden="true" /> Starting…
              </li>
            )}
            {state.steps.map((s) => <StepRow key={s.scanner} step={s} />)}
          </ol>

          <section>
            <button
              onClick={() => setShowLog((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
              aria-expanded={showLog}
            >
              {showLog ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
              Log <span className="font-normal normal-case tracking-normal">({state.log.length})</span>
            </button>
            {showLog && <LogView state={state} />}
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-line flex items-center gap-3">
          <p className="text-xs text-fg-muted flex-1 min-w-0 truncate">
            {state.running
              ? 'The scan keeps running if you close this window.'
              : state.summary}
          </p>
          {state.running ? (
            <button onClick={onClose} className="btn-secondary">Hide</button>
          ) : state.finished ? (
            <button onClick={onViewResults} className="btn-primary" disabled={readingResults}>
              {readingResults ? (
                <><LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading results…</>
              ) : (
                <><Check className="w-4 h-4" aria-hidden="true" /> View results</>
              )}
            </button>
          ) : (
            <button onClick={onClose} className="btn-secondary">Close</button>
          )}
        </footer>
      </div>
    </div>
  )
}

function StepIcon({ status }: { status: ScanStep['status'] }) {
  switch (status) {
    case 'running':
      return <LoaderCircle className="w-4 h-4 text-accent animate-spin" aria-hidden="true" />
    case 'completed':
      return <Check className="w-4 h-4 text-success" aria-hidden="true" />
    case 'failed':
      return <X className="w-4 h-4 text-danger" aria-hidden="true" />
    case 'skipped':
      return <Minus className="w-4 h-4 text-fg-subtle" aria-hidden="true" />
    default:
      return <span className="block w-2 h-2 m-1 rounded-full border border-line-strong" aria-hidden="true" />
  }
}

const STATUS_TEXT: Record<ScanStep['status'], string> = {
  pending: 'Pending', running: 'Running', completed: 'Done', failed: 'Failed', skipped: 'Skipped',
}

function StepRow({ step }: { step: ScanStep }) {
  const running = step.status === 'running'
  const pending = step.status === 'pending'
  const count = formatCount(step)
  const fraction = stepFraction(step)

  return (
    <li
      className={`rounded-md px-3 py-2 ${running ? 'bg-accent-soft/60 border border-accent/40' : 'border border-transparent'} ${pending ? 'opacity-60' : ''}`}
      aria-current={running ? 'step' : undefined}
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 w-4 h-4 flex items-center justify-center"><StepIcon status={step.status} /></span>
        <span className="font-medium text-sm w-28 shrink-0">{scannerLabel(step.scanner)}</span>
        <span className={`text-sm truncate flex-1 ${step.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
          {running && count ? (
            <>
              <span className="text-fg font-mono tabular-nums">{count}</span>
              {step.detail && <span className="font-mono text-xs"> · {step.detail}</span>}
            </>
          ) : running && step.detail ? (
            <span className="font-mono text-xs">{step.detail}</span>
          ) : (
            step.message || STATUS_TEXT[step.status]
          )}
        </span>
        <span className="text-xs font-mono tabular-nums text-fg-subtle shrink-0">
          {step.status === 'completed' || step.status === 'failed' ? (step.elapsed ? formatDuration(step.elapsed) : '') : running ? '…' : ''}
        </span>
      </div>
      {running && (step.message || fraction !== null) && (
        <div className="pl-[1.625rem] mt-1 space-y-1">
          {step.message && <p className="text-xs text-fg-muted truncate">{step.message}</p>}
          {fraction !== null && (
            <div className="h-1 bg-subtle rounded-full overflow-hidden">
              <div className="h-full bg-accent-solid rounded-full transition-all duration-300" style={{ width: `${fraction * 100}%` }} />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function LogView({ state }: { state: ScanState }) {
  const ref = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)

  // Follow the newest line unless the reader has scrolled up.
  useEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [state.log.length])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }

  const start = state.startedAt ?? 0
  return (
    <ol
      ref={ref}
      onScroll={onScroll}
      className="mt-2 max-h-48 overflow-auto rounded-md bg-subtle/60 border border-line px-3 py-2 font-mono text-xs space-y-0.5"
      aria-label="Scan log"
      aria-live="polite"
    >
      {state.log.map((l, i) => (
        <li key={i} className={`flex gap-2 ${l.status === 'failed' ? 'text-danger' : l.status === 'completed' ? 'text-fg' : 'text-fg-muted'}`}>
          <span className="text-fg-subtle tabular-nums shrink-0">{formatElapsed(Math.max(0, l.at - start)).padStart(6, ' ')}</span>
          <span className="text-fg-subtle shrink-0 w-24 truncate">{scannerLabel(l.scanner)}</span>
          <span className="break-words min-w-0">{l.text}</span>
        </li>
      ))}
      {state.log.length === 0 && <li className="text-fg-subtle">Waiting for the first event…</li>}
    </ol>
  )
}
