import { Issue } from '../api/client'

interface Props {
  issues: Issue[]
  onSelectIssue?: (id: string) => void
  onSelectFile?: (file: string) => void
}

const sevIcon: Record<string, string> = { error: '●', warning: '◆', info: '○' }
const sevColor: Record<string, string> = { error: 'text-red-500', warning: 'text-yellow-500', info: 'text-blue-500' }

export default function DeadCode({ issues, onSelectIssue, onSelectFile }: Props) {
  const deadIssues = issues.filter((i) => i.category === 'deadcode')

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">
        Dead Code <span className="font-normal text-gray-400 dark:text-ctp-subtext1">({deadIssues.length})</span>
      </h2>

      {deadIssues.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500 dark:text-ctp-subtext0">No dead code issues found.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:bg-ctp-mantle">
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Severity</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Rule</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Description</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">File</th>
                <th className="text-right px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Line</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {deadIssues.map((issue) => (
                <tr key={issue.id} className="hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors group">
                  <td className="px-5 py-3">
                    <span className={`${sevColor[issue.severity] || 'text-gray-400'}`}>{sevIcon[issue.severity] || '○'}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500 dark:text-ctp-subtext1">{issue.rule}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-ctp-subtext1">
                    <button
                      onClick={() => onSelectIssue?.(issue.id)}
                      className="hover:text-blue-600 dark:hover:text-ctp-blue text-left"
                    >
                      {issue.message}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => onSelectFile?.(issue.file)}
                      className="text-xs font-mono text-gray-500 hover:text-blue-600 dark:text-ctp-subtext1 dark:hover:text-ctp-blue"
                    >
                      {issue.file}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400 dark:text-ctp-overlay2">{issue.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
