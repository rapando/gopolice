import { ReactNode, useEffect, useState } from 'react'
import {
  ArrowLeft, FlaskConical, Gauge, GitBranch, Ghost, History, LayoutDashboard, LoaderCircle, LogOut, Menu, MoreHorizontal, Network,
  Play, Settings, ShieldAlert, ShieldCheck, TriangleAlert, X, type LucideIcon,
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
  /** Reopens the progress window while a scan runs. */
  onShowScan?: () => void
  children: ReactNode
  historicalLabel?: string | null
  onClearHistorical?: () => void
  projectName?: string
  scanTime?: string
  /** Nanoseconds, from the scan result. */
  scanDuration?: number
  branch?: string
  /** Present in service mode: links back to the repository list and signs out. */
  service?: { username?: string; onLogout: () => void }
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

function fmtScanDuration(ns: number): string {
  const s = Math.round(ns / 1e9)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2, '0')}s`
}

export default function Layout({ page, counts, scanning, onScan, onShowScan, children, historicalLabel, onClearHistorical, projectName, scanTime, scanDuration, branch, service }: LayoutProps) {
  const [version, setVersion] = useState('')
  const [, tick] = useState(0)
  const [hasSearch, setHasSearch] = useState(false)
  // Below lg the sidebar is a drawer; it closes on navigation and Escape.
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => { setDrawerOpen(false) }, [page])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // The "/" hint only makes sense on pages that render a search box.
  useEffect(() => {
    const present = !!document.querySelector('main input[type="search"]')
    if (present !== hasSearch) setHasSearch(present)
  })

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
  const shortName = projectName ? (projectName.split('/').pop() || projectName) : ''

  return (
    <div className="flex h-screen bg-canvas text-fg">
      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-inverse/50 lg:hidden" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 bg-surface border-r border-line flex flex-col transition-transform lg:static lg:translate-x-0 ${drawerOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}
        aria-label="Sidebar"
        aria-hidden={!drawerOpen ? undefined : false}
      >
        <div className="h-14 px-4 flex items-center gap-2 border-b border-line">
          <ShieldCheck className="w-5 h-5 text-accent" aria-hidden="true" />
          <span className="font-mono font-semibold text-[15px] tracking-tight">gopolice</span>
          <button onClick={() => setDrawerOpen(false)} className="btn-ghost p-1 ml-auto lg:hidden" aria-label="Close menu">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {service && (
          <a
            href="#/projects"
            className="px-4 py-2.5 border-b border-line flex items-center gap-2 text-sm text-fg-muted hover:bg-subtle hover:text-fg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            All repositories
          </a>
        )}

        {projectName && (
          <div className="px-4 py-3 border-b border-line min-w-0">
            <p className="text-[15px] font-semibold truncate" title={projectName}>{projectName.split('/').pop() || projectName}</p>
            {projectName.includes('/') && (
              <p className="font-mono text-[11px] text-fg-subtle truncate" title={projectName}>{projectName}</p>
            )}
            {branch && (
              <p className="mt-1 inline-flex items-center gap-1 min-w-0 max-w-full text-xs text-fg-muted">
                <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="font-mono truncate" title={branch}>{branch}</span>
              </p>
            )}
            {scanTime && (
              <p className="text-xs text-fg-subtle" title={new Date(scanTime).toLocaleString()}>
                Scanned {timeAgo(scanTime)}{scanDuration ? ` · ${fmtScanDuration(scanDuration)}` : ''}
              </p>
            )}
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
          {service && (
            <div className="mt-1 flex items-center gap-1">
              <a
                href="#/account"
                className="flex-1 min-w-0 truncate px-2 py-1.5 rounded-md text-sm text-fg-muted hover:bg-subtle hover:text-fg"
                title="Account"
              >
                {service.username ?? 'Account'}
              </a>
              <button onClick={service.onLogout} className="btn-ghost p-1.5" title="Sign out">
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only">Sign out</span>
              </button>
            </div>
          )}
          <div className="mt-2 px-2 flex items-center justify-between">
            <span className="text-xs text-fg-subtle font-mono truncate" title={version}>{version.replace(/-0\.\d{14}-[0-9a-f]+/, '-dev')}</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-surface border-b border-line flex items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setDrawerOpen(true)} className="btn-ghost p-1.5 -ml-1.5 lg:hidden" aria-label="Open menu" aria-expanded={drawerOpen}>
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold truncate leading-tight">{current?.label ?? ''}</h1>
            {shortName && (
              <p className="lg:hidden text-xs text-fg-muted truncate leading-tight">
                {shortName}{branch && <span className="font-mono"> · {branch}</span>}
              </p>
            )}
          </div>
          {hasSearch && (
            <span className="hidden md:inline text-xs text-fg-subtle">
              Press <kbd className="kbd">/</kbd> to search
            </span>
          )}
          <button
            onClick={scanning ? onShowScan : onScan}
            disabled={scanning && !onShowScan}
            className={`${scanning ? 'btn-secondary' : 'btn-primary'} lg:min-w-[7.5rem] px-2.5 lg:px-3`}
            title={scanning ? 'Show scan progress' : 'Run scan'}
            aria-label={scanning ? 'Show scan progress' : 'Run scan'}
          >
            {scanning ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin text-accent" aria-hidden="true" />
                <span className="hidden lg:inline">Scanning…</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                <span className="hidden lg:inline">Run scan</span>
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

        <main className="flex-1 overflow-auto pb-14 lg:pb-0">{children}</main>

        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 h-14 bg-surface border-t border-line grid grid-cols-5" aria-label="Quick navigation">
          {TAB_BAR.map((p) => {
            const item = allItems.find((i) => i.page === p)!
            const active = item === current
            return (
              <a
                key={p}
                href={routeToHash({ page: p })}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${active ? 'text-accent' : 'text-fg-muted'}`}
              >
                <item.Icon className="w-5 h-5" aria-hidden="true" />
                {item.label}
              </a>
            )
          })}
          <button onClick={() => setDrawerOpen(true)} className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted" aria-label="More pages">
            <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
            More
          </button>
        </nav>
      </div>
    </div>
  )
}

/** The four most-used pages get a tab on narrow screens; More opens the drawer. */
const TAB_BAR: Page[] = ['dashboard', 'issues', 'tests', 'performance']

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
