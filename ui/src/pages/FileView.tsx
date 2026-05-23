import { useState, useEffect } from 'react'
import { getSnippet, Issue, Snippet } from '../api/client'

interface Props {
  filePath: string
  issues: Issue[]
  onBack: () => void
}

const sevIcon: Record<string, string> = { error: '●', warning: '◆', info: '○' }
const sevColor: Record<string, string> = { error: 'text-red-500', warning: 'text-yellow-500', info: 'text-blue-500' }

export default function FileView({ filePath, issues, onBack }: Props) {
  const [snippets, setSnippets] = useState<Map<number, Snippet>>(new Map())
  const fileIssues = issues.filter((i) => i.file === filePath)
  const lineNumbers = [...new Set(fileIssues.map((i) => i.line))].sort((a, b) => a - b)

  useEffect(() => {
    const load = async () => {
      const m = new Map<number, Snippet>()
      for (const line of lineNumbers) {
        try {
          const s = await getSnippet(filePath, line)
          m.set(line, s)
        } catch {}
      }
      setSnippets(m)
    }
    if (lineNumbers.length > 0) load()
  }, [filePath, lineNumbers.join(',')])

  return (
    <div className="max-w-5xl mx-auto p-8">
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline mb-4">&larr; Back</button>

      <div className="flex items-baseline gap-3 mb-5">
        <h2 className="text-base font-bold font-mono text-gray-800 truncate">{filePath}</h2>
        <span className="text-sm text-gray-400 shrink-0">
          {fileIssues.length} issue{fileIssues.length !== 1 ? 's' : ''}
        </span>
      </div>

      {fileIssues.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500">No issues in this file.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {lineNumbers.map((line) => {
            const lineIssues = fileIssues.filter((i) => i.line === line)
            const snippet = snippets.get(line)
            return (
              <div key={line} className="card overflow-hidden">
                <div className="px-5 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600 font-mono">Line {line}</span>
                  <span className="text-xs text-gray-400">
                    {lineIssues.length} issue{lineIssues.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {lineIssues.map((issue) => (
                  <div key={issue.id} className="px-5 py-2 flex items-start gap-3 border-b border-gray-100 last:border-0">
                    <span className={`text-base shrink-0 pt-0.5 ${sevColor[issue.severity]}`}>{sevIcon[issue.severity]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium uppercase text-gray-400">{issue.severity}</span>
                        <span className="text-xs text-gray-400 font-mono">{issue.scanner}:{issue.rule}</span>
                      </div>
                      <p className="text-sm text-gray-700">{issue.message}</p>
                    </div>
                  </div>
                ))}

                {snippet && (
                  <pre className="text-xs font-mono leading-relaxed overflow-x-auto border-t border-gray-200">
                    {snippet.lines.map((l) => (
                      <div
                        key={l.number}
                        className={`flex ${l.is_issue ? 'bg-red-50 border-l-2 border-red-500' : ''}`}
                      >
                        <span className="text-gray-400 text-right w-12 shrink-0 select-none py-0.5 pr-3 border-r border-gray-200 mr-3">
                          {l.number}
                        </span>
                        <span className={`py-0.5 ${l.is_issue ? 'text-red-800 font-medium' : 'text-gray-700'}`}>
                          {l.content || ' '}
                        </span>
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
