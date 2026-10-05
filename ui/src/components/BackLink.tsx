import { ArrowLeft } from 'lucide-react'

export default function BackLink({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-4">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  )
}
