import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copies `text` to the clipboard and briefly confirms. */
export default function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          // clipboard blocked
        }
      }}
      title={copied ? 'Copied' : label}
      aria-label={label}
      className={`btn-ghost px-2 py-1 ${className}`}
    >
      {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
      <span className="text-xs">{copied ? 'Copied' : label}</span>
    </button>
  )
}
