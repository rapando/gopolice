import { useState } from 'react'
import { GitInfo } from '../api/client'
import EmptyState from '../components/EmptyState'

interface Props {
  gitInfo: GitInfo | null
  onScan?: () => void
  scanning?: boolean
}

function verifiedBadge(v: string) {
  switch (v) {
    case 'G':
      return <span className="text-xs font-medium text-success bg-success-soft px-1.5 py-0.5 rounded">Verified</span>
    case 'B':
      return <span className="text-xs font-medium text-danger bg-danger-soft px-1.5 py-0.5 rounded">Bad</span>
    case 'U':
      return <span className="text-xs font-medium text-warning bg-warning-soft px-1.5 py-0.5 rounded">Unknown</span>
    default:
      return <span className="text-xs font-medium text-fg-subtle bg-subtle px-1.5 py-0.5 rounded">Not signed</span>
  }
}

export default function GitStats({ gitInfo, onScan, scanning }: Props) {
  const [showAuthors, setShowAuthors] = useState(false)
  const [expandedCommits, setExpandedCommits] = useState<Set<number>>(new Set())

  if (!gitInfo) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <EmptyState message="No git info available." onScan={onScan} scanning={scanning} />
      </div>
    )
  }

  const toggleCommit = (i: number) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="card px-5 py-4">
          <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Branch</p>
          <p className="text-base font-semibold font-mono">{gitInfo.branch}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Commit</p>
          <p className="text-base font-semibold font-mono text-xs">{gitInfo.commit.slice(0, 7)}</p>
        </div>
        <button
          onClick={() => setShowAuthors(!showAuthors)}
          aria-expanded={showAuthors}
          aria-label="Toggle authors list"
          className="card px-5 py-4 text-left cursor-pointer hover:shadow-md transition-shadow"
        >
          <p className="text-xs text-fg-muted uppercase tracking-wide font-medium mb-0.5">Authors</p>
          <p className="text-base font-semibold">
            {gitInfo.author_count}
            <span className="ml-1 text-xs font-normal text-fg-subtle">{showAuthors ? '▲' : '▼'}</span>
          </p>
        </button>
      </div>

      {showAuthors && gitInfo.authors && gitInfo.authors.length > 0 && (
        <div className="card mb-5">
          <div className="divide-y divide-line">
            {gitInfo.authors.map((a, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg">{a.name}</p>
                  <p className="text-xs text-fg-subtle font-mono">{a.email}</p>
                </div>
                <span className="text-xs font-medium text-fg-muted bg-subtle px-2 py-0.5 rounded">
                  {a.count} commit{a.count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {gitInfo.commits && gitInfo.commits.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-line">
            <p className="text-xs text-fg-muted uppercase tracking-wide font-medium">Last {gitInfo.commits.length} Commits</p>
          </div>
          <div className="divide-y divide-line">
            {gitInfo.commits.map((c, i) => (
              <div key={i}>
                <button
                  onClick={() => toggleCommit(i)}
                  aria-expanded={expandedCommits.has(i)}
                  aria-label={`${expandedCommits.has(i) ? 'Collapse' : 'Expand'} commit ${c.message}`}
                  className="w-full px-5 py-3 flex items-center gap-4 text-left cursor-pointer hover:bg-subtle transition-colors"
                >
                  <span className="text-xs text-fg-subtle font-mono shrink-0 w-[22ch]">
                    {new Date(c.date).toLocaleString()}
                  </span>
                  <span className="text-sm text-fg font-medium truncate flex-1">
                    {c.message}
                  </span>
                  <span className="text-xs text-fg-muted font-mono truncate max-w-[20ch] shrink-0">
                    {c.author}
                  </span>
                  {verifiedBadge(c.verified)}
                  <svg
                    className={`w-3 h-3 text-fg-subtle shrink-0 transition-transform ${expandedCommits.has(i) ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedCommits.has(i) && (
                  <div className="px-5 py-3 bg-subtle border-t border-line">
                    <div className="text-xs text-fg-muted space-y-1 font-mono">
                      <p><span className="text-fg-subtle">Hash:</span> {c.hash}</p>
                      <p><span className="text-fg-subtle">Author:</span> {c.author} &lt;{c.email}&gt;</p>
                      <p><span className="text-fg-subtle">Date:</span> {new Date(c.date).toLocaleString()}</p>
                      <p><span className="text-fg-subtle">Message:</span> {c.message}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
