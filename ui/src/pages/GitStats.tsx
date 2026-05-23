import { GitInfo } from '../api/client'

interface Props {
  gitInfo: GitInfo | null
}

export default function GitStats({ gitInfo }: Props) {
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
          <p className="text-base font-semibold font-mono">{gitInfo.commit.slice(0, 7)}</p>
        </div>
        <div className="card px-5 py-4">
          <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Authors</p>
          <p className="text-base font-semibold">{gitInfo.author_count}</p>
        </div>
      </div>

      {gitInfo.commit_time && (
        <div className="card px-5 py-4">
          <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">Last Commit</p>
          <p className="text-sm text-gray-700 dark:text-ctp-subtext0">{new Date(gitInfo.commit_time).toLocaleString()}</p>
        </div>
      )}
    </div>
  )
}
