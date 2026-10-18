import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp, Fingerprint, FolderGit2, FolderOpen, FolderPlus, GitBranch, LoaderCircle, Play, Trash2, TriangleAlert, X,
} from 'lucide-react'
import {
  addProject, browse, listPasskeys, listProjects, removeProject, triggerScanFor,
  type BrowseResult, type ProjectView,
} from '../api/client'
import { navigate } from '../lib/router'
import { passkeysSupported } from '../lib/passkey'
import Spinner from '../components/Spinner'

const GRADE_TEXT: Record<string, string> = {
  A: 'text-success', B: 'text-success', C: 'text-warning', D: 'text-orange', F: 'text-danger',
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Projects({ osMode = false }: { osMode?: boolean }) {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  const [suggestPasskey, setSuggestPasskey] = useState(false)

  const load = useCallback(() => {
    listProjects().then(setProjects).catch((e) => setError(e.message ?? String(e)))
  }, [])

  useEffect(() => {
    load()
    if (!osMode && passkeysSupported()) {
      listPasskeys().then((l) => setSuggestPasskey(l.length === 0)).catch(() => {})
    }
  }, [load])

  // Keep scan state fresh while anything is scanning.
  const anyScanning = projects?.some((p) => p.scanning) ?? false
  useEffect(() => {
    if (!anyScanning) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [anyScanning, load])

  const open = (id: string) => navigate({ page: 'dashboard', project: id })

  const scan = async (id: string) => {
    setError('')
    try {
      await triggerScanFor(id)
    } catch (e: any) {
      setError(e.message ?? String(e))
      return
    }
    open(id)
  }

  const remove = async (id: string) => {
    try {
      await removeProject(id)
      load()
    } catch (e: any) {
      setError(e.message ?? String(e))
    }
  }

  const opened = (p: ProjectView) => {
    setPicking(false)
    open(p.id)
  }

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Repositories</h1>
          <p className="text-sm text-fg-muted mt-0.5">Open a Go repository on this machine and scan it. Opened repositories are saved here.</p>
        </div>
        <button onClick={() => setPicking(true)} className="btn-primary shrink-0">
          <FolderPlus className="w-4 h-4" aria-hidden="true" />
          Open repository
        </button>
      </div>

      {suggestPasskey && (
        <div className="card px-4 py-3 flex items-center gap-3 bg-accent-soft border-accent/30">
          <Fingerprint className="w-5 h-5 text-accent shrink-0" aria-hidden="true" />
          <p className="text-sm flex-1">Add a passkey to sign in with Touch ID, Windows Hello or your device PIN.</p>
          <a href="#/account" className="btn-secondary">Set up</a>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {projects === null ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : projects.length === 0 ? (
        <div className="card px-6 py-14 flex flex-col items-center text-center">
          <FolderGit2 className="w-8 h-8 mb-3 text-fg-subtle" aria-hidden="true" />
          <p className="text-base font-medium">No repositories yet</p>
          <p className="mt-1 text-sm text-fg-muted max-w-md">Pick a folder containing a <code className="font-mono text-xs">go.mod</code> to start scanning it.</p>
          <button onClick={() => setPicking(true)} className="btn-primary mt-5">
            <FolderPlus className="w-4 h-4" aria-hidden="true" />
            Open repository
          </button>
        </div>
      ) : (
        <ul className="grid md:grid-cols-2 gap-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => open(p.id)} onScan={() => scan(p.id)} onRemove={() => remove(p.id)} />
          ))}
        </ul>
      )}

      {picking && <FolderPicker onClose={() => setPicking(false)} onOpened={opened} />}
    </div>
  )
}

