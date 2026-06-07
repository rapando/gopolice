import { useEffect, useRef, useState } from 'react'
import { themes, getScheme, getDark, applyScheme } from '../lib/theme'

// Quick-access appearance control for the top bar — surfaces the headline
// "themes" feature in one click instead of three (Sidebar > Config > scroll).
// The full settings remain on the Config page; this is the high-frequency path.
export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [scheme, setScheme] = useState(getScheme)
  const [dark, setDark] = useState(getDark)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleScheme = (id: string) => {
    setScheme(id)
    applyScheme(id, dark)
  }

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    applyScheme(scheme, next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Change color scheme and appearance"
        aria-expanded={open}
        aria-haspopup="true"
        className="p-2 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-ctp-subtext0 dark:hover:bg-ctp-surface0 dark:hover:text-ctp-text transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h10a2 2 0 002-2v-4a2 2 0 00-2-2h-2.5M7 21a4 4 0 004-4M5 9h2m-2 4h2" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 z-30 rounded-lg border shadow-lg p-3 card"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-ctp-subtext1 mb-1.5">Color scheme</p>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => handleScheme(t.id)}
                aria-pressed={scheme === t.id}
                className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                  scheme === t.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-ctp-lavender dark:bg-ctp-base dark:text-ctp-lavender'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-ctp-surface1 dark:text-ctp-subtext0 dark:hover:bg-ctp-surface0'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-ctp-subtext1 mb-1.5">Appearance</p>
          <button
            onClick={toggleDark}
            aria-pressed={dark}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors text-gray-700 dark:text-ctp-subtext0"
          >
            {dark ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Switch to Light Mode
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                Switch to Dark Mode
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
