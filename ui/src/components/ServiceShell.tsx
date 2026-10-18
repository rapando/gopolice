import { ReactNode } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { routeToHash, type Page } from '../lib/router'
import ThemeToggle from './ThemeToggle'

interface Props {
  page: Page
  username?: string
  onLogout: () => void
  children: ReactNode
}

const LINKS: { page: Page; label: string }[] = [
  { page: 'projects', label: 'Repositories' },
  { page: 'account', label: 'Account' },
]

/** Page chrome for the screens that live outside any one repository. */
export default function ServiceShell({ page, username, onLogout, children }: Props) {
  return (
    <div className="flex flex-col h-screen bg-canvas text-fg">
      <header className="h-14 shrink-0 bg-surface border-b border-line flex items-center gap-6 px-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-accent" aria-hidden="true" />
          <span className="font-mono font-semibold text-[15px] tracking-tight">gopolice</span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-1">
          {LINKS.map((l) => (
            <a
              key={l.page}
              href={routeToHash({ page: l.page })}
              aria-current={l.page === page ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                l.page === page ? 'bg-accent-soft text-accent font-medium' : 'text-fg-muted hover:bg-subtle hover:text-fg'
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex-1" />
        {username && <span className="text-sm text-fg-muted">{username}</span>}
        <ThemeToggle />
        <button onClick={onLogout} className="btn-ghost">
          <LogOut className="w-4 h-4" aria-hidden="true" />
          Sign out
        </button>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
