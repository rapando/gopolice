import { useState, useEffect, useRef } from 'react'
import { getSnippet, Issue, Snippet } from '../api/client'

interface Props {
  issues: Issue[]
  onSelectIssue: (id: string) => void
  onSelectFile: (file: string) => void
}

const severities = ['error', 'warning', 'info'] as const

const sevIcon: Record<string, string> = { error: '●', warning: '◆', info: '○' }
const sevColor: Record<string, string> = { error: 'text-red-500', warning: 'text-yellow-500', info: 'text-blue-500' }
const sevBadge: Record<string, string> = {
  error: 'bg-red-50 text-red-700',
  warning: 'bg-yellow-50 text-yellow-700',
  info: 'bg-blue-50 text-blue-700',
}

export default function Issues({ issues, onSelectIssue, onSelectFile }: Props) {
  const [selectedSeverity, setSelectedSeverity] = useState('')
  const [search, setSearch] = useState('')
  const [snippet, setSnippet] = useState<{ file: string; data: Snippet } | null>(null)
  const snippetRef = useRef<HTMLDivElement>(null)

  const filtered = issues.filter((i) => {
    if (selectedSeverity && i.severity !== selectedSeverity) return false
    if (search && !i.message.toLowerCase().includes(search.toLowerCase()) && !i.file.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleFileClick = async (e: React.MouseEvent, file: string, line: number) => {
    e.stopPropagation()
    if (snippet?.file === file) {
      setSnippet(null)
      return
    }
    try {
      const data = await getSnippet(file, line)
      setSnippet({ file, data })
    } catch {
      onSelectFile(file)
    }
  }

  useEffect(() => {
    if (snippet && snippetRef.current) {
      snippetRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [snippet])

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">
        Issues <span className="font-normal text-gray-400 dark:text-ctp-overlay1">({issues.length})</span>
      </h2>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-72"
        />
        <div className="flex gap-1">
          {severities.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedSeverity(selectedSeverity === s ? '' : s)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                selectedSeverity === s
                  ? `${sevBadge[s]} border-current`
                  : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-ctp-surface1 dark:text-ctp-overlay0 dark:hover:bg-ctp-surface0'
              }`}
            >
              <span className={sevColor[s]}>{sevIcon[s]}</span>
              <span className="ml-1.5 capitalize">{s}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-ctp-overlay1 ml-auto">
          {filtered.length} of {issues.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0">No issues match the filters.</p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:bg-ctp-mantle">
                  <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">Severity</th>
                  <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">Message</th>
                  <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">File</th>
                  <th className="text-right px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">Line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-ctp-surface1">
                {filtered.map((issue) => (
                  <tr
                    key={issue.id}
                    className="hover:bg-gray-50 dark:hover:bg-ctp-surface0 cursor-pointer transition-colors"
                    onClick={() => onSelectIssue(issue.id)}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-base ${sevColor[issue.severity]}`}>{sevIcon[issue.severity]}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sevBadge[issue.severity]}`}>
                          {issue.severity}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-ctp-overlay1 font-mono">{issue.scanner}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-700 dark:text-ctp-subtext0 max-w-lg truncate">{issue.message}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={(e) => handleFileClick(e, issue.file, issue.line)}
                        className="text-blue-600 dark:text-ctp-blue hover:underline font-mono text-xs"
                      >
                        {issue.file}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-gray-400 dark:text-ctp-overlay1 font-mono text-xs text-right">{issue.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {snippet && (
            <div ref={snippetRef} className="mt-4 card overflow-hidden">
              <div className="px-5 py-2.5 border-b border-gray-200 dark:border-ctp-surface1 bg-gray-50 dark:bg-ctp-mantle flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 dark:text-ctp-subtext0 font-mono">{snippet.file}</span>
                <button
                  onClick={() => setSnippet(null)}
                  className="text-xs text-gray-400 dark:text-ctp-overlay1 hover:text-gray-600 dark:hover:text-ctp-subtext0"
                >
                  Close
                </button>
              </div>
              <pre className="text-xs font-mono leading-relaxed overflow-x-auto p-0">
                {snippet.data.lines.map((l) => (
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
          )}
        </>
      )}
    </div>
  )
}
