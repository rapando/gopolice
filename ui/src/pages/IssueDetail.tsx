import { useState, useEffect } from 'react'
import { GitCommitHorizontal, Lightbulb, LoaderCircle, Undo2, Wrench } from 'lucide-react'
import { getIssue, getSnippet, applyFix, undoFix, Issue, FixResult, Snippet } from '../api/client'
import BackLink from '../components/BackLink'
import CodeSnippet from '../components/CodeSnippet'
import FileLink from '../components/FileLink'
import { SeverityBadge } from '../components/Severity'
import Spinner from '../components/Spinner'
import { navigate } from '../lib/router'
import { categoryTextClass } from '../lib/severity'

interface Props {
  issueId: string
  onBack: () => void
}

export default function IssueDetail({ issueId, onBack }: Props) {
  const [issue, setIssue] = useState<Issue | null>(null)
  const [snippet, setSnippet] = useState<Snippet | null>(null)
  const [fixResult, setFixResult] = useState<FixResult | null>(null)
  const [fixing, setFixing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setIssue(null)
    setSnippet(null)
    setError('')
    getIssue(issueId).then((i) => {
      setIssue(i)
      getSnippet(i.file, i.line).then(setSnippet).catch(() => {})
    }).catch(() => setError('This issue is not in the current scan results. It may have been fixed.'))
  }, [issueId])

  const handleApply = async () => {
    setFixing(true)
    setFixResult(null)
    try {
      setFixResult(await applyFix(issueId))
    } catch (err: any) {
      setFixResult({ applied: false, message: err.message, backup: null })
    }
    setFixing(false)
  }

  const handleUndo = async () => {
    try {
      await undoFix(issueId)
      setFixResult({ applied: true, message: 'Fix undone. The file was restored from its backup.', backup: null })
    } catch (err: any) {
      setFixResult({ applied: false, message: `Undo failed: ${err.message}`, backup: null })
    }
  }

  if (error || !issue) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <BackLink onClick={onBack} />
        {error ? <div className="card p-8 text-center text-fg-muted">{error}</div> : <div className="flex justify-center py-16"><Spinner /></div>}
      </div>
    )
  }

  const canFix = issue.scanner === 'golangci-lint' && ['gofmt', 'gofumpt', 'gci'].includes(issue.rule)
  const blame = issue.git_blame

  return (
    <div className="max-w-5xl mx-auto p-8">
      <BackLink onClick={onBack} />

      <article className="card overflow-hidden">
        <header className="px-6 py-5 border-b border-line">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <SeverityBadge severity={issue.severity} />
            <span className={`text-sm font-medium capitalize ${categoryTextClass(issue.category)}`}>{issue.category}</span>
            <span className="text-fg-subtle">·</span>
            <span className="text-sm font-mono text-fg">{issue.rule}</span>
            <span className="text-sm text-fg-muted">via {issue.scanner}</span>
            {issue.module && <span className="px-1.5 rounded bg-violet-soft text-violet text-xs font-mono">{issue.module}</span>}
          </div>
          <h2 className="text-lg font-semibold leading-snug">{issue.message}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <FileLink file={issue.file} line={issue.line} onClick={() => navigate({ page: 'file', param: issue.file })} className="text-sm" />
            {issue.column > 0 && <span className="text-xs text-fg-muted font-mono">column {issue.column}</span>}
            {blame && (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <GitCommitHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                {blame.author} · <span className="font-mono">{blame.commit.slice(0, 8)}</span> · {new Date(blame.date).toLocaleDateString()}
              </span>
            )}
          </div>
        </header>

        {snippet && <CodeSnippet snippet={snippet} className="border-b border-line" />}

        {issue.solution && (
          <section className="px-6 py-5 border-b border-line">
            <h3 className="label mb-2 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-warning" aria-hidden="true" /> How to fix it
            </h3>
            <p className="text-sm leading-relaxed text-fg max-w-prose">{issue.solution}</p>
          </section>
        )}

        <footer className="px-6 py-4 bg-subtle/50">
          {canFix ? (
            <div className="flex items-center gap-2">
              <button onClick={handleApply} disabled={fixing} className="btn-primary">
                {fixing ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                {fixing ? 'Applying…' : `Run ${issue.rule}`}
              </button>
              {fixResult?.backup && (
                <button onClick={handleUndo} className="btn-secondary">
                  <Undo2 className="w-4 h-4" /> Undo
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">No automatic fix for this rule. Fix it in your editor and re-run the scan.</p>
          )}
          {fixResult && (
            <p className={`mt-3 px-3 py-2 rounded-md text-sm ${fixResult.applied ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
              {fixResult.message}
            </p>
          )}
        </footer>
      </article>
    </div>
  )
}
