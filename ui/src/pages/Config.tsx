import { useState, useEffect } from 'react'
import { getGlobalConfig, updateGlobalConfig } from '../api/client'

export default function ConfigPage() {
  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getGlobalConfig().then((c) => { setForm(c) }).catch(() => {})
  }, [])

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
          <p className="text-gray-500 dark:text-ctp-overlay0">Loading...</p>
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
      {desc && <p className="text-xs text-gray-400 dark:text-ctp-overlay1 mb-1.5">{desc}</p>}
      <input
        type={type || 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full max-w-md"
      />
    </div>
  )
}
