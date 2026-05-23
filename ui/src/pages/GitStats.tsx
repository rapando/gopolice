import { useState } from 'react'
import { GitInfo } from '../api/client'

interface Props {
  gitInfo: GitInfo | null
}

function verifiedBadge(v: string) {
  switch (v) {
    case 'G':
      return <span className="text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded dark:text-ctp-green dark:bg-ctp-surface0">Verified</span>
    case 'B':
      return <span className="text-xs font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded dark:text-ctp-red dark:bg-ctp-surface0">Bad</span>
    case 'U':
      return <span className="text-xs font-medium text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded dark:text-ctp-yellow dark:bg-ctp-surface0">Unknown</span>
    default:
      return <span className="text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded dark:text-ctp-overlay0 dark:bg-ctp-surface0">Not signed</span>
  }
}

export default function GitStats({ gitInfo }: Props) {
  const [showAuthors, setShowAuthors] = useState(false)
  const [expandedCommits, setExpandedCommits] = useState<Set<number>>(new Set())

  if (!gitInfo) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Git</h2>
        <div className="card p-8 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0">No git info available.</p>
        </div>
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
    <div className="max-w-4xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Git</h2>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="card px-5 py-4">
          <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Branch</p>
          <p className="text-base font-semibold font-mono">{gitInfo.branch}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Commit</p>
          <p className="text-base font-semibold font-mono text-xs">{gitInfo.commit.slice(0, 7)}</p>
        </div>
        <button
          onClick={() => setShowAuthors(!showAuthors)}
          className="card px-5 py-4 text-left cursor-pointer hover:shadow-md transition-shadow"
        >
          <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Authors</p>
          <p className="text-base font-semibold">
            {gitInfo.author_count}
            <span className="ml-1 text-xs font-normal text-gray-400 dark:text-ctp-overlay0">{showAuthors ? '▲' : '▼'}</span>
          </p>
        </button>
      </div>

      {showAuthors && gitInfo.authors && gitInfo.authors.length > 0 && (
        <div className="card mb-5">
          <div className="divide-y divide-gray-100 dark:divide-ctp-surface0">
            {gitInfo.authors.map((a, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-ctp-text">{a.name}</p>
                  <p className="text-xs text-gray-400 dark:text-ctp-overlay0 font-mono">{a.email}</p>
                </div>
                <span className="text-xs font-medium text-gray-500 dark:text-ctp-overlay0 bg-gray-100 dark:bg-ctp-surface0 px-2 py-0.5 rounded">
                  {a.count} commit{a.count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {gitInfo.commits && gitInfo.commits.length > 0 && (
        <div className="card">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-ctp-surface0">
            <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium">Last {gitInfo.commits.length} Commits</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-ctp-surface0">
            {gitInfo.commits.map((c, i) => (
              <div key={i}>
                <button
                  onClick={() => toggleCommit(i)}
                  className="w-full px-5 py-3 flex items-center gap-4 text-left cursor-pointer hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors"
                >
                  <span className="text-xs text-gray-400 dark:text-ctp-overlay0 font-mono shrink-0 w-[22ch]">
                    {new Date(c.date).toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-800 dark:text-ctp-text font-medium truncate flex-1">
                    {c.message}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-ctp-overlay0 font-mono truncate max-w-[20ch] shrink-0">
                    {c.author}
                  </span>
                  {verifiedBadge(c.verified)}
                  <svg
                    className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${expandedCommits.has(i) ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedCommits.has(i) && (
                  <div className="px-5 py-3 bg-gray-50 dark:bg-ctp-surface0 border-t border-gray-100 dark:border-ctp-surface1">
                    <div className="text-xs text-gray-500 dark:text-ctp-overlay0 space-y-1 font-mono">
                      <p><span className="text-gray-400 dark:text-ctp-overlay1">Hash:</span> {c.hash}</p>
                      <p><span className="text-gray-400 dark:text-ctp-overlay1">Author:</span> {c.author} &lt;{c.email}&gt;</p>
                      <p><span className="text-gray-400 dark:text-ctp-overlay1">Date:</span> {new Date(c.date).toLocaleString()}</p>
                      <p><span className="text-gray-400 dark:text-ctp-overlay1">Message:</span> {c.message}</p>
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
