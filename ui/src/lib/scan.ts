import type { ProgressEvent } from '../api/client'

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** One scanner's place in the current scan. */
export interface ScanStep {
  scanner: string
  status: StepStatus
  /** Last lifecycle or sub-stage message, e.g. "Running gosec". */
  message: string
  /** Item-level progress while running: done of total unit, on detail. */
  done: number
  total: number
  unit: string
  detail: string
  /** Wall-clock the scanner reported, in nanoseconds, once finished. */
  elapsed: number
  startedAt: number | null
  finishedAt: number | null
}

export interface ScanState {
  /** A scan has started and has not finished or failed yet. */
  running: boolean
  finished: boolean
  failed: boolean
  startedAt: number | null
  finishedAt: number | null
  /** The pipeline's closing message. */
  summary: string
  /** Scanners in run order; pending ones come from the pipeline's step list. */
  steps: ScanStep[]
  /** Scanners finished so far, of those planned. */
  pipeline: { done: number; total: number }
  /** Set for go.work workspaces: which module is being scanned. */
  module: { done: number; total: number; name: string } | null
  /** Lifecycle messages in order (ticks are folded into steps instead). */
  log: LogLine[]
  /** Event sequence numbers already applied, for replayed streams. */
  seen: Set<number>
}

export interface LogLine {
  at: number
  scanner: string
  status: string
  text: string
}

const MAX_LOG = 500

export const SCANNER_LABELS: Record<string, string> = {
  lint: 'Lint',
  security: 'Security',
  tests: 'Tests',
  benchmarks: 'Benchmarks',
  benchmark: 'Benchmarks',
  profile: 'Profile',
  deadcode: 'Dead code',
  depgraph: 'Dependencies',
  git: 'Git',
  complexity: 'Complexity',
  filestats: 'Files',
  pipeline: 'Scan',
  workspace: 'Workspace',
}

export function scannerLabel(name: string): string {
  return SCANNER_LABELS[name] ?? name
}

export function emptyScanState(): ScanState {
  return {
    running: false, finished: false, failed: false,
    startedAt: null, finishedAt: null, summary: '',
    steps: [], pipeline: { done: 0, total: 0 }, module: null,
    log: [], seen: new Set(),
  }
}

/** The state right after the user presses Run scan, before any event arrives. */
export function startingScanState(): ScanState {
  return { ...emptyScanState(), running: true, startedAt: Date.now() }
}

function newStep(scanner: string): ScanStep {
  return {
    scanner, status: 'pending', message: '', done: 0, total: 0, unit: '', detail: '',
    elapsed: 0, startedAt: null, finishedAt: null,
  }
}

/** True for item-level updates (counts and the current item, no message). */
export function isTick(e: ProgressEvent): boolean {
  return e.status === 'running' && !e.message && ((e.total ?? 0) > 0 || !!e.detail)
}

/** "4 of 100 tests", "12 packages", or "" when the step has no counts. */
export function formatCount(step: { done: number; total: number; unit: string }): string {
  if (step.total > 0) return `${step.done} of ${step.total} ${step.unit}`.trim()
  if (step.done > 0) return `${step.done} ${step.unit}`.trim()
  return ''
}

/** Fraction complete for a step with counts, or null. */
export function stepFraction(step: ScanStep): number | null {
  if (step.total <= 0) return null
  return Math.min(1, step.done / step.total)
}

/**
 * Overall completion: finished scanners count fully, the running one by its
 * own counts. Null until the pipeline has announced how many scanners run.
 */
export function overallFraction(state: ScanState): number | null {
  const total = state.pipeline.total || state.steps.length
  if (total === 0) return state.finished ? 1 : null
  let done = 0
  for (const s of state.steps) {
    if (s.status === 'completed' || s.status === 'failed' || s.status === 'skipped') done += 1
    else if (s.status === 'running') done += stepFraction(s) ?? 0
  }
  return Math.min(1, done / total)
}

