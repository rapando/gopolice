import { CircleCheck, Inbox, Play, type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  message: string
  /** Extra line under the message, e.g. what would populate this view. */
  hint?: string
  /** "clean" for a good outcome (no issues found), "empty" for missing data. */
  tone?: 'clean' | 'empty'
  onScan?: () => void
  scanning?: boolean
}

// Shared "nothing here" card, so the run-a-scan affordance is consistent.
export default function EmptyState({ message, hint, tone = 'empty', onScan, scanning }: EmptyStateProps) {
  const Icon: LucideIcon = tone === 'clean' ? CircleCheck : Inbox
  return (
    <div className="card px-6 py-12 flex flex-col items-center text-center">
      <Icon className={`w-8 h-8 mb-3 ${tone === 'clean' ? 'text-success' : 'text-fg-subtle'}`} aria-hidden="true" />
      <p className="text-base font-medium">{message}</p>
      {hint && <p className="mt-1 text-sm text-fg-muted max-w-md">{hint}</p>}
      {onScan && tone === 'empty' && (
        <button onClick={onScan} disabled={scanning} className="btn-primary mt-5">
          <Play className="w-4 h-4" aria-hidden="true" />
          {scanning ? 'Scanning…' : 'Run scan'}
        </button>
      )}
    </div>
  )
}
