import { useState, useMemo, Fragment } from 'react'
import { ChevronDown, ChevronRight, Download, LoaderCircle, Search, Wrench, X } from 'lucide-react'
import { getSnippet, batchFix, Issue, Snippet } from '../api/client'
import FixPlan from '../components/FixPlan'
import FileLink from '../components/FileLink'
import CodeSnippet from '../components/CodeSnippet'
import { SeverityBadge, SeverityIcon } from '../components/Severity'
import { severities, severityBadgeClass } from '../lib/severity'

interface Props {
  issues: Issue[]
  onSelectIssue: (id: string) => void
  onSelectFile: (file: string) => void
  projectName?: string
}

type GroupBy = '' | 'rule' | 'file' | 'category' | 'module'

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: '', label: 'No grouping' },
  { id: 'file', label: 'File' },
  { id: 'rule', label: 'Rule' },
  { id: 'category', label: 'Category' },
  { id: 'module', label: 'Module' },
]

function groupKey(issue: Issue, by: GroupBy): string {
  switch (by) {
    case 'rule': return issue.rule || 'unknown'
    case 'file': return issue.file || 'unknown'
    case 'category': return issue.category || 'unknown'
    case 'module': return issue.module || '(root)'
  }
  return ''
}

const COLS = 4

export default function Issues({ issues, onSelectIssue, onSelectFile, projectName }: Props) {
  const [selectedSeverity, setSelectedSeverity] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<{ id: string; data: Snippet | null; error?: string } | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchMsg, setBatchMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [applying, setApplying] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const hasModules = issues.some((i) => i.module)

  const severityCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const i of issues) m[i.severity] = (m[i.severity] ?? 0) + 1
    return m
  }, [issues])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return issues.filter((i) => {
      if (selectedSeverity && i.severity !== selectedSeverity) return false
      if (q && ![i.message, i.file, i.rule, i.scanner].some((f) => f?.toLowerCase().includes(q))) return false
      return true
    })
  }, [issues, selectedSeverity, search])

  const toggleSnippet = async (issue: Issue) => {
    if (expanded?.id === issue.id) {
      setExpanded(null)
      return
    }
    setExpanded({ id: issue.id, data: null })
    try {
      const data = await getSnippet(issue.file, issue.line)
      setExpanded((cur) => (cur?.id === issue.id ? { id: issue.id, data } : cur))
    } catch (err: any) {
      setExpanded((cur) => (cur?.id === issue.id ? { id: issue.id, data: null, error: err.message ?? 'Could not load source' } : cur))
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleMany = (ids: string[]) => {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const handleBatchApply = async () => {
    if (selected.size === 0) return
    setApplying(true)
    setBatchMsg(null)
    try {
      const res = await batchFix(Array.from(selected))
      const ok = res.results.filter((r) => r.applied).length
      const fail = res.results.length - ok
      setBatchMsg({ ok: fail === 0, text: `Applied ${ok} fix${ok !== 1 ? 'es' : ''}${fail > 0 ? `, ${fail} could not be fixed automatically` : ''}. Run a scan to refresh results.` })
      setSelected(new Set())
    } catch (err: any) {
      setBatchMsg({ ok: false, text: `Fix failed: ${err.message}` })
    }
    setApplying(false)
  }

  const groups = groupBy ? groupIssues(filtered, groupBy) : null
  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id))

  const rowProps = (issue: Issue) => ({
    issue,
    selected: selected.has(issue.id),
    expanded: expanded?.id === issue.id ? expanded : null,
    onToggleSelect: () => toggleSelect(issue.id),
    onSelectIssue: () => onSelectIssue(issue.id),
    onToggleSnippet: () => toggleSnippet(issue),
    onOpenFile: () => onSelectFile(issue.file),
  })

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-80">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search message, file, rule…"
            aria-label="Search issues"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-8"
          />
        </div>

        <div className="flex gap-1.5" role="group" aria-label="Filter by severity">
          {severities.map((s) => {
            const active = selectedSeverity === s
            return (
              <button
                key={s}
                onClick={() => setSelectedSeverity(active ? '' : s)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md border transition-colors ${ active ?`${severityBadgeClass(s)} border-current` : 'border-line text-fg-muted hover:bg-subtle hover:text-fg'
                }`}
              >
                <SeverityIcon severity={s} className="w-3.5 h-3.5" />
                <span className="capitalize">{s}</span>
                <span className="tabular-nums text-fg-muted">{severityCounts[s] ?? 0}</span>
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Group by
          <select value={groupBy} onChange={(e) => { setGroupBy(e.target.value as GroupBy); setSelected(new Set()) }} className="input py-1">
            {GROUPS.filter((g) => g.id !== 'module' || hasModules).map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </label>

        <button onClick={() => setShowExport(true)} className="btn-secondary" title="Export a Markdown fix plan">
          <Download className="w-4 h-4" aria-hidden="true" />
          Export plan
        </button>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="mb-4 px-4 py-2.5 bg-accent-soft border border-accent/30 rounded-lg flex items-center gap-3">
          <span className="text-sm font-medium text-accent">{selected.size} selected</span>
          <span className="text-sm text-fg-muted">Auto-fix runs gofmt, gofumpt or gci on the affected files; other issues are skipped.</span>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="btn-ghost">Clear</button>
          <button onClick={handleBatchApply} disabled={applying} className="btn-primary">
            {applying ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            {applying ? 'Applying…' : 'Apply auto-fix'}
          </button>
        </div>
      )}

      {batchMsg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${batchMsg.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
          {batchMsg.text}
          <button onClick={() => setBatchMsg(null)} aria-label="Dismiss" className="p-1 rounded hover:bg-black/5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <p className="mb-2 text-sm text-fg-muted" aria-live="polite">
        {filtered.length === issues.length ? `${issues.length} issues` : `${filtered.length} of ${issues.length} issues`}
      </p>

      {filtered.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="font-medium">{issues.length === 0 ? 'No issues found' : 'No issues match these filters'}</p>
          {issues.length > 0 && (
            <button onClick={() => { setSearch(''); setSelectedSeverity('') }} className="btn-secondary mt-4">Clear filters</button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle">
                <th className="th w-10">
                  <input type="checkbox" checked={allVisibleSelected} onChange={() => toggleMany(filtered.map((i) => i.id))} aria-label="Select all visible issues" className="w-4 h-4" />
                </th>
                <th className="th w-28">Severity</th>
                <th className="th">Issue</th>
                <th className="th w-[32%]">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {groups
                ? Array.from(groups.entries()).map(([key, groupIssues]) => (
                    <Fragment key={key}>
                      <tr className="bg-subtle">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={groupIssues.every((i) => selected.has(i.id))}
                            onChange={() => toggleMany(groupIssues.map((i) => i.id))}
                            aria-label={`Select all in ${key}`}
                            className="w-4 h-4"
                          />
                        </td>
                        <td colSpan={COLS - 1} className="px-4 py-2 text-sm">
                          <span className={`font-medium ${groupBy === 'file' || groupBy === 'rule' ? 'font-mono text-[13px]' : 'capitalize'}`}>{key}</span>
                          <span className="ml-2 text-fg-muted tabular-nums">{groupIssues.length}</span>
                        </td>
                      </tr>
                      {groupIssues.map((issue) => <IssueRow key={issue.id} {...rowProps(issue)} />)}
                    </Fragment>
                  ))
                : filtered.map((issue) => <IssueRow key={issue.id} {...rowProps(issue)} />)}
            </tbody>
          </table>
        </div>
      )}

      {showExport && (
        <FixPlan issues={issues} projectName={projectName || 'project'} onClose={() => setShowExport(false)} />
      )}
    </div>
  )
}

function groupIssues(issues: Issue[], by: GroupBy): Map<string, Issue[]> {
  const groups = new Map<string, Issue[]>()
  for (const issue of issues) {
    const key = groupKey(issue, by)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(issue)
  }
  return new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length))
}

interface IssueRowProps {
  issue: Issue
  selected: boolean
  expanded: { data: Snippet | null; error?: string } | null
  onToggleSelect: () => void
  onSelectIssue: () => void
  onToggleSnippet: () => void
  onOpenFile: () => void
}

function IssueRow({ issue, selected, expanded, onToggleSelect, onSelectIssue, onToggleSnippet, onOpenFile }: IssueRowProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <>
      <tr className={selected ? 'bg-accent-soft/50' : 'hover:bg-subtle/60'}>
        <td className="td">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label="Select issue" className="w-4 h-4 mt-0.5" />
        </td>
        <td className="td"><SeverityBadge severity={issue.severity} /></td>
        <td className="td">
          <button onClick={onSelectIssue} className="text-left text-fg hover:text-accent hover:underline">
            {issue.message}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            {issue.rule && <span className="font-mono">{issue.rule}</span>}
            <span>{issue.scanner}</span>
            {issue.module && <span className="px-1.5 rounded bg-violet-soft text-violet font-mono">{issue.module}</span>}
          </div>
        </td>
        <td className="td max-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={onToggleSnippet}
              aria-expanded={!!expanded}
              aria-label={expanded ? 'Hide source' : 'Show source'}
              title={expanded ? 'Hide source' : 'Show source'}
              className="shrink-0 p-0.5 rounded text-fg-muted hover:text-fg hover:bg-subtle"
            >
              <Chevron className="w-4 h-4" />
            </button>
            <FileLink file={issue.file} line={issue.line} onClick={onToggleSnippet} />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={COLS} className="p-0 border-t border-line">
            {expanded.error ? (
              <p className="px-6 py-3 text-sm text-danger">{expanded.error}</p>
            ) : !expanded.data ? (
              <p className="px-6 py-3 text-sm text-fg-muted">Loading source…</p>
            ) : (
              <div>
                <CodeSnippet snippet={expanded.data} />
                <div className="px-4 py-2 border-t border-line flex justify-end gap-2">
                  <button onClick={onOpenFile} className="btn-ghost">View whole file</button>
                  <button onClick={onSelectIssue} className="btn-ghost">Issue details</button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
