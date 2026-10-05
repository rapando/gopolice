import type { Snippet } from '../api/client'

/** Source excerpt with line numbers; the issue line is highlighted. */
export default function CodeSnippet({ snippet, className = '' }: { snippet: Snippet; className?: string }) {
  return (
    <pre className={`text-[13px] leading-6 font-mono overflow-x-auto bg-canvas ${className}`}>
      <code className="block min-w-max py-2">
        {(snippet.lines || []).map((l) => (
          <div
            key={l.number}
            className={`flex border-l-2 ${l.is_issue ? 'bg-danger-soft border-danger' : 'border-transparent'}`}
          >
            <span className={`w-14 shrink-0 pr-4 text-right select-none ${l.is_issue ? 'text-danger font-semibold' : 'text-fg-subtle'}`}>
              {l.number}
            </span>
            <span className="pr-6 whitespace-pre text-fg">{l.content || ' '}</span>
          </div>
        ))}
      </code>
    </pre>
  )
}
