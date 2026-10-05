import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { applyThemeMode, getThemeMode, watchSystemTheme, type ThemeMode } from '../lib/theme'

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  { mode: 'system', label: 'System', Icon: Monitor },
]

/** Segmented light / dark / system control. */
export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode)

  useEffect(() => watchSystemTheme(), [])

  const choose = (m: ThemeMode) => {
    setMode(m)
    applyThemeMode(m)
  }

  return (
    <div role="radiogroup" aria-label="Color theme" className="inline-flex rounded-md border border-line bg-subtle p-0.5">
      {OPTIONS.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          title={label}
          onClick={() => choose(m)}
          className={`flex items-center justify-center w-7 h-6 rounded transition-colors ${
            mode === m ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
          }`}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  )
}
