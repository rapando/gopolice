import { CircleCheck, CircleMinus, CircleX } from 'lucide-react'

const STYLE: Record<string, { Icon: typeof CircleCheck; cls: string; label: string }> = {
  PASS: { Icon: CircleCheck, cls: 'text-success', label: 'Pass' },
  FAIL: { Icon: CircleX, cls: 'text-danger', label: 'Fail' },
  SKIP: { Icon: CircleMinus, cls: 'text-warning', label: 'Skip' },
}

export default function TestStatus({ status, withLabel = true }: { status: string; withLabel?: boolean }) {
  const s = STYLE[status] ?? { Icon: CircleMinus, cls: 'text-fg-muted', label: status }
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${s.cls}`}>
      <s.Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      {withLabel ? s.label : <span className="sr-only">{s.label}</span>}
    </span>
  )
}
