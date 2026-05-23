import { useState, useEffect } from 'react'
import { getIssue, getSnippet, applyFix, undoFix, Issue, FixResult, Snippet } from '../api/client'

interface Props {
  issueId: string
  onBack: () => void
}

const sevBadge: Record<string, string> = {
  error: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-ctp-red',
  warning: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-ctp-yellow',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-ctp-blue',
}

export default function IssueDetail({ issueId, onBack }: Props) {
  const [issue, setIssue] = useState<Issue | null>(null)
  const [snippet, setSnippet] = useState<Snippet | null>(null)
  const [fixResult, setFixResult] = useState<FixResult | null>(null)
  const [fixing, setFixing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getIssue(issueId).then((i) => {
      setIssue(i)
      getSnippet(i.file, i.line).then(setSnippet).catch(() => {})
    }).catch(() => setError('Issue not found'))
  }, [issueId])

  const handleApply = async () => {
    setFixing(true)
    setFixResult(null)
    try {
      const result = await applyFix(issueId)
      setFixResult(result)
    } catch (err: any) {
      setFixResult({ applied: false, message: err.message, backup: null })
    }
    setFixing(false)
  }

  const handleUndo = async () => {
    try {
      await undoFix(issueId)
      setFixResult({ applied: true, message: 'Fix undone — file restored from backup', backup: null })
    } catch (err: any) {
      setFixResult({ applied: false, message: `Undo failed: ${err.message}`, backup: null })
    }
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <button onClick={onBack} className="text-sm text-blue-600 dark:text-ctp-blue hover:underline mb-4">&larr; Back</button>
        <div className="card p-8 text-center">
          <p className="text-red-600 dark:text-ctp-red">{error}</p>
        </div>
      </div>
    )
  }

  if (!issue) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <button onClick={onBack} className="text-sm text-blue-600 dark:text-ctp-blue hover:underline mb-4">&larr; Back</button>
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 dark:border-ctp-blue border-t-transparent" />
        </div>
      </div>
    )
  }

  const canFix = (issue.scanner === 'golangci-lint' &&
    ['gofmt', 'gofumpt', 'gci'].includes(issue.rule))

  return (
    <div className="max-w-4xl mx-auto p-8">
      <button onClick={onBack} className="text-sm text-blue-600 dark:text-ctp-blue hover:underline mb-5">&larr; Back to issues</button>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-ctp-surface1 flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded text-xs font-medium ${sevBadge[issue.severity]}`}>
            {issue.severity.toUpperCase()}
          </span>
          <span className="text-xs font-mono text-gray-500 dark:text-ctp-overlay0">{issue.scanner}</span>
          <span className="text-xs text-gray-400 dark:text-ctp-overlay1">{issue.rule}</span>
        </div>

        <div className="px-6 py-5">
          <p className="text-base font-medium text-gray-800 dark:text-ctp-text mb-3">{issue.message}</p>

          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-ctp-overlay0 mb-6">
            <span className="font-mono text-blue-600 dark:text-ctp-blue">{issue.file}</span>
            <span>:</span>
            <span className="font-mono">{issue.line}</span>
            {issue.column > 0 && <><span>:</span><span className="font-mono">{issue.column}</span></>}
          </div>

          {snippet && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide mb-2">Code</p>
              <div className="bg-gray-50 dark:bg-ctp-mantle border border-gray-200 dark:border-ctp-surface1 rounded overflow-hidden">
                <pre className="text-xs font-mono leading-relaxed overflow-x-auto p-0">
                  {snippet.lines.map((l) => (
                    <div
                      key={l.number}
                      className={`flex ${l.is_issue ? 'bg-red-50 dark:bg-red-950/30 border-l-2 border-red-500' : ''}`}
                    >
                      <span className="text-gray-400 dark:text-ctp-overlay1 text-right w-12 shrink-0 select-none py-0.5 pr-3 border-r border-gray-200 dark:border-ctp-surface1 mr-3">
                        {l.number}
                      </span>
                      <span className={`py-0.5 ${l.is_issue ? 'text-red-800 dark:text-ctp-red font-medium' : 'text-gray-700 dark:text-ctp-subtext0'}`}>
                        {l.content || ' '}
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          )}

          {issue.solution && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide mb-2">How to fix it</p>
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-ctp-blue/30 rounded p-4 text-sm leading-relaxed text-gray-700 dark:text-ctp-subtext0">
                {issue.solution}
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-ctp-surface1 pt-4">
            {canFix ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApply}
                  disabled={fixing}
                  className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {fixing ? 'Applying...' : 'Apply Fix'}
                </button>
                {fixResult?.backup && (
                  <button onClick={handleUndo}
                    className="px-4 py-2 text-sm font-medium bg-gray-200 dark:bg-ctp-surface1 text-gray-700 dark:text-ctp-text rounded hover:bg-gray-300 dark:hover:bg-ctp-surface0 transition-colors">
                    Undo
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-ctp-overlay1">Auto-fix not available for this issue type.</p>
            )}
            {fixResult && (
              <div className={`mt-3 px-4 py-2 rounded text-sm ${
                fixResult.applied
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-ctp-green'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-ctp-red'
              }`}>
                {fixResult.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
