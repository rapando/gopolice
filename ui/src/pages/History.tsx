import { useEffect, useState } from 'react'
import { HistoryEntry, DiffResult, ScanResult, getHistoryList, getHistoryEntry, getHistoryDiff, deleteHistoryEntry, severityBadge, categoryColor, durationStr } from '../api/client'

interface Props {
  onLoadResult?: (result: ScanResult, label: string) => void
}

export default function History({ onLoadResult }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [entry, setEntry] = useState<ScanResult | null>(null)
  const [diffFrom, setDiffFrom] = useState<string | null>(null)
  const [diffTo, setDiffTo] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [showSecurity, setShowSecurity] = useState(false)
  const [showIssues, setShowIssues] = useState(false)

  const loadList = () => {
    setLoading(true)
    getHistoryList().then((list) => {
      setEntries(list)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { loadList() }, [])

  const findEntry = (id: string) => entries.find(e => e.id === id)

  const tsDisplay = (id: string) => {
    const e = findEntry(id)
    return e ? new Date(e.timestamp).toLocaleString() : id
  }

  const viewEntry = async (id: string) => {
    setSelected(id)
    setDiff(null)
    setDiffFrom(null)
    setDiffTo(null)
    setShowIssues(false)
    setShowSecurity(false)
    const result = await getHistoryEntry(id)
    setEntry(result)
  }

  const toggleDiff = (id: string) => {
    if (diffFrom && diffFrom !== id && !diffTo) {
      setDiffTo(id)
      setSelected(null)
      setEntry(null)
    } else if (diffTo && diffTo !== id && !diffFrom) {
      setDiffTo(id)
      setSelected(null)
      setEntry(null)
    } else {
      setDiffFrom(id)
      setDiffTo(null)
      setDiff(null)
    }
  }

  const runDiff = async () => {
    if (!diffFrom || !diffTo) return
    const r = await getHistoryDiff(diffFrom, diffTo)
    setDiff(r)
  }

  const deleteEntry = async (id: string) => {
    await deleteHistoryEntry(id)
    loadList()
    if (selected === id) { setSelected(null); setEntry(null) }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Scan History</h2>

      {entries.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0">No scan history yet. Run <code className="text-xs bg-gray-100 dark:bg-ctp-surface0 px-1 rounded">gopolice scan</code> to create one.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-5">
            <div className="card px-5 py-4">
              <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Total Scans</p>
              <p className="text-base font-semibold">{entries.length}</p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Latest Issues</p>
              <p className="text-base font-semibold">{entries[0]?.total_issues ?? 0}</p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Latest Tests</p>
              <p className="text-base font-semibold">{entries[0]?.total_tests ?? 0}</p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Project</p>
              <p className="text-base font-semibold truncate">{entries[0]?.project_name ?? '-'}</p>
            </div>
          </div>

          <div className="card mb-5 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium dark:bg-ctp-surface0 dark:border-ctp-surface1">
              <span className="w-4 shrink-0" />
              <span className="w-9 shrink-0" />
              <span className="w-36 shrink-0">Date</span>
              <span className="w-16 shrink-0">Issues</span>
              <span className="w-16 shrink-0">Tests</span>
              <span className="flex-1" />
              <span className="w-16 shrink-0 text-center">Duration</span>
              <span className="w-6 shrink-0" />
            </div>
            <div className="divide-y divide-gray-100 dark:divide-ctp-surface0">
              {entries.map((e) => {
                const isSelected = selected === e.id
                const isDiffFrom = diffFrom === e.id
                const isDiffTo = diffTo === e.id
                const inDiff = isDiffFrom || isDiffTo
                return (
                  <div key={e.id}>
                    <div
                      className={`flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors ${
                        isSelected ? 'bg-blue-50 dark:bg-ctp-surface0' : ''
                      } ${inDiff ? 'bg-yellow-50 dark:bg-ctp-surface0' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={inDiff}
                        onChange={() => toggleDiff(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="shrink-0"
                      />
                      <span className={`w-9 shrink-0 text-center text-xs font-bold rounded ${
                        e.grade === 'A' ? 'text-green-600 dark:text-ctp-green' :
                        e.grade === 'B' ? 'text-green-500 dark:text-ctp-teal' :
                        e.grade === 'C' ? 'text-yellow-600 dark:text-ctp-yellow' :
                        e.grade === 'D' ? 'text-orange-500 dark:text-ctp-peach' :
                        e.grade === 'F' ? 'text-red-600 dark:text-ctp-red' : ''
                      }`}>{e.grade || '-'}</span>
                      <button className="flex-1 flex items-center gap-3 text-left" onClick={() => viewEntry(e.id)}>
                        <span className="text-xs text-gray-400 dark:text-ctp-overlay0 font-mono w-36 shrink-0">
                          {new Date(e.timestamp).toLocaleString()}
                        </span>
                        <span className="text-sm text-gray-800 dark:text-ctp-text font-medium w-16 shrink-0">{e.total_issues}</span>
                        <span className="text-xs text-gray-500 dark:text-ctp-overlay0 w-16 shrink-0">{e.total_tests}</span>
                        <span className="flex-1" />
                        <span className="text-xs text-gray-400 dark:text-ctp-overlay0 font-mono w-16 shrink-0 text-right">
                          {durationStr(e.duration)}
                        </span>
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id) }}
                        className="text-xs text-gray-400 hover:text-red-500 dark:text-ctp-overlay0 dark:hover:text-ctp-red shrink-0 w-6 text-right"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {diffFrom && diffTo && !diff && (
            <div className="mb-5">
              <button onClick={runDiff} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
                Compare selected scans
              </button>
              <span className="ml-2 text-xs text-gray-400 dark:text-ctp-overlay0">
                {tsDisplay(diffFrom)} vs {tsDisplay(diffTo)}
              </span>
            </div>
          )}

          {diff && (
            <div className="card mb-5">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-ctp-surface0 flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">
                  Diff: {tsDisplay(diff.from)} → {tsDisplay(diff.to)}
                </p>
                <button onClick={() => { setDiff(null); setDiffFrom(null); setDiffTo(null) }} className="text-xs text-gray-400 hover:text-gray-600 dark:text-ctp-overlay0 dark:hover:text-ctp-text">
                  Clear
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-ctp-surface0">
                {diff.new.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-xs font-medium text-red-600 dark:text-ctp-red mb-2">New Issues ({diff.new.length})</p>
                    {diff.new.map((issue) => (
                      <p key={issue.id} className="text-xs text-gray-700 dark:text-ctp-subtext0 font-mono mb-1">
                        <span className={`inline-block w-14 text-center rounded text-[10px] font-medium ${severityBadge(issue.severity)}`}>{issue.severity}</span>
                        {' '}{issue.file}:{issue.line} — {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                {diff.resolved.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-xs font-medium text-green-600 dark:text-ctp-green mb-2">Resolved Issues ({diff.resolved.length})</p>
                    {diff.resolved.map((issue) => (
                      <p key={issue.id} className="text-xs text-gray-500 dark:text-ctp-overlay0 font-mono line-through mb-1">
                        <span className={`inline-block w-14 text-center rounded text-[10px] font-medium ${severityBadge(issue.severity)}`}>{issue.severity}</span>
                        {' '}{issue.file}:{issue.line} — {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                {diff.unchanged.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-xs font-medium text-gray-500 dark:text-ctp-overlay0 mb-2">Unchanged ({diff.unchanged.length})</p>
                  </div>
                )}
                {diff.new.length === 0 && diff.resolved.length === 0 && (
                  <div className="px-5 py-4 text-center text-xs text-gray-400 dark:text-ctp-overlay0">No changes — same issues in both scans.</div>
                )}
              </div>
            </div>
          )}

          {selected && entry && !diff && (
            <div className="space-y-5">
              <div className="card">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-ctp-surface0 flex items-center justify-between">
                  <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">
                    Scan Results — {tsDisplay(selected)}
                  </p>
                  {onLoadResult && (
                    <button
                      onClick={() => onLoadResult(entry, tsDisplay(selected))}
                      className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Browse full results
                    </button>
                  )}
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-gray-400 dark:text-ctp-overlay0">Issues</p>
                      <p className="text-base font-semibold text-gray-800 dark:text-ctp-text">{entry.issues.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 dark:text-ctp-overlay0">Files</p>
                      <p className="text-base font-semibold text-gray-800 dark:text-ctp-text">{entry.total_files}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 dark:text-ctp-overlay0">Duration</p>
                      <p className="text-base font-semibold text-gray-800 dark:text-ctp-text">{durationStr(entry.duration)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 dark:text-ctp-overlay0">Git</p>
                      <p className="text-base font-semibold text-gray-800 dark:text-ctp-text truncate font-mono text-sm">
                        {entry.git_info ? `${entry.git_info.branch} @ ${entry.git_info.commit.slice(0, 7)}` : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <button
                  onClick={() => setShowIssues(!showIssues)}
                  className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors"
                >
                  <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">
                    Issues ({entry.issues.length})
                  </p>
                  <svg className={`w-3 h-3 text-gray-400 transition-transform ${showIssues ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showIssues && (
                  <div className="divide-y divide-gray-100 dark:divide-ctp-surface0 max-h-80 overflow-y-auto">
                    {entry.issues.length === 0 ? (
                      <div className="px-5 py-4 text-center text-xs text-gray-400 dark:text-ctp-overlay0">No issues.</div>
                    ) : (
                      entry.issues.map((issue) => (
                        <div key={issue.id} className="px-5 py-2.5 text-xs">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`inline-block w-14 text-center rounded text-[10px] font-medium ${severityBadge(issue.severity)}`}>{issue.severity}</span>
                            <span className={"font-medium " + categoryColor(issue.category)}>{issue.category}</span>
                            <span className="text-gray-400 dark:text-ctp-overlay0 font-mono">{issue.scanner}</span>
                          </div>
                          <p className="text-gray-700 dark:text-ctp-subtext0">{issue.message}</p>
                          <p className="text-gray-400 dark:text-ctp-overlay0 font-mono">{issue.file}:{issue.line}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="card">
                <button
                  onClick={() => setShowSecurity(!showSecurity)}
                  className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors"
                >
                  <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">
                    Security Issues ({entry.issues.filter(i => i.category === 'security').length})
                  </p>
                  <svg className={`w-3 h-3 text-gray-400 transition-transform ${showSecurity ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSecurity && (
                  <div className="divide-y divide-gray-100 dark:divide-ctp-surface0 max-h-80 overflow-y-auto">
                    {(() => {
                      const sec = entry.issues.filter(i => i.category === 'security')
                      return sec.length === 0 ? (
                        <div className="px-5 py-4 text-center text-xs text-gray-400 dark:text-ctp-overlay0">No security issues.</div>
                      ) : (
                        sec.map((issue) => (
                          <div key={issue.id} className="px-5 py-2.5 text-xs">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`inline-block w-14 text-center rounded text-[10px] font-medium ${severityBadge(issue.severity)}`}>{issue.severity}</span>
                              <span className="text-gray-400 dark:text-ctp-overlay0 font-mono">{issue.scanner}/{issue.rule}</span>
                            </div>
                            <p className="text-gray-700 dark:text-ctp-subtext0">{issue.message}</p>
                            <p className="text-gray-400 dark:text-ctp-overlay0 font-mono">{issue.file}:{issue.line}</p>
                          </div>
                        ))
                      )
                    })()}
                  </div>
                )}
              </div>

              {entry.test_results && (
                <div className="card">
                  <div className="px-5 py-3 border-b border-gray-100 dark:border-ctp-surface0">
                    <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">Test Results</p>
                  </div>
                  <div className="px-5 py-4">
                    <div className="flex gap-4 text-sm mb-3">
                      <span className="font-medium text-gray-800 dark:text-ctp-text">{entry.test_results.total.total} total</span>
                      <span className="text-green-600 dark:text-ctp-green">{entry.test_results.total.passed} passed</span>
                      {entry.test_results.total.failed > 0 && <span className="text-red-600 dark:text-ctp-red">{entry.test_results.total.failed} failed</span>}
                      {entry.test_results.total.skipped > 0 && <span className="text-yellow-600 dark:text-ctp-yellow">{entry.test_results.total.skipped} skipped</span>}
                    </div>
                    <div className="space-y-1">
                      {entry.test_results.packages.map((pkg, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className={`w-14 text-center rounded text-[10px] font-medium ${
                            pkg.status === 'pass' ? 'bg-green-100 text-green-700 dark:bg-ctp-surface0 dark:text-ctp-green' :
                            pkg.status === 'fail' ? 'bg-red-100 text-red-700 dark:bg-ctp-surface0 dark:text-ctp-red' :
                            'bg-yellow-100 text-yellow-700 dark:bg-ctp-surface0 dark:text-ctp-yellow'
                          }`}>{pkg.status}</span>
                          <span className="text-gray-600 dark:text-ctp-overlay0 font-mono truncate">{pkg.name}</span>
                          <span className="text-gray-400 dark:text-ctp-overlay0 ml-auto">{pkg.tests.length} tests · {durationStr(pkg.duration)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {entry.git_info && (
                <div className="card">
                  <div className="px-5 py-3 border-b border-gray-100 dark:border-ctp-surface0">
                    <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">Git</p>
                  </div>
                  <div className="px-5 py-4 grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-gray-400 dark:text-ctp-overlay0">Branch</p>
                      <p className="font-mono text-gray-700 dark:text-ctp-subtext0">{entry.git_info.branch}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-ctp-overlay0">Commit</p>
                      <p className="font-mono text-gray-700 dark:text-ctp-subtext0">{entry.git_info.commit.slice(0, 7)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-ctp-overlay0">Author Count</p>
                      <p className="text-gray-700 dark:text-ctp-subtext0">{entry.git_info.author_count}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-ctp-overlay0">Last Commit</p>
                      <p className="text-gray-700 dark:text-ctp-subtext0">{new Date(entry.git_info.commit_time).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
