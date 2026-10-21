import type { ScanResult, ToolStatus } from '../api/client'

export type SecurityState = 'clear' | 'partial' | 'findings' | 'unknown'

export interface SecuritySummary {
  state: SecurityState
  findings: number
  tools: ToolStatus[]
  /** Short per-tool phrases, e.g. "gosec not installed", "govulncheck clean". */
  notes: string[]
}

export const SECURITY_TOOLS = ['gosec', 'govulncheck']

/** What the security scan actually established, not just how many issues it listed. */
export function securitySummary(result: Pick<ScanResult, 'issues' | 'tools'>): SecuritySummary {
  const findings = result.issues.filter((i) => i.category === 'security').length
  const tools = (result.tools ?? []).filter((t) => t.scanner === 'security')
  const notes = tools.map((t) =>
    t.status === 'ran' ? `${t.tool} ${t.findings === 0 ? 'clean' : `${t.findings} finding${t.findings === 1 ? '' : 's'}`}`
      : t.status === 'missing' ? `${t.tool} not installed`
        : `${t.tool} failed`)
  if (findings > 0) return { state: 'findings', findings, tools, notes }
  if (tools.length === 0) return { state: 'unknown', findings, tools, notes }
  const allRan = tools.every((t) => t.status === 'ran')
  return { state: allRan ? 'clear' : 'partial', findings, tools, notes }
}