export function applyEvent(prev: ScanState, e: ProgressEvent): ScanState {
  if (e.seq && prev.seen.has(e.seq)) return prev
  const now = Date.now()

  // A new scan starting replaces everything from the previous one.
  if (e.scanner === 'pipeline' && e.status === 'started') {
    const next = emptyScanState()
    next.running = true
    next.startedAt = now
    if (e.seq) next.seen.add(e.seq)
    next.log.push({ at: now, scanner: e.scanner, status: e.status, text: e.message ?? 'Starting scan' })
    return next
  }

  const state: ScanState = {
    ...prev,
    steps: prev.steps.map((s) => ({ ...s })),
    log: prev.log,
    seen: new Set(prev.seen),
    pipeline: { ...prev.pipeline },
    module: prev.module ? { ...prev.module } : null,
  }
  if (e.seq) state.seen.add(e.seq)
  if (!state.running && !state.finished && !state.failed) {
    // Events without a preceding start (e.g. a server that started scanning
    // before this page subscribed and whose log was trimmed).
    state.running = true
    state.startedAt = state.startedAt ?? now
  }

  if (e.steps && e.steps.length > 0) {
    // Keep what we know about scanners already seen; add the planned ones.
    const known = new Map(state.steps.map((s) => [s.scanner, s]))
    state.steps = e.steps.map((name) => known.get(name) ?? newStep(name))
    state.pipeline.total = e.steps.length
  }

  const tick = isTick(e)
  if (!tick) {
    const text = e.message || (e.status === 'failed' ? 'failed' : e.status)
    const log = state.log.length >= MAX_LOG ? state.log.slice(state.log.length - MAX_LOG + 1) : state.log.slice()
    log.push({ at: now, scanner: e.scanner, status: e.status, text })
    state.log = log
  }

  if (e.scanner === 'pipeline') {
    if (e.total) state.pipeline.total = e.total
    if (e.done !== undefined) state.pipeline.done = e.done
    if (e.status === 'completed') {
      state.running = false
      state.finished = true
      state.finishedAt = now
      state.summary = e.message ?? 'Scan complete'
      // Anything still marked running was cut short.
      for (const s of state.steps) if (s.status === 'running') { s.status = 'completed'; s.finishedAt = now }
      state.pipeline.done = state.pipeline.total
    } else if (e.status === 'failed') {
      state.running = false
      state.failed = true
      state.finishedAt = now
      state.summary = e.message ?? 'Scan failed'
      for (const s of state.steps) if (s.status === 'running') { s.status = 'failed'; s.finishedAt = now }
    }
    return state
  }

  if (e.scanner === 'workspace') {
    if (e.total) state.module = { done: e.done ?? 0, total: e.total, name: e.detail ?? '' }
    else if (e.status === 'completed') state.module = null
    return state
  }

  let step = state.steps.find((s) => s.scanner === e.scanner)
  if (!step) {
    step = newStep(e.scanner)
    state.steps.push(step)
  }

  switch (e.status) {
    case 'started':
      Object.assign(step, newStep(e.scanner), { status: 'running', message: e.message ?? '', startedAt: now })
      break
    case 'running':
      if (step.status === 'pending') { step.status = 'running'; step.startedAt = now }
      if (e.message) step.message = e.message
      if (e.total !== undefined && e.total > 0) step.total = e.total
      if (e.done !== undefined) step.done = e.done
      if (e.unit) step.unit = e.unit
      if (e.detail !== undefined) step.detail = e.detail
      break
    case 'completed':
    case 'failed':
    case 'skipped':
      step.status = e.status
      step.message = e.message ?? ''
      step.detail = ''
      step.elapsed = e.elapsed ?? 0
      step.finishedAt = now
      if (step.total > 0) step.done = step.total
      state.pipeline.done = state.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
      break
  }
  return state
}

/** Elapsed time as "1m 05s" or "12s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

/** Nanoseconds (Go duration) as "1.2s" or "340ms". */
export function formatDuration(ns: number): string {
  const ms = ns / 1e6
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return formatElapsed(ms)
}
