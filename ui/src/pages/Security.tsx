import { Issue } from '../api/client'
import { severityIcon, severityTextClass } from '../lib/severity'
import EmptyState from '../components/EmptyState'

interface Props {
  issues: Issue[]
  onSelectIssue?: (id: string) => void
  onScan?: () => void
  scanning?: boolean
}

export default function Security({ issues, onSelectIssue, onScan, scanning }: Props) {
  const securityIssues = issues.filter((i) => i.category === 'security')

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">
        Security <span className="font-normal text-gray-400 dark:text-ctp-subtext1">({securityIssues.length})</span>
      </h2>

      {securityIssues.length === 0 ? (
        <EmptyState message="No security issues found." onScan={onScan} scanning={scanning} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:bg-ctp-mantle">
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Severity</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Scanner</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Rule</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Description</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">File</th>
                <th className="text-right px-5 py-2.5 font-medium text-gray-500 dark:text-ctp-subtext0 text-xs uppercase tracking-wide">Line</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {securityIssues.map((issue) => (
                <tr key={issue.id} onClick={() => onSelectIssue?.(issue.id)} className="hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors cursor-pointer">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-base ${severityTextClass(issue.severity)}`}>{severityIcon(issue.severity)}</span>
                      <span className="text-xs font-medium capitalize">{issue.severity}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-ctp-subtext0 font-mono text-xs">{issue.scanner}</td>
                  <td className="px-5 py-3 font-mono text-xs text-orange-600 dark:text-ctp-peach">{issue.rule}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-ctp-subtext0">{issue.message}</td>
                  <td className="px-5 py-3 font-mono text-xs text-blue-600 dark:text-ctp-blue">{issue.file}</td>
                  <td className="px-5 py-3 text-gray-400 dark:text-ctp-subtext1 font-mono text-xs text-right">{issue.line > 0 ? issue.line : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
