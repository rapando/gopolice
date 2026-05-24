import { useState, useEffect, useRef, Fragment } from 'react'
import { getSnippet, batchFix, Issue, Snippet } from '../api/client'
import FixPlan from '../components/FixPlan'

interface Props {
  issues: Issue[]
  onSelectIssue: (id: string) => void
  onSelectFile: (file: string) => void
  projectName?: string
}

const severities = ['error', 'warning', 'info'] as const

const sevIcon: Record<string, string> = { error: '●', warning: '◆', info: '○' }
const sevColor: Record<string, string> = { error: 'text-red-500', warning: 'text-yellow-500', info: 'text-blue-500' }
const sevBadge: Record<string, string> = {
  error: 'bg-red-50 text-red-700',
  warning: 'bg-yellow-50 text-yellow-700',
  info: 'bg-blue-50 text-blue-700',
}

type GroupBy = '' | 'rule' | 'file' | 'category' | 'module'

function groupKey(issue: Issue, by: GroupBy): string {
  switch (by) {
    case 'rule': return issue.rule || 'unknown'
    case 'file': return issue.file || 'unknown'
    case 'category': return issue.category || 'unknown'
    case 'module': return issue.module || '(root)'
  }
  return ''
}

export default function Issues({ issues, onSelectIssue, onSelectFile, projectName }: Props) {
  const [selectedSeverity, setSelectedSeverity] = useState('')
  const [search, setSearch] = useState('')
  const [snippet, setSnippet] = useState<{ file: string; data: Snippet } | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchMsg, setBatchMsg] = useState('')
  const [applying, setApplying] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const snippetRef = useRef<HTMLDivElement>(null)

  const filtered = issues.filter((i) => {
    if (selectedSeverity && i.severity !== selectedSeverity) return false
    if (search && !i.message.toLowerCase().includes(search.toLowerCase()) && !i.file.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleFileClick = async (e: React.MouseEvent, file: string, line: number) => {
    e.stopPropagation()
    if (snippet?.file === file) {
      setSnippet(null)
      return
    }
    try {
      const data = await getSnippet(file, line)
      setSnippet({ file, data })
    } catch {
      onSelectFile(file)
    }
  }

  useEffect(() => {
    if (snippet && snippetRef.current) {
      snippetRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [snippet])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (ids: string[]) => {
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

  const selectAllVisible = () => {
    setSelected((prev) => {
      const allSelected = filtered.every((i) => prev.has(i.id))
      const next = new Set(prev)
      for (const i of filtered) {
        if (allSelected) next.delete(i.id)
        else next.add(i.id)
      }
      return next
    })
  }

  const handleBatchApply = async () => {
    if (selected.size === 0) return
    setApplying(true)
    setBatchMsg('')
    try {
      const res = await batchFix(Array.from(selected))
      const ok = res.results.filter((r) => r.applied).length
      const fail = res.results.filter((r) => !r.applied).length
      setBatchMsg(`Applied ${ok} fix${ok !== 1 ? 'es' : ''}${fail > 0 ? `, ${fail} failed` : ''}`)
      setSelected(new Set())
    } catch (err: any) {
      setBatchMsg(`Batch fix failed: ${err.message}`)
    }
    setApplying(false)
  }

  const groups = groupBy ? groupIssues(filtered, groupBy) : null

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">
        Issues <span className="font-normal text-gray-400 dark:text-ctp-overlay1">({issues.length})</span>
      </h2>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <div className="flex gap-1">
          {severities.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedSeverity(selectedSeverity === s ? '' : s)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                selectedSeverity === s
                  ? `${sevBadge[s]} border-current`
                  : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-ctp-surface1 dark:text-ctp-overlay0 dark:hover:bg-ctp-surface0'
              }`}
            >
              <span className={sevColor[s]}>{sevIcon[s]}</span>
              <span className="ml-1.5 capitalize">{s}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-gray-400 dark:text-ctp-overlay1 mr-1">Group:</span>
          {(['', 'rule', 'file', 'category', 'module'] as GroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => { setGroupBy(g); setSelected(new Set()) }}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                groupBy === g
                  ? 'bg-blue-100 text-blue-700 dark:bg-ctp-surface1 dark:text-ctp-lavender'
                  : 'text-gray-500 hover:text-gray-700 dark:text-ctp-overlay0 dark:hover:text-ctp-text'
              }`}
            >
              {g || 'None'}
            </button>
          ))}
          <button
            onClick={() => setShowExport(true)}
            className="ml-3 px-3 py-1 text-xs font-medium rounded bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base hover:bg-green-700 transition-colors"
          >
            Export Fixes
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-4 px-4 py-3 bg-blue-50 dark:bg-ctp-surface0 border border-blue-200 dark:border-ctp-surface1 rounded flex items-center justify-between">
          <span className="text-sm text-blue-700 dark:text-ctp-lavender">{selected.size} issue{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-ctp-overlay0 hover:text-gray-800 dark:hover:text-ctp-text transition-colors"
            >
              Clear
            </button>
            <button
              onClick={handleBatchApply}
              disabled={applying}
              className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {applying ? 'Applying...' : 'Apply Fix'}
            </button>
          </div>
        </div>
      )}

      {batchMsg && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${
          batchMsg.includes('failed')
            ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-ctp-red'
            : 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-ctp-green'
        }`}>
          {batchMsg}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0">No issues match the filters.</p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:bg-ctp-mantle">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((i) => selected.has(i.id))}
                      onChange={selectAllVisible}
                      className="rounded border-gray-300 dark:border-ctp-surface1"
                    />
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">Severity</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">Message</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">File</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-500 dark:text-ctp-overlay0 text-xs uppercase tracking-wide">Line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-ctp-surface1">
                {groups ? (
                  <GroupedRows
                    groups={groups}
                    selected={selected}
                    onToggleSelect={toggleSelect}
                    onToggleGroup={toggleGroup}
                    onSelectIssue={onSelectIssue}
                    onFileClick={handleFileClick}
                  />
                ) : (
                  filtered.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      selected={selected.has(issue.id)}
                      onToggleSelect={() => toggleSelect(issue.id)}
                      onSelectIssue={() => onSelectIssue(issue.id)}
                      onFileClick={(e) => handleFileClick(e, issue.file, issue.line)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {snippet && (
            <div ref={snippetRef} className="mt-4 card overflow-hidden">
              <div className="px-5 py-2.5 border-b border-gray-200 dark:border-ctp-surface1 bg-gray-50 dark:bg-ctp-mantle flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 dark:text-ctp-subtext0 font-mono">{snippet.file}</span>
                <button
                  onClick={() => setSnippet(null)}
                  className="text-xs text-gray-400 dark:text-ctp-overlay1 hover:text-gray-600 dark:hover:text-ctp-subtext0"
                >
                  Close
                </button>
              </div>
              <pre className="text-xs font-mono leading-relaxed overflow-x-auto p-0">
                {snippet.data.lines.map((l) => (
                  <div
                    key={l.number}
                    className={`flex ${l.is_issue ? 'bg-red-50 dark:bg-red-950/30 border-l-2 border-red-500' : ''}`}
                  >
                    <span className="text-gray-400 dark:text-ctp-overlay1 text-right w-12 shrink-0 select-none py-0.5 pr-3 border-r border-gray-200 dark:border-ctp-surface1 mr-3">
                      {l.number}
                    </span>
                    <span className={`py-0.5 ${l.is_issue ? 'text-red-800 dark:text-ctp-red font-medium' : 'text-gray-700 dark:text-ctp-subtext0'}`}>
                      {l.content || ' '}
                    </span>
                  </div>
                ))}
              </pre>
            </div>
          )}
        </>
      )}

      {showExport && (
        <FixPlan
          issues={issues}
          projectName={projectName || 'project'}
          onClose={() => setShowExport(false)}
        />
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
  return groups
}

interface IssueRowProps {
  issue: Issue
  selected: boolean
  onToggleSelect: () => void
  onSelectIssue: () => void
  onFileClick: (e: React.MouseEvent) => void
}

function IssueRow({ issue, selected, onToggleSelect, onSelectIssue, onFileClick }: IssueRowProps) {
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
      <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="rounded border-gray-300 dark:border-ctp-surface1"
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={`text-base ${sevColor[issue.severity]}`}>{sevIcon[issue.severity]}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${sevBadge[issue.severity]}`}>
            {issue.severity}
          </span>
          <span className="text-xs text-gray-400 dark:text-ctp-overlay1 font-mono">{issue.scanner}</span>
          {issue.module && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-ctp-mauve/20 dark:text-ctp-mauve font-mono">{issue.module}</span>}
        </div>
      </td>
      <td className="px-3 py-3 text-gray-700 dark:text-ctp-subtext0 max-w-lg truncate">
        <button onClick={onSelectIssue} className="hover:text-blue-600 dark:hover:text-ctp-blue text-left">
          {issue.message}
        </button>
      </td>
      <td className="px-3 py-3">
        <button
          onClick={onFileClick}
          className="text-blue-600 dark:text-ctp-blue hover:underline font-mono text-xs"
        >
          {issue.file}
        </button>
      </td>
      <td className="px-3 py-3 text-gray-400 dark:text-ctp-overlay1 font-mono text-xs text-right">
        <button onClick={onSelectIssue} className="hover:text-blue-600 dark:hover:text-ctp-blue">{issue.line}</button>
      </td>
    </tr>
  )
}

interface GroupedRowsProps {
  groups: Map<string, Issue[]>
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onToggleGroup: (ids: string[]) => void
  onSelectIssue: (id: string) => void
  onFileClick: (e: React.MouseEvent, file: string, line: number) => void
}

function GroupedRows({ groups, selected, onToggleSelect, onToggleGroup, onSelectIssue, onFileClick }: GroupedRowsProps) {
  return (
    <>
      {Array.from(groups.entries()).map(([key, groupIssues]) => {
        const allSelected = groupIssues.every((i) => selected.has(i.id))
        return (
          <Fragment key={key}>
            <tr className="bg-gray-100 dark:bg-ctp-mantle">
              <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleGroup(groupIssues.map((i) => i.id))}
                  className="rounded border-gray-300 dark:border-ctp-surface1"
                />
              </td>
              <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">
                {key}
                <span className="font-normal text-gray-400 dark:text-ctp-overlay1 ml-2">({groupIssues.length})</span>
              </td>
            </tr>
            {groupIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={selected.has(issue.id)}
                onToggleSelect={() => onToggleSelect(issue.id)}
                onSelectIssue={() => onSelectIssue(issue.id)}
                onFileClick={(e) => onFileClick(e, issue.file, issue.line)}
              />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