function ProjectCard({ p, onOpen, onScan, onRemove }: { p: ProjectView; onOpen: () => void; onScan: () => void; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono font-medium truncate" title={p.name}>{p.name}</p>
          <p className="text-xs text-fg-muted font-mono truncate" title={p.path}>{p.path}</p>
        </div>
        {p.has_result && p.grade && (
          <span className={`text-3xl font-bold leading-none ${GRADE_TEXT[p.grade] ?? 'text-fg'}`} aria-label={`Grade ${p.grade}`}>
            {p.grade}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-fg-muted min-h-[1.125rem]">
        {p.missing ? (
          <span className="inline-flex items-center gap-1 text-danger">
            <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" /> Folder not found
          </span>
        ) : p.scanning ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Scanning…
          </span>
        ) : p.has_result ? (
          <>
            <span>{p.issues} {p.issues === 1 ? 'issue' : 'issues'}{p.errors ? ` (${p.errors} errors)` : ''}</span>
            {p.branch && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="font-mono truncate">{p.branch}</span>
              </span>
            )}
            {p.scan_time && <span title={new Date(p.scan_time).toLocaleString()}>scanned {timeAgo(p.scan_time)}</span>}
          </>
        ) : (
          <span>Not scanned yet</span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-auto">
        <button onClick={onOpen} disabled={p.missing} className="btn-secondary">
          <FolderOpen className="w-4 h-4" aria-hidden="true" /> Open
        </button>
        <button onClick={onScan} disabled={p.missing || p.scanning} className="btn-primary">
          <Play className="w-4 h-4" aria-hidden="true" /> Scan
        </button>
        <div className="flex-1" />
        {confirming ? (
          <>
            <span className="text-xs text-fg-muted">Remove from list?</span>
            <button onClick={onRemove} className="btn-secondary text-danger">Remove</button>
            <button onClick={() => setConfirming(false)} className="btn-ghost">Cancel</button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} className="btn-ghost" title="Remove from list (files are not touched)">
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Remove {p.name}</span>
          </button>
        )}
      </div>
    </li>
  )
}

function FolderPicker({ onClose, onOpened }: { onClose: () => void; onOpened: (p: ProjectView) => void }) {
  const [dir, setDir] = useState<BrowseResult | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const go = useCallback((path?: string, showHidden = hidden) => {
    setError('')
    browse(path, showHidden)
      .then((r) => { setDir(r); setPathInput(r.path) })
      .catch((e) => setError(e.message ?? String(e)))
  }, [hidden])

  useEffect(() => { go() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openPath = async (path: string) => {
    setOpening(true)
    setError('')
    try {
      onOpened(await addProject(path))
    } catch (e: any) {
      setError(e.message ?? String(e))
      setOpening(false)
    }
  }

  const submitPath = (e: FormEvent) => {
    e.preventDefault()
    go(pathInput)
  }

  return (
    <div className="fixed inset-0 z-50 bg-inverse/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Open repository"
        className="card w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl outline-none"
      >
        <header className="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-base font-semibold">Open repository</h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={submitPath} className="px-5 py-3 border-b border-line flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary px-2"
            disabled={!dir?.parent}
            onClick={() => dir?.parent && go(dir.parent)}
            title="Parent folder"
          >
            <ArrowUp className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Parent folder</span>
          </button>
          <input
            className="input flex-1 font-mono"
            aria-label="Folder path"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" className="btn-secondary">Go</button>
        </form>

        <div className="flex-1 overflow-auto min-h-[16rem]">
          {error && <p role="alert" className="px-5 py-3 text-sm text-danger">{error}</p>}
          {!dir && !error ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : dir && dir.entries.length === 0 ? (
            <p className="px-5 py-8 text-sm text-fg-muted text-center">No sub-folders.</p>
          ) : (
            <ul className="divide-y divide-line">
              {dir?.entries.map((e) => (
                <li key={e.path} className="flex items-center gap-2 px-5 py-1.5 hover:bg-subtle">
                  <button onClick={() => go(e.path)} className="flex-1 min-w-0 flex items-center gap-2 py-1 text-left text-sm">
                    {e.go_project
                      ? <FolderGit2 className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
                      : <FolderOpen className="w-4 h-4 text-fg-subtle shrink-0" aria-hidden="true" />}
                    <span className="truncate font-mono">{e.name}</span>
                    {e.go_project && <span className="text-xs text-accent shrink-0">Go</span>}
                  </button>
                  {e.go_project && (
                    <button onClick={() => openPath(e.path)} disabled={opening} className="btn-secondary py-1">Open</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-line flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => { setHidden(e.target.checked); go(dir?.path, e.target.checked) }}
            />
            Show hidden folders
          </label>
          <div className="flex-1" />
          {dir && !dir.go_project && (
            <span className="text-xs text-fg-muted">No go.mod in this folder</span>
          )}
          <button onClick={() => dir && openPath(dir.path)} disabled={!dir?.go_project || opening} className="btn-primary">
            {opening && <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Open this folder
          </button>
        </footer>
      </div>
    </div>
  )
}
