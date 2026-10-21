import { CircleCheck, CircleX, PackageX, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react'
import { Issue, type ToolStatus } from '../api/client'
import IssueTable from '../components/IssueTable'
import CopyButton from '../components/CopyButton'
import { securitySummary } from '../lib/security'

interface Props {
  issues: Issue[]
  tools?: ToolStatus[] | null
  onSelectIssue: (id: string) => void
  onScan?: () => void
  scanning?: boolean
}

const TOOL_DESC: Record<string, string> = {
  gosec: 'static analysis of your code for insecure patterns',
  govulncheck: 'known vulnerabilities in the modules you depend on',
}

export default function Security({ issues, tools, onSelectIssue }: Props) {
  const summary = securitySummary({ issues, tools })
  const securityIssues = issues.filter((i) => i.category === 'security')

  const headline = {
    clear: { Icon: ShieldCheck, cls: 'text-success', text: 'All clear', sub: 'Every security tool ran and found nothing.' },
    partial: { Icon: ShieldQuestion, cls: 'text-warning', text: 'Partially checked', sub: 'No findings from the tools that ran, but not every tool ran. Install the missing ones for full coverage.' },
    findings: { Icon: ShieldAlert, cls: 'text-danger', text: `${summary.findings} finding${summary.findings === 1 ? '' : 's'}`, sub: 'Listed below, most severe first.' },
    unknown: { Icon: ShieldQuestion, cls: 'text-fg-muted', text: 'Not recorded', sub: 'This result predates per-tool status. Run a scan to see which tools ran.' },
  }[summary.state]

  return (
    <div className="page space-y-5">
      <div className="flex items-start gap-3">
        <headline.Icon className={`w-7 h-7 shrink-0 ${headline.cls}`} aria-hidden="true" />
        <div>
          <h2 className={`text-xl font-semibold ${headline.cls}`}>{headline.text}</h2>
          <p className="text-sm text-fg-muted">{headline.sub}</p>
        </div>
      </div>

      {summary.tools.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Security tools">
          {summary.tools.map((t) => <ToolCard key={t.tool} tool={t} />)}
        </ul>
      )}

      {securityIssues.length > 0 && (
        <IssueTable issues={securityIssues} onSelectIssue={onSelectIssue} />
      )}
    </div>
  )
}

function ToolCard({ tool: t }: { tool: ToolStatus }) {
  const status = t.status === 'ran'
    ? t.findings === 0
      ? { Icon: CircleCheck, cls: 'text-success', label: 'Ran · no findings' }
      : { Icon: TriangleAlert, cls: 'text-danger', label: `Ran · ${t.findings} finding${t.findings === 1 ? '' : 's'}` }
    : t.status === 'missing'
      ? { Icon: PackageX, cls: 'text-warning', label: 'Not installed' }
      : { Icon: CircleX, cls: 'text-danger', label: 'Failed' }
  return (
    <li className="card p-4 min-w-0">
      <div className="flex items-center gap-2">
        <status.Icon className={`w-4 h-4 shrink-0 ${status.cls}`} aria-hidden="true" />
        <span className="font-mono font-medium">{t.tool}</span>
        <span className={`text-sm ${status.cls}`}>{status.label}</span>
      </div>
      <p className="mt-1 text-sm text-fg-muted">{TOOL_DESC[t.tool] ?? ''}</p>
      {t.status === 'missing' && t.install && (
        <div className="mt-3 flex items-center gap-2 min-w-0">
          <code className="flex-1 min-w-0 truncate text-xs font-mono bg-subtle rounded px-2 py-1.5" title={t.install}>{t.install}</code>
          <CopyButton text={t.install} label="Copy" />
        </div>
      )}
      {t.status === 'failed' && t.error && (
        <p className="mt-2 text-xs font-mono text-danger break-words">{t.error}</p>
      )}
    </li>
  )
}
