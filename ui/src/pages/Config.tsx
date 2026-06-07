import { useState, useEffect } from 'react'
import { getGlobalConfig, updateGlobalConfig } from '../api/client'
import { themes, getScheme, getDark, applyScheme } from '../lib/theme'

export default function ConfigPage() {
  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [scheme, setScheme] = useState(getScheme)
  const [dark, setDark] = useState(getDark)

  useEffect(() => {
    getGlobalConfig().then((c) => { setForm(c) }).catch(() => {})
  }, [])

  const handleSchemeChange = (id: string) => {
    setScheme(id)
    applyScheme(id, dark)
  }

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    applyScheme(scheme, next)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateGlobalConfig(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {}
    setSaving(false)
  }

  if (!form) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <h2 className="text-lg font-bold text-gray-800 mb-5 dark:text-ctp-text">Config</h2>
        <div className="card p-8 text-center">
          <p className="text-gray-500 dark:text-ctp-subtext0">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text">Config</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-600 dark:text-ctp-green font-medium">Saved</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400 transition-colors dark:bg-ctp-green dark:text-ctp-base dark:hover:bg-ctp-teal dark:disabled:bg-ctp-surface1 dark:disabled:text-ctp-overlay0"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-5 space-y-5">
          <Field label="Port" desc="Web UI port number" value={form.port} onChange={(v) => setForm({ ...form, port: parseInt(v) || 9393 })} type="number" />

          <hr className="border-gray-200 dark:border-ctp-surface1" />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-ctp-subtext0 mb-1">Color Scheme</label>
            <p className="text-xs text-gray-400 dark:text-ctp-subtext1 mb-2">Choose a color palette for the UI</p>
            <div className="flex flex-wrap gap-2">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSchemeChange(t.id)}
                  aria-pressed={scheme === t.id}
                  className={`px-4 py-2 text-sm rounded border transition-colors ${
                    scheme === t.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-ctp-lavender dark:bg-ctp-base dark:text-ctp-lavender'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-ctp-surface1 dark:text-ctp-subtext0 dark:hover:bg-ctp-surface0'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <hr className="border-gray-200 dark:border-ctp-surface1" />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-ctp-subtext0 mb-1">Appearance</label>
            <p className="text-xs text-gray-400 dark:text-ctp-subtext1 mb-2">Toggle between light and dark mode</p>
            <button
              onClick={toggleDark}
              aria-pressed={dark}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded border border-gray-300 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors text-gray-700 dark:text-ctp-subtext0"
            >
              {dark ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Switch to Light Mode
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  Switch to Dark Mode
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, desc, value, onChange, type }: {
  label: string; desc?: string; value?: any; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-ctp-subtext0 mb-1">{label}</label>
      {desc && <p className="text-xs text-gray-400 dark:text-ctp-subtext1 mb-1.5">{desc}</p>}
      <input
        type={type || 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full max-w-md"
      />
    </div>
  )
}
