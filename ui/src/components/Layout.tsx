import { ReactNode, useEffect, useState } from 'react'
import {
  FlaskConical, Gauge, GitBranch, Ghost, History, LayoutDashboard, LoaderCircle, Network,
  Play, Settings, ShieldAlert, ShieldCheck, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import { getVersion } from '../api/client'
import { setProjectDir } from '../lib/editor'
import { routeToHash, type Page } from '../lib/router'
import ThemeToggle from './ThemeToggle'

export interface NavCounts {
  issues: number
  errors: number
  security: number
  deadcode: number
  failedTests: number
}

interface LayoutProps {
  page: Page
  counts: NavCounts | null
  scanning: boolean
  onScan: () => void
  children: ReactNode
  historicalLabel?: string | null
  onClearHistorical?: () => void
  projectName?: string
  scanTime?: string
  branch?: string
}

interface NavItem {
  page: Page
  label: string
  Icon: LucideIcon
  /** Pages that highlight this nav item (detail views). */
  also?: Page[]
  count?: (c: NavCounts) => { value: number; tone: 'danger' | 'neutral' } | null
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ page: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard }],
  },
  {
    label: 'Analysis',
    items: [
      { page: 'issues', label: 'Issues', Icon: TriangleAlert, also: ['issue', 'file'],
        count: (c) => c.issues ? { value: c.issues, tone: c.errors ? 'danger' : 'neutral' } : null },
      { page: 'security', label: 'Security', Icon: ShieldAlert,
        count: (c) => c.security ? { value: c.security, tone: 'danger' } : null },
      { page: 'deadcode', label: 'Dead code', Icon: Ghost,
        count: (c) => c.deadcode ? { value: c.deadcode, tone: 'neutral' } : null },
      { page: 'tests', label: 'Tests', Icon: FlaskConical, also: ['testdetail'],
        count: (c) => c.failedTests ? { value: c.failedTests, tone: 'danger' } : null },
      { page: 'performance', label: 'Performance', Icon: Gauge },
    ],
  },
  {
    label: 'Project',
    items: [
      { page: 'depgraph', label: 'Dependencies', Icon: Network },
      { page: 'git', label: 'Git', Icon: GitBranch },
      { page: 'history', label: 'History', Icon: History },
    ],
  },
]

const allItems = [...navGroups.flatMap((g) => g.items), { page: 'config' as Page, label: 'Settings', Icon: Settings }]

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Layout({ page, counts, scanning, onScan, children, historicalLabel, onClearHistorical, projectName, scanTime, branch }: LayoutProps) {
  const [version, setVersion] = useState('')
  const [, tick] = useState(0)

  useEffect(() => {
    getVersion().then((r) => {
      setVersion(r.version)
      if (r.project_dir) setProjectDir(r.project_dir)
    }).catch(() => {})
    // keep "scanned 3m ago" fresh
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // "/" focuses the page's search/filter box, like most developer tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      const input = document.querySelector<HTMLInputElement>('main input[type="search"], main input[type="text"]')
      if (input) {
        e.preventDefault()
        input.focus()
        input.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const current = allItems.find((i) => i.page === page || i.also?.includes(page))

  return (
    <div className="flex h-screen bg-canvas text-fg">
      <aside className="w-60 shrink-0 bg-surface border-r border-line flex flex-col">
        <div className="h-14 px-4 flex items-center gap-2 border-b border-line">
          <ShieldCheck className="w-5 h-5 text-accent" aria-hidden="true" />
          <span className="font-mono font-semibold text-[15px] tracking-tight">gopolice</span>
        </div>

        {projectName && (
          <div className="px-4 py-3 border-b border-line">
            <p className="font-mono text-sm font-medium truncate" title={projectName}>{projectName}</p>
            <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
              {branch && (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="font-mono truncate">{branch}</span>
                </span>
              )}
              {scanTime && (
                <span className="shrink-0" title={new Date(scanTime).toLocaleString()}>· {timeAgo(scanTime)}</span>
              )}
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" aria-label="Main">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-2 mb-1 text-xs font-medium text-fg-subtle">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.page} item={item} active={item === current} counts={counts} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="px-2 py-2 border-t border-line">
          <ul>
            <NavLink item={allItems[allItems.length - 1]} active={page === 'config'} counts={counts} />
          </ul>
          <div className="mt-2 px-2 flex items-center justify-between">
            <span className="text-xs text-fg-subtle font-mono truncate">{version}</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-surface border-b border-line flex items-center gap-3 px-6">
          <h1 className="text-base font-semibold truncate">{current?.label ?? ''}</h1>
          <div className="flex-1" />
          <span className="hidden md:inline text-xs text-fg-subtle">
            Press <kbd className="kbd">/</kbd> to search
          </span>
          <button onClick={onScan} disabled={scanning} className="btn-primary min-w-[7.5rem]">
            {scanning ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
                Scanning…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                Run scan
              </>
            )}
          </button>
        </header>

        {historicalLabel && (
          <div className="shrink-0 px-6 py-2 bg-warning-soft border-b border-warning/30 flex items-center justify-between gap-4 text-sm">
            <p className="text-warning">
              <History className="inline w-4 h-4 mr-1.5 -mt-0.5" aria-hidden="true" />
              Viewing a past scan: <span className="font-medium">{historicalLabel}</span>
            </p>
            <button onClick={onClearHistorical} className="btn-secondary py-1">
              Back to latest
            </button>
          </div>
        )}

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function NavLink({ item, active, counts }: { item: NavItem; active: boolean; counts: NavCounts | null }) {
  const badge = counts && item.count ? item.count(counts) : null
  const { Icon } = item
  return (
    <li>
      <a
        href={routeToHash({ page: item.page })}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
          active ? 'bg-accent-soft text-accent font-medium' : 'text-fg-muted hover:bg-subtle hover:text-fg'
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{item.label}</span>
        {badge && (
          <span
            className={`min-w-[1.5rem] px-1.5 rounded-full text-center text-xs font-medium tabular-nums ${
              badge.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-subtle text-fg-muted'
            }`}
          >
            {badge.value}
          </span>
        )}
      </a>
    </li>
  )
}
