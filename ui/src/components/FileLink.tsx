import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { editorURL, fileLocation } from '../lib/editor'

interface Props {
  file: string
  line?: number
  /** Called when the path itself is clicked (e.g. to preview the snippet). */
  onClick?: (e: React.MouseEvent) => void
  className?: string
}

/**
 * A file:line reference with copy and open-in-editor actions, the two things
 * developers do with a location.
 */
export default function FileLink({ file, line, onClick, className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const loc = fileLocation(file, line)
  const href = editorURL(file, line)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(loc)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard blocked; nothing useful to do
    }
  }

  return (
    <span className={`group/file inline-flex items-center gap-1 min-w-0 font-mono text-xs ${className}`}>
      {onClick ? (
        <button onClick={onClick} className="text-accent hover:underline truncate text-left" title={loc}>
          {loc}
        </button>
      ) : (
        <span className="text-fg-muted truncate" title={loc}>{loc}</span>
      )}
      <button
        onClick={copy}
        title={copied ? 'Copied' : `Copy ${loc}`}
        aria-label={`Copy ${loc}`}
        className="shrink-0 p-0.5 rounded text-fg-subtle opacity-0 group-hover/file:opacity-100 focus:opacity-100 hover:text-fg hover:bg-subtle transition-opacity"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {href && (
        <a
          href={href}
          onClick={(e) => e.stopPropagation()}
          title="Open in editor"
          aria-label={`Open ${loc} in editor`}
          className="shrink-0 p-0.5 rounded text-fg-subtle opacity-0 group-hover/file:opacity-100 focus:opacity-100 hover:text-fg hover:bg-subtle transition-opacity"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </span>
  )
}
