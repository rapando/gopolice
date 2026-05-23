import { ReactNode, useEffect, useState } from 'react'
import { getVersion } from '../api/client'

interface LayoutProps {
  page: string
  onNavigate: (page: string, param?: string) => void
  scanning: boolean
  onScan: () => void
  children: ReactNode
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'issues', label: 'Issues' },
  { id: 'tests', label: 'Tests' },
  { id: 'security', label: 'Security' },
  { id: 'git', label: 'Git' },
  { id: 'config', label: 'Config' },
]

export default function Layout({ page, onNavigate, scanning, onScan, children }: LayoutProps) {
  const [version, setVersion] = useState('')
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = stored === 'dark' || (!stored && prefersDark)
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  useEffect(() => {
    getVersion().then((r) => setVersion(r.version)).catch(() => {})
  }, [])

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-white border-b border-gray-200 flex items-center shrink-0 px-5 dark:bg-ctp-mantle dark:border-ctp-surface1">
        <div className="flex items-center gap-6 mr-8">
          <h1 className="font-bold text-base tracking-tight text-gray-800 dark:text-ctp-text">gopolice</h1>
        </div>

        <nav className="flex items-center gap-1 flex-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`px-3 py-3 text-sm transition-colors border-b-2 ${
                page === item.id
                  ? 'border-blue-500 text-blue-600 font-medium dark:border-ctp-lavender dark:text-ctp-lavender'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-ctp-overlay0 dark:hover:text-ctp-text dark:hover:border-ctp-surface1'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleDark}
            className="p-2 text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100 dark:text-ctp-overlay1 dark:hover:text-ctp-text dark:hover:bg-ctp-surface0 transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          <button
            onClick={onScan}
            disabled={scanning}
            className="px-4 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400 rounded transition-colors text-white disabled:cursor-not-allowed dark:bg-ctp-green dark:text-ctp-base dark:hover:bg-ctp-teal dark:disabled:bg-ctp-surface1 dark:disabled:text-ctp-overlay0"
          >
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-ctp-base">{children}</main>

      <footer className="shrink-0 px-5 py-1 text-xs text-gray-400 bg-white border-t border-gray-100 flex justify-end items-center gap-1 dark:bg-ctp-mantle dark:border-ctp-surface1 dark:text-ctp-overlay0">
        {version && <span>v{version}</span>}
        <span>&copy; Rapando</span>
      </footer>
    </div>
  )
}
