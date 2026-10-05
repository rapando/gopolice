import { useState, useEffect, useMemo } from 'react'
import { getSnippet, Issue, Snippet } from '../api/client'
import BackLink from '../components/BackLink'
import CodeSnippet from '../components/CodeSnippet'
import FileLink from '../components/FileLink'
import { SeverityBadge } from '../components/Severity'
import { navigate } from '../lib/router'

interface Props {
  filePath: string
  issues: Issue[]
  onBack: () => void
}

/** Every issue in one file, each with its surrounding source. */
export default function FileView({ filePath, issues, onBack }: Props) {
  const [snippets, setSnippets] = useState<Map<number, Snippet>>(new Map())
  const fileIssues = useMemo(() => issues.filter((i) => i.file === filePath), [issues, filePath])
  const lineNumbers = useMemo(() => [...new Set(fileIssues.map((i) => i.line))].sort((a, b) => a - b), [fileIssues])

  useEffect(() => {
    let cancelled = false
    Promise.all(lineNumbers.map((line) => getSnippet(filePath, line).then((s) => [line, s] as const).catch(() => null)))
      .then((pairs) => {
        if (!cancelled) setSnippets(new Map(pairs.filter((p): p is readonly [number, Snippet] => p !== null)))
      })
    return () => { cancelled = true }
  }, [filePath, lineNumbers])

  return (
    <div className="max-w-5xl mx-auto p-8">
      <BackLink onClick={onBack} />

      <div className="flex items-baseline gap-3 mb-5 min-w-0">
        <FileLink file={filePath} className="text-sm" />
        <span className="text-sm text-fg-muted shrink-0">
          {fileIssues.length} issue{fileIssues.length !== 1 ? 's' : ''}
        </span>
      </div>

      {fileIssues.length === 0 ? (
        <div className="card p-8 text-center text-fg-muted">No issues in this file.</div>
      ) : (
        <div className="space-y-4">
          {lineNumbers.map((line) => {
            const lineIssues = fileIssues.filter((i) => i.line === line)
            const snippet = snippets.get(line)
            return (
              <section key={line} className="card overflow-hidden">
                <ul className="divide-y divide-line">
                  {lineIssues.map((issue) => (
                    <li key={issue.id} className="px-5 py-3 flex items-start gap-3">
                      <SeverityBadge severity={issue.severity} />
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => navigate({ page: 'issue', param: issue.id })}
                          className="text-left text-sm text-fg hover:text-accent hover:underline"
                        >
                          {issue.message}
                        </button>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          <span className="font-mono">{issue.rule}</span> · {issue.scanner}
                        </p>
                      </div>
                      <FileLink file={filePath} line={line} className="shrink-0" />
                    </li>
                  ))}
                </ul>
                {snippet && <CodeSnippet snippet={snippet} className="border-t border-line" />}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
