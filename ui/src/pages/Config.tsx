import { useState, useEffect } from 'react'
import { getConfig, getGlobalConfig, getProjectConfig, updateGlobalConfig, updateProjectConfig } from '../api/client'

export default function ConfigPage() {
  const [merged, setMerged] = useState<any>(null)
  const [global, setGlobal] = useState<any>(null)
  const [project, setProject] = useState<any>(null)
  const [active, setActive] = useState<'global' | 'project'>('global')
  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getConfig().then(setMerged).catch(() => {})
    getGlobalConfig().then((c) => { setGlobal(c); setForm(c) }).catch(() => {})
    getProjectConfig().then(setProject).catch(() => {})
  }, [])

  const switchTo = (scope: 'global' | 'project') => {
    setActive(scope)
    const data = scope === 'global' ? global : project
    setForm(data || { ...merged })
    setSaved(false)
  }

  const set = (path: string, value: any) => {
    setForm((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev))
      const keys = path.split('.')
      let obj = next
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {}
        obj = obj[keys[i]]
      }
      obj[keys[keys.length - 1]] = value
      return next
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (active === 'global') {
        await updateGlobalConfig(form)
        setGlobal(form)
      } else {
        await updateProjectConfig(form)
        setProject(form)
      }
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

      <div className="flex gap-1 mb-6">
        <button
          onClick={() => switchTo('global')}
          className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
            active === 'global'
              ? 'bg-gray-900 text-white dark:bg-ctp-surface0 dark:text-ctp-text'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-ctp-mantle dark:text-ctp-overlay1 dark:hover:bg-ctp-surface0'
          }`}
        >
          Global (~/.config/gopolice/)
        </button>
        <button
          onClick={() => switchTo('project')}
          className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
            active === 'project'
              ? 'bg-gray-900 text-white dark:bg-ctp-surface0 dark:text-ctp-text'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-ctp-mantle dark:text-ctp-overlay1 dark:hover:bg-ctp-surface0'
          }`}
        >
          Project (.gopolice/)
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-ctp-surface1">
          <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">Scan settings</p>
        </div>
        <div className="px-6 py-5 space-y-5">
          <Field label="Project path" desc="Directory to scan" value={form.project?.path} onChange={(v) => set('project.path', v)} />
          <Field label="Exclude dirs" desc="Comma-separated directories to skip" value={form.project?.exclude_dirs?.join(', ') || ''} onChange={(v) => set('project.exclude_dirs', v.split(',').map((s: string) => s.trim()).filter(Boolean))} />

          <div className="pt-2 border-t border-gray-100 dark:border-ctp-surface2">
            <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide mb-4">Scanners</p>
            <div className="grid grid-cols-2 gap-4">
              <Toggle label="Lint" value={form.scan?.scanners?.lint} onChange={(v) => set('scan.scanners.lint', v)} />
              <Toggle label="Security" value={form.scan?.scanners?.security} onChange={(v) => set('scan.scanners.security', v)} />
              <Toggle label="Tests" value={form.scan?.scanners?.tests} onChange={(v) => set('scan.scanners.tests', v)} />
              <Toggle label="Profile" value={form.scan?.scanners?.profile} onChange={(v) => set('scan.scanners.profile', v)} />
              <Toggle label="Git" value={form.scan?.scanners?.git} onChange={(v) => set('scan.scanners.git', v)} />
              <Toggle label="Complexity" value={form.scan?.scanners?.complexity} onChange={(v) => set('scan.scanners.complexity', v)} />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-b border-gray-200 dark:border-ctp-surface1">
          <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">Scan flags</p>
        </div>
        <div className="px-6 py-5 space-y-5">
          <Toggle label="Quick mode" desc="Skip expensive scans (profile, complexity)" value={form.scan?.quick} onChange={(v) => set('scan.quick', v)} />
          <Toggle label="Profile" desc="Run CPU/memory profiling" value={form.scan?.profile} onChange={(v) => set('scan.profile', v)} />
          <Toggle label="Bench" desc="Run benchmarks" value={form.scan?.bench} onChange={(v) => set('scan.bench', v)} />
        </div>

        <div className="px-6 py-4 border-t border-b border-gray-200 dark:border-ctp-surface1">
          <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">UI settings</p>
        </div>
        <div className="px-6 py-5 space-y-5">
          <Field label="Port" desc="Web UI port number" value={form.ui?.port} onChange={(v) => set('ui.port', parseInt(v) || 9393)} type="number" />
          <Toggle label="Open browser" desc="Automatically open browser on scan" value={form.ui?.open_browser} onChange={(v) => set('ui.open_browser', v)} />
        </div>

        <div className="px-6 py-4 border-t border-b border-gray-200 dark:border-ctp-surface1">
          <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">Export</p>
        </div>
        <div className="px-6 py-5 space-y-5">
          <Field label="Export format" desc="Output format (json)" value={form.export?.format} onChange={(v) => set('export.format', v)} />
          <Field label="Export path" desc="Output file path" value={form.export?.output} onChange={(v) => set('export.output', v)} />
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

function Toggle({ label, desc, value, onChange }: {
  label: string; desc?: string; value?: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <div>
        <span className="text-sm text-gray-700 dark:text-ctp-subtext0">{label}</span>
        {desc && <p className="text-xs text-gray-400 dark:text-ctp-overlay1">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
          value ? 'bg-green-600 dark:bg-ctp-green' : 'bg-gray-300 dark:bg-ctp-surface1'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          value ? 'translate-x-5' : ''
        }`} />
      </button>
    </div>
  )
}
