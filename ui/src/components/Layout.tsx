import { ReactNode, useEffect, useState } from 'react'
import { getVersion } from '../api/client'
import ThemeSwitcher from './ThemeSwitcher'

interface LayoutProps {
  page: string
  onNavigate: (page: string, param?: string) => void
  scanning: boolean
  onScan: () => void
  children: ReactNode
  historicalLabel?: string | null
  onClearHistorical?: () => void
  projectName?: string
  scanTime?: string
}

interface NavItem {
  id: string
  label: string
  icon: ReactNode
}

function StrokeIcon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { id: 'issues', label: 'Issues', icon: '⚠' },
  { id: 'security', label: 'Security', icon: <StrokeIcon d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /> },
  { id: 'deadcode', label: 'Dead Code', icon: '✕' },
  { id: 'tests', label: 'Tests', icon: '✓' },
  { id: 'performance', label: 'Performance', icon: <StrokeIcon d="M3 13.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /> },
  { id: 'depgraph', label: 'Dep Graph', icon: '◉' },
  { id: 'git', label: 'Git', icon: '⬡' },
  { id: 'history', label: 'History', icon: '↻' },
  { id: 'config', label: 'Config', icon: '⚙' },
]

export default function Layout({ page, onNavigate, scanning, onScan, children, historicalLabel, onClearHistorical, projectName, scanTime }: LayoutProps) {
  const [version, setVersion] = useState('')

  useEffect(() => {
    const oldTheme = localStorage.getItem('theme')
    let scheme = localStorage.getItem('scheme')
    let dark: boolean

    if (oldTheme === 'dark' || oldTheme === 'light') {
      dark = oldTheme === 'dark'
      scheme = scheme || 'catppuccin'
      localStorage.setItem('scheme', scheme)
      localStorage.setItem('dark', String(dark))
      localStorage.removeItem('theme')
    } else {
      scheme = scheme || 'catppuccin'
      dark = localStorage.getItem('dark') === 'true' ||
        (localStorage.getItem('dark') === null && window.matchMedia('(prefers-color-scheme: dark)').matches)
    }

    document.documentElement.setAttribute('data-theme', scheme)
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  useEffect(() => {
    getVersion().then((r) => setVersion(r.version)).catch(() => {})
  }, [])

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white dark:bg-ctp-mantle border-r border-gray-200 dark:border-ctp-surface1 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-ctp-surface1">
          <h1 className="font-bold text-base tracking-tight text-gray-800 dark:text-ctp-text">gopolice</h1>
          {projectName && (
            <p className="mt-1 text-xs text-gray-500 dark:text-ctp-subtext0 truncate" title={projectName}>{projectName}</p>
          )}
          {scanTime && (
            <p className="text-[11px] text-gray-400 dark:text-ctp-subtext1">Scanned {new Date(scanTime).toLocaleString()}</p>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors text-left ${
                page === item.id
                  ? 'bg-blue-50 text-blue-600 font-medium border-r-2 border-blue-500 dark:bg-ctp-base dark:text-ctp-lavender dark:border-ctp-lavender'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-ctp-subtext0 dark:hover:bg-ctp-base dark:hover:text-ctp-text'
              }`}
            >
              <span className="text-sm w-5 text-center shrink-0">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-ctp-surface1 text-[11px] text-gray-400 dark:text-ctp-subtext1">
          {version && <div>{version}</div>}
          <div>&copy; Rapando</div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white dark:bg-ctp-mantle border-b border-gray-200 dark:border-ctp-surface1 flex items-center shrink-0 px-5 h-12">
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            {scanning ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-400 dark:text-ctp-subtext0 bg-gray-100 dark:bg-ctp-surface1 rounded cursor-not-allowed select-none">
                <span className="w-3 h-3 rounded-full border-2 border-gray-300 dark:border-ctp-overlay0 border-t-transparent animate-spin" />
                <span className="hidden sm:inline">Scanning</span>
              </span>
            ) : (
              <button
                onClick={onScan}
                className="px-4 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 rounded transition-colors text-white dark:bg-ctp-green dark:text-ctp-base dark:hover:bg-ctp-teal"
              >
                Run Scan
              </button>
            )}
          </div>
        </header>

        {historicalLabel && (
          <div className="shrink-0 px-5 py-2 bg-yellow-50 border-b border-yellow-200 flex items-center justify-between text-sm dark:bg-ctp-surface0 dark:border-ctp-surface1">
            <p className="text-yellow-800 dark:text-ctp-yellow">
              <span className="font-medium">Historical:</span> {historicalLabel}
            </p>
            <button
              onClick={onClearHistorical}
              className="text-xs font-medium text-yellow-700 hover:text-yellow-900 dark:text-ctp-yellow dark:hover:text-ctp-text underline"
            >
              Back to current
            </button>
          </div>
        )}

        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-ctp-base">{children}</main>
      </div>
    </div>
  )
}