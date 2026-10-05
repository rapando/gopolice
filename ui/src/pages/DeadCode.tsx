import { Issue } from '../api/client'
import EmptyState from '../components/EmptyState'
import IssueTable from '../components/IssueTable'

interface Props {
  issues: Issue[]
  onSelectIssue: (id: string) => void
  onSelectFile?: (file: string) => void
  onScan?: () => void
  scanning?: boolean
}

export default function DeadCode({ issues, onSelectIssue, onSelectFile }: Props) {
  const deadIssues = issues.filter((i) => i.category === 'deadcode')

  return (
    <div className="max-w-6xl mx-auto p-8">
      <p className="text-sm text-fg-muted mb-4">
        Unused functions, types, constants and variables reported by <code className="font-mono">staticcheck</code> (U1000).
      </p>
      {deadIssues.length === 0 ? (
        <EmptyState tone="clean" message="No dead code found" />
      ) : (
        <IssueTable issues={deadIssues} onSelectIssue={onSelectIssue} onSelectFile={onSelectFile} />
      )}
    </div>
  )
}
