import { Issue } from '../api/client'

interface Props {
  issues: Issue[]
  onSelectIssue?: (id: string) => void
}

const sevIcon: Record<string, string> = { error: '●', warning: '◆', info: '○' }
const sevColor: Record<string, string> = { error: 'text-red-500', warning: 'text-yellow-500', info: 'text-blue-500' }

export default function Security({ issues, onSelectIssue }: Props) {
  const securityIssues = issues.filter((i) => i.category === 'security')

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 mb-5">
        Security <span className="font-normal text-gray-400">({securityIssues.length})</span>
      </h2>

      {securityIssues.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-gray-500">No security issues found.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Severity</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Scanner</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Rule</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Description</th>
                <th className="text-left px-5 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">File</th>
                <th className="text-right px-5 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wide">Line</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {securityIssues.map((issue) => (
                <tr key={issue.id} onClick={() => onSelectIssue?.(issue.id)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-base ${sevColor[issue.severity]}`}>{sevIcon[issue.severity]}</span>
                      <span className="text-xs font-medium capitalize">{issue.severity}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{issue.scanner}</td>
                  <td className="px-5 py-3 font-mono text-xs text-orange-600">{issue.rule}</td>
                  <td className="px-5 py-3 text-gray-700">{issue.message}</td>
                  <td className="px-5 py-3 font-mono text-xs text-blue-600">{issue.file}</td>
                  <td className="px-5 py-3 text-gray-400 font-mono text-xs text-right">{issue.line > 0 ? issue.line : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
