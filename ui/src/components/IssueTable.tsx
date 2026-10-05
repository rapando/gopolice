import { Issue } from '../api/client'
import { SeverityBadge } from './Severity'
import FileLink from './FileLink'

interface Props {
  issues: Issue[]
  onSelectIssue: (id: string) => void
  onSelectFile?: (file: string) => void
  /** Show the scanner/rule column. */
  showRule?: boolean
}

/** Read-only issue list used by focused views (Security, Dead code). */
export default function IssueTable({ issues, onSelectIssue, onSelectFile, showRule = true }: Props) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-subtle">
            <th className="th w-28">Severity</th>
            <th className="th">Message</th>
            {showRule && <th className="th w-48">Rule</th>}
            <th className="th w-[28%]">Location</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {issues.map((issue) => (
            <tr key={issue.id} className="hover:bg-subtle/60">
              <td className="td"><SeverityBadge severity={issue.severity} /></td>
              <td className="td">
                <button onClick={() => onSelectIssue(issue.id)} className="text-left text-fg hover:text-accent hover:underline">
                  {issue.message}
                </button>
              </td>
              {showRule && (
                <td className="td">
                  <span className="font-mono text-xs text-fg">{issue.rule || '—'}</span>
                  <span className="block text-xs text-fg-muted">{issue.scanner}</span>
                </td>
              )}
              <td className="td max-w-0">
                <FileLink file={issue.file} line={issue.line} onClick={onSelectFile ? () => onSelectFile(issue.file) : undefined} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
