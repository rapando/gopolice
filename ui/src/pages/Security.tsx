import { Issue } from '../api/client'
import EmptyState from '../components/EmptyState'
import IssueTable from '../components/IssueTable'

interface Props {
  issues: Issue[]
  onSelectIssue: (id: string) => void
  onScan?: () => void
  scanning?: boolean
}

export default function Security({ issues, onSelectIssue }: Props) {
  const securityIssues = issues.filter((i) => i.category === 'security')

  return (
    <div className="max-w-6xl mx-auto p-8">
      <p className="text-sm text-fg-muted mb-4">
        Findings from <code className="font-mono">gosec</code> and <code className="font-mono">govulncheck</code>, when installed.
      </p>
      {securityIssues.length === 0 ? (
        <EmptyState tone="clean" message="No security issues found" hint="Install gosec and govulncheck for full coverage; missing tools are skipped." />
      ) : (
        <IssueTable issues={securityIssues} onSelectIssue={onSelectIssue} />
      )}
    </div>
  )
}
