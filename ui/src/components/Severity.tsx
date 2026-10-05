import { CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { severityBadgeClass, severityTextClass, type Severity } from '../lib/severity'

const ICONS: Record<Severity, LucideIcon> = { error: CircleX, warning: TriangleAlert, info: Info }

export function SeverityIcon({ severity, className = 'w-4 h-4' }: { severity: string; className?: string }) {
  const Icon = ICONS[severity as Severity] ?? Info
  return <Icon className={`shrink-0 ${severityTextClass(severity)} ${className}`} aria-hidden="true" />
}

/** Icon + label pill. */
export function SeverityBadge({ severity }: { severity: string }) {
  const Icon = ICONS[severity as Severity] ?? Info
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${severityBadgeClass(severity)}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {severity}
    </span>
  )
}
