import { useState, useEffect, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { getGlobalConfig, updateGlobalConfig } from '../api/client'
import ThemeToggle from '../components/ThemeToggle'
import { editors, getEditor, setEditor, type Editor } from '../lib/editor'

// Scanner names as reported by the Go pipeline (Scanner.Name()).
const SCANNERS: { name: string; label: string; desc: string }[] = [
  { name: 'lint', label: 'Lint', desc: 'golangci-lint, or go vet when it is not installed' },
  { name: 'security', label: 'Security', desc: 'gosec and govulncheck' },
  { name: 'tests', label: 'Tests', desc: 'go test with coverage' },
  { name: 'benchmarks', label: 'Benchmarks', desc: 'go test -bench; slow on large suites' },
  { name: 'profile', label: 'Profiling', desc: 'CPU and memory profiles of benchmarks; slow' },
  { name: 'deadcode', label: 'Dead code', desc: 'staticcheck U1000' },
  { name: 'complexity', label: 'Complexity', desc: 'Cyclomatic complexity per function' },
  { name: 'depgraph', label: 'Dependency graph', desc: 'go mod graph' },
  { name: 'filestats', label: 'File stats', desc: 'Line counts' },
  { name: 'git', label: 'Git', desc: 'Branch, authors and commits' },
]

interface GlobalConfig {
  port: number
  disabled_scanners?: string[]
}

export default function ConfigPage() {
  const [form, setForm] = useState<GlobalConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditorState] = useState<Editor>(getEditor)

  useEffect(() => {
    getGlobalConfig().then(setForm).catch((e) => setError(String(e.message ?? e)))
  }, [])

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    setError('')
    try {
      await updateGlobalConfig(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e.message ?? String(e))
    }
    setSaving(false)
  }

  const disabled = new Set(form?.disabled_scanners ?? [])
  const toggleScanner = (name: string) => {
    if (!form) return
    const next = new Set(disabled)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setForm({ ...form, disabled_scanners: SCANNERS.map((s) => s.name).filter((n) => next.has(n)) })
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <Section title="Appearance" desc="Stored in this browser.">
        <Row label="Theme" desc="System follows your OS setting.">
          <ThemeToggle />
        </Row>
        <Row label="Open files in" desc="Used by the open-in-editor buttons next to file paths.">
          <select
            value={editor}
            onChange={(e) => {
              const v = e.target.value as Editor
              setEditorState(v)
              setEditor(v)
            }}
            className="input w-40"
          >
            {editors.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </Row>
      </Section>

      <Section
        title="Scan settings"
        desc={<>Saved to <code className="font-mono text-xs">~/.config/gopolice/config.yaml</code>. Applies to the next <code className="font-mono text-xs">gopolice</code> run.</>}
        action={
          <div className="flex items-center gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-success">
                <Check className="w-4 h-4" aria-hidden="true" /> Saved
              </span>
            )}
            <button onClick={handleSave} disabled={saving || !form} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        {error && <p className="text-sm text-danger">{error}</p>}
        {!form ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <>
            <Row label="Port" desc="Web UI port. The next free port is used if it is taken.">
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 9393 })}
                className="input w-28 font-mono"
              />
            </Row>
            <div>
              <p className="text-sm font-medium">Scanners</p>
              <p className="text-sm text-fg-muted mb-3">Turn off scanners you don't need to make scans faster.</p>
              <ul className="grid sm:grid-cols-2 gap-2">
                {SCANNERS.map((s) => (
                  <li key={s.name}>
                    <label className="flex items-start gap-3 p-3 rounded-md border border-line hover:bg-subtle cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!disabled.has(s.name)}
                        onChange={() => toggleScanner(s.name)}
                        className="mt-0.5 w-4 h-4"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.label}</span>
                        <span className="block text-xs text-fg-muted">{s.desc}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </Section>
    </div>
  )
}

function Section({ title, desc, action, children }: { title: string; desc?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {desc && <p className="text-sm text-fg-muted mt-0.5">{desc}</p>}
        </div>
        {action}
      </header>
      <div className="px-6 py-5 space-y-5">{children}</div>
    </section>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-sm text-fg-muted">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
