import { useEffect, useState } from 'react'
import { HistoryEntry, DiffResult, ScanResult, getHistoryList, getHistoryEntry, getHistoryDiff, deleteHistoryEntry, durationStr } from '../api/client'
import { severityBadgeClass, categoryTextClass } from '../lib/severity'
import Spinner from '../components/Spinner'

interface Props {
  onLoadResult?: (result: ScanResult, label: string) => void
}

const PAGE_SIZE = 15

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
  const [page, setPage] = useState(1)

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const paginatedEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const loadList = () => {
    setLoading(true)
    getHistoryList().then((list) => {
      setEntries(list)
      setPage(1)
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
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      {entries.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-fg-muted">No scan history yet. Run <code className="text-xs bg-subtle px-1 rounded">gopolice scan</code> to create one.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-5">
            <div className="card px-5 py-4">
              <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Total Scans</p>
              <p className="text-base font-semibold">{entries.length}</p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Latest Issues</p>
              <p className="text-base font-semibold">{entries[0]?.total_issues ?? 0}</p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Latest Tests</p>
              <p className="text-base font-semibold">{entries[0]?.total_tests ?? 0}</p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Project</p>
              <p className="text-base font-semibold truncate">{entries[0]?.project_name ?? '-'}</p>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
          <div className="flex items-center justify-between mb-3 text-xs text-fg-muted">
            <span>{entries.length} scan{entries.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                title="First page"
              >&#171;</button>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
              >&#8249;</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center">
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-line-strong">&hellip;</span>}
                    <button
                      onClick={() => setPage(p)}
                      className={`px-2 py-1 rounded transition-colors ${
                        p === page
                          ? 'bg-accent-soft text-accent font-semibold'
                          : 'hover:bg-subtle'
                      }`}
                    >{p}</button>
                  </span>
                ))}
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
                className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
              >&#8250;</button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                title="Last page"
              >&#187;</button>
            </div>
          </div>
          )}

          <div className="card mb-5 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-2.5 bg-subtle border-b border-line text-xs text-fg-muted uppercase tracking-wide font-medium">
              <span className="w-4 shrink-0" />
              <span className="w-9 shrink-0" />
              <span className="w-36 shrink-0">Date</span>
              <span className="w-16 shrink-0">Issues</span>
              <span className="w-16 shrink-0">Tests</span>
              <span className="flex-1" />
              <span className="w-16 shrink-0 text-center">Duration</span>
              <span className="w-6 shrink-0" />
            </div>
            <div className="divide-y divide-line">
              {paginatedEntries.map((e) => {
                const isSelected = selected === e.id
                const isDiffFrom = diffFrom === e.id
                const isDiffTo = diffTo === e.id
                const inDiff = isDiffFrom || isDiffTo
                return (
                  <div key={e.id}>
                    <div
                      className={`flex items-center gap-3 px-5 py-2.5 cursor-pointer hover:bg-subtle  transition-colors ${
                        isSelected ? 'bg-accent-soft' : ''
                      } ${inDiff ? 'bg-warning-soft' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={inDiff}
                        onChange={() => toggleDiff(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="shrink-0"
                      />
                      <span className={`w-9 shrink-0 text-center text-xs font-bold rounded ${
                        e.grade === 'A' ? 'text-success' :
                        e.grade === 'B' ? 'text-success' :
                        e.grade === 'C' ? 'text-warning' :
                        e.grade === 'D' ? 'text-orange' :
                        e.grade === 'F' ? 'text-danger' : ''
                      }`}>{e.grade || '-'}</span>
                      <button className="flex-1 flex items-center gap-3 text-left" onClick={() => viewEntry(e.id)}>
                        <span className="text-xs text-fg-subtle font-mono w-36 shrink-0">
                          {new Date(e.timestamp).toLocaleString()}
                        </span>
                        <span className="text-sm text-fg font-medium w-16 shrink-0">{e.total_issues}</span>
                        <span className="text-xs text-fg-muted w-16 shrink-0">{e.total_tests}</span>
                        <span className="flex-1" />
                        <span className="text-xs text-fg-subtle font-mono w-16 shrink-0 text-right">
                          {durationStr(e.duration)}
                        </span>
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); deleteEntry(e.id) }}
                        className="text-xs text-fg-subtle hover:text-danger shrink-0 w-6 text-right"
                        title="Delete"
                        aria-label="Delete scan history entry"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bottom pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mb-5 text-xs text-fg-muted">
              <span>{entries.length} scan{entries.length !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                >&#171;</button>
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                >&#8249;</button>
                <span className="px-2">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                >&#8250;</button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded hover:bg-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                >&#187;</button>
              </div>
            </div>
          )}

          {diffFrom && diffTo && !diff && (
            <div className="mb-5">
              <button onClick={runDiff} className="btn-primary">
                Compare selected scans
              </button>
              <span className="ml-2 text-xs text-fg-subtle">
                {tsDisplay(diffFrom)} vs {tsDisplay(diffTo)}
              </span>
            </div>
          )}

          {diff && (
            <div className="card mb-5">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between">
                <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">
                  Diff: {tsDisplay(diff.from)} → {tsDisplay(diff.to)}
                </p>
                <button onClick={() => { setDiff(null); setDiffFrom(null); setDiffTo(null) }} className="text-xs text-fg-subtle hover:text-fg-muted">
                  Clear
                </button>
              </div>
              <div className="divide-y divide-line">
                {diff.new.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-xs font-medium text-danger mb-2">New Issues ({diff.new.length})</p>
                    {diff.new.map((issue) => (
                      <p key={issue.id} className="text-xs text-fg font-mono mb-1">
                        <span className={`inline-block w-14 text-center rounded text-xs font-medium ${severityBadgeClass(issue.severity)}`}>{issue.severity}</span>
                        {' '}{issue.file}:{issue.line} — {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                {diff.resolved.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-xs font-medium text-success mb-2">Resolved Issues ({diff.resolved.length})</p>
                    {diff.resolved.map((issue) => (
                      <p key={issue.id} className="text-xs text-fg-muted font-mono line-through mb-1">
                        <span className={`inline-block w-14 text-center rounded text-xs font-medium ${severityBadgeClass(issue.severity)}`}>{issue.severity}</span>
                        {' '}{issue.file}:{issue.line} — {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                {diff.unchanged.length > 0 && (
                  <div className="px-5 py-3">
                    <p className="text-xs font-medium text-fg-muted mb-2">Unchanged ({diff.unchanged.length})</p>
                  </div>
                )}
                {diff.new.length === 0 && diff.resolved.length === 0 && (
                  <div className="px-5 py-4 text-center text-xs text-fg-subtle">No changes — same issues in both scans.</div>
                )}
              </div>
            </div>
          )}

          {selected && entry && !diff && (
            <div className="space-y-5">
              <div className="card">
                <div className="px-5 py-3 border-b border-line flex items-center justify-between">
                  <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">
                    Scan Results — {tsDisplay(selected)}
                  </p>
                  {onLoadResult && (
                    <button
                      onClick={() => onLoadResult(entry, tsDisplay(selected))}
                      className="btn-primary"
                    >
                      Browse full results
                    </button>
                  )}
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-fg-subtle">Issues</p>
                      <p className="text-base font-semibold text-fg">{entry.issues.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-fg-subtle">Files</p>
                      <p className="text-base font-semibold text-fg">{entry.total_files}</p>
                    </div>
                    <div>
                      <p className="text-xs text-fg-subtle">Duration</p>
                      <p className="text-base font-semibold text-fg">{durationStr(entry.duration)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-fg-subtle">Git</p>
                      <p className="text-base font-semibold text-fg truncate font-mono text-sm">
                        {entry.git_info ? `${entry.git_info.branch} @ ${entry.git_info.commit.slice(0, 7)}` : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <button
                  onClick={() => setShowIssues(!showIssues)}
                  aria-expanded={showIssues}
                  className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-subtle transition-colors"
                >
                  <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">
                    Issues ({entry.issues.length})
                  </p>
                  <svg className={`w-3 h-3 text-fg-subtle transition-transform ${showIssues ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showIssues && (
                  <div className="divide-y divide-line max-h-80 overflow-y-auto">
                    {entry.issues.length === 0 ? (
                      <div className="px-5 py-4 text-center text-xs text-fg-subtle">No issues.</div>
                    ) : (
                      entry.issues.map((issue) => (
                        <div key={issue.id} className="px-5 py-2.5 text-xs">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`inline-block w-14 text-center rounded text-xs font-medium ${severityBadgeClass(issue.severity)}`}>{issue.severity}</span>
                            <span className={"font-medium " + categoryTextClass(issue.category)}>{issue.category}</span>
                            <span className="text-fg-subtle font-mono">{issue.scanner}</span>
                          </div>
                          <p className="text-fg">{issue.message}</p>
                          <p className="text-fg-subtle font-mono">{issue.file}:{issue.line}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="card">
                <button
                  onClick={() => setShowSecurity(!showSecurity)}
                  className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-subtle transition-colors"
                >
                  <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">
                    Security Issues ({entry.issues.filter(i => i.category === 'security').length})
                  </p>
                  <svg className={`w-3 h-3 text-fg-subtle transition-transform ${showSecurity ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSecurity && (
                  <div className="divide-y divide-line max-h-80 overflow-y-auto">
                    {(() => {
                      const sec = entry.issues.filter(i => i.category === 'security')
                      return sec.length === 0 ? (
                        <div className="px-5 py-4 text-center text-xs text-fg-subtle">No security issues.</div>
                      ) : (
                        sec.map((issue) => (
                          <div key={issue.id} className="px-5 py-2.5 text-xs">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`inline-block w-14 text-center rounded text-xs font-medium ${severityBadgeClass(issue.severity)}`}>{issue.severity}</span>
                              <span className="text-fg-subtle font-mono">{issue.scanner}/{issue.rule}</span>
                            </div>
                            <p className="text-fg">{issue.message}</p>
                            <p className="text-fg-subtle font-mono">{issue.file}:{issue.line}</p>
                          </div>
                        ))
                      )
                    })()}
                  </div>
                )}
              </div>

              {entry.test_results && (
                <div className="card">
                  <div className="px-5 py-3 border-b border-line">
                    <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">Test Results</p>
                  </div>
                  <div className="px-5 py-4">
                    <div className="flex gap-4 text-sm mb-3">
                      <span className="font-medium text-fg">{entry.test_results.total.total} total</span>
                      <span className="text-success">{entry.test_results.total.passed} passed</span>
                      {entry.test_results.total.failed > 0 && <span className="text-danger">{entry.test_results.total.failed} failed</span>}
                      {entry.test_results.total.skipped > 0 && <span className="text-warning">{entry.test_results.total.skipped} skipped</span>}
                    </div>
                    <div className="space-y-1">
                      {entry.test_results.packages.map((pkg, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className={`w-14 text-center rounded text-xs font-medium ${
                            pkg.status === 'pass' ? 'bg-success-soft text-success' :
                            pkg.status === 'fail' ? 'bg-danger-soft text-danger' :
                            'bg-warning-soft text-warning'
                          }`}>{pkg.status}</span>
                          <span className="text-fg-muted font-mono truncate">{pkg.name}</span>
                          <span className="text-fg-subtle ml-auto">{pkg.tests.length} tests · {durationStr(pkg.duration)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {entry.git_info && (
                <div className="card">
                  <div className="px-5 py-3 border-b border-line">
                    <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">Git</p>
                  </div>
                  <div className="px-5 py-4 grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-fg-subtle">Branch</p>
                      <p className="font-mono text-fg">{entry.git_info.branch}</p>
                    </div>
                    <div>
                      <p className="text-fg-subtle">Commit</p>
                      <p className="font-mono text-fg">{entry.git_info.commit.slice(0, 7)}</p>
                    </div>
                    <div>
                      <p className="text-fg-subtle">Author Count</p>
                      <p className="text-fg">{entry.git_info.author_count}</p>
                    </div>
                    <div>
                      <p className="text-fg-subtle">Last Commit</p>
                      <p className="text-fg">{new Date(entry.git_info.commit_time).toLocaleString()}</p>
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
