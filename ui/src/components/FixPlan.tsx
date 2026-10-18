import { useState, useMemo } from 'react'
import { Issue } from '../api/client'

interface Props {
  issues: Issue[]
  projectName: string
  onClose: () => void
}

function escapeMD(text: string): string {
  return text.replace(/\|/g, '\\|')
}

const SAFE_FIX_EXAMPLES = [
  'formatting, imports, naming, comments and doc strings',
  'handling a returned error the same way the surrounding code already does (return it, or log it) without altering the success path',
  'removing code that nothing references, once you have confirmed nothing references it (including reflection, build tags and generated code)',
  'replacing a deprecated call with its documented drop-in equivalent',
  'adding a bounds or nil check that only turns a guaranteed panic into the error the caller already handles',
  'splitting a long function into helpers that together do exactly what it did before',
  'tightening file permissions or closing resources where the result is the same for every caller',
]

const CONFIRM_FIRST_EXAMPLES = [
  'changing a function or method signature, return values, or an exported API',
  'changing what happens on an error: swallowing one that was returned, returning one that was ignored, or changing the message callers may match on',
  'replacing an algorithm, data structure, or library',
  'changing concurrency: adding or removing goroutines, locks, channels, or timeouts',
  'changing defaults, configuration, validation rules, or input/output formats',
  'moving or renaming packages, files, or exported identifiers',
  'deleting or weakening a test, a feature, or a security check',
  'anything a user of the program could notice, even if it looks like an improvement',
]

function issueHeading(issue: Issue): string {
  const where = issue.line > 0 ? `Line ${issue.line}${issue.column > 0 ? `:${issue.column}` : ''}` : 'No line'
  return `${where} · ${issue.rule || 'issue'} · ${issue.severity}`
}

function generatePlan(issues: Issue[], projectName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const bySeverity = (sev: string) => issues.filter((i) => i.severity === sev)
  const errors = bySeverity('error')
  const warnings = bySeverity('warning')
  const infos = bySeverity('info')

  // Group by file so the agent reads each file once; issues with no file
  // (module-level vulnerabilities, test failures) go last.
  const byFile = new Map<string, Issue[]>()
  for (const issue of issues) {
    const key = issue.file || ''
    const list = byFile.get(key) ?? []
    list.push(issue)
    byFile.set(key, list)
  }
  const files = Array.from(byFile.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  for (const list of byFile.values()) list.sort((a, b) => a.line - b.line)

  let md = `# Fix Plan: ${projectName}

**Prepared for:** Claude Opus · **Generated:** ${date} by gopolice
**Issues:** ${issues.length} (${errors.length} errors, ${warnings.length} warnings, ${infos.length} info) across ${files.length} file${files.length === 1 ? '' : 's'}

## Your role

You are Claude Opus, working as a careful maintainer of \`${projectName}\`, a Go project. gopolice scanned it and found the issues listed under *Issues by file*. Resolve them without changing what the program does.

Work in the repository root. Read this whole document before editing anything.

## Ground rules

1. **Do not change the logic, behaviour, or design of the project.** Every fix must leave observable behaviour identical: the same inputs produce the same outputs, side effects, and errors. The scan found code-quality, security, and hygiene problems; it did not ask for features, redesigns, or refactors beyond what each issue needs.
   Safe, behaviour-preserving fixes include:
${SAFE_FIX_EXAMPLES.map((e) => `   - ${e}`).join('\n')}

2. **If a fix would change functionality or design, stop and ask the user before starting it.** Do not begin that work until the user explicitly confirms. Present, for each such issue: the issue, why it cannot be fixed without changing behaviour, the smallest change you propose, and who or what would notice. Carry on with the other issues while you wait. Changes that always need confirmation:
${CONFIRM_FIRST_EXAMPLES.map((e) => `   - ${e}`).join('\n')}

3. **Do not hide issues.** No \`//nolint\` comments, \`_ = \` discards used only to silence a check, linter config changes, or deleted checks, unless the user asked for that specifically.

4. **Do not change tests to make them pass.** A failing test is a report about the code. If the test itself is wrong, that is a design question: ask.

5. **Keep changes minimal and local.** Match the surrounding style. Add no dependencies, no new files unless a fix cannot be expressed otherwise, and no unrelated clean-ups you happen to notice (mention them in your report instead).

6. **Do not commit, push, or open pull requests** unless the user asks.

## How to work

1. **Triage first.** Read every issue below and sort each one into: **A** safe to fix now, **B** needs confirmation (rule 2), **C** false positive or not worth fixing, with a one-line reason. Show the triage as a table before you edit anything, and ask all of your **B** questions in that same message, in one batch.
2. **Fix the A issues file by file**, in the order listed. Before editing, re-read the code around each line; the line numbers were correct at scan time and may have drifted. If the code at the location no longer matches the issue, say so rather than guessing.
3. **Verify with a real check, not a syntax check.** After each file run \`gofmt -l\` on it. After all edits run \`go build ./...\`, \`go vet ./...\` and \`go test ./...\`, and include their output. If a command cannot run here, say which one and why instead of reporting the fix as done.
4. **Report.** Finish with a table: issue → *fixed* / *awaiting confirmation* / *skipped* (with the reason), the commands you ran and what they printed, and an explicit statement that no behaviour changed, or exactly what did change if the user confirmed a B item.

## Issues by file

`

  for (const file of files) {
    const list = byFile.get(file) ?? []
    md += file ? `### \`${escapeMD(file)}\` (${list.length})\n\n` : `### No file location (${list.length})\n\n`
    for (const issue of list) {
      md += `#### ${issueHeading(issue)}\n\n`
      md += `- **Message:** ${issue.message}\n`
      md += `- **Found by:** ${issue.scanner} · category ${issue.category}${issue.module ? ` · module ${issue.module}` : ''}\n`
      if (!issue.file) md += `- **Location:** not tied to one file; find where this applies before changing anything\n`
      if (issue.solution) {
        md += `- **Suggested fix:**\n\n\`\`\`\n${issue.solution}\n\`\`\`\n`
      }
      md += `\n`
    }
  }

  md += `---

*Suggested fixes come from the scanner's rule database. Treat them as hints, not instructions: if following one would break rule 1 or 2, it belongs in your B list.*
`

  return md
}

function renderMarkdown(md: string): string {
  let html = ''
  const lines = md.split('\n')
  let inCodeBlock = false
  let inTable = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      html += inCodeBlock ? '<pre><code>' : '</code></pre>\n'
      continue
    }

    if (inCodeBlock) {
      html += escapeHtml(line) + '\n'
      continue
    }

    if (line.startsWith('| ')) {
      if (!inTable) {
        html += '<table class="w-full text-sm border-collapse mb-4">\n'
        inTable = true
      }
      const isHeader = i + 1 < lines.length && lines[i + 1].startsWith('|---')
      const cells = line
        .split('|')
        .filter((c) => c.trim() !== '')
        .map((c) => {
          const trimmed = c.trim()
          let content = escapeHtml(trimmed)
          // bold
          content = content.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          // inline code
          content = content.replace(/`([^`]+)`/g, '<code>$1</code>')
          return content
        })
      if (isHeader) {
        html += '<tr class="border-b border-line-strong bg-subtle ">' + cells.map((c) => `<th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted ">${c}</th>`).join('') + '</tr>\n'
        i++ // skip separator
      } else {
        html += '  <tr class="border-b border-line ">' + cells.map((c) => `<td class="px-3 py-2 text-sm text-fg ">${c}</td>`).join('') + '</tr>\n'
      }
      continue
    }

    if (inTable && line.trim() === '') {
      html += '</table>\n'
      inTable = false
      continue
    }

    if (line.startsWith('---')) {
      html += '<hr>\n'
      continue
    }

    if (line.startsWith('#### ')) {
      html += `<h4 class="text-sm font-medium mt-3 text-fg-muted">${inline(line.slice(5))}</h4>\n`
      continue
    }

    if (line.startsWith('### ')) {
      html += `<h3 class="text-sm font-semibold mt-4 mb-1 font-mono">${inline(line.slice(4))}</h3>\n`
      continue
    }

    if (line.startsWith('## ')) {
      html += `<h2 class="text-base font-semibold mt-5 mb-1">${escapeHtml(line.slice(3))}</h2>\n`
      continue
    }

    const list = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line)
    if (list) {
      const indent = list[1].length >= 3 ? ' style="margin-left:1.5rem"' : ''
      html += `<li class="ml-5 list-disc"${indent}>${inline(list[2])}</li>\n`
      continue
    }

    if (line.startsWith('# ')) {
      html += `<h1 class="text-lg font-semibold mt-2 mb-1">${escapeHtml(line.slice(2))}</h1>\n`
      continue
    }

    if (line.trim() === '') {
      html += '<br>\n'
      continue
    }

    html += `<p>${inline(line)}</p>\n`
  }

  if (inCodeBlock) html += '</code></pre>\n'
  if (inTable) html += '</table>\n'

  return html
}

/** Escapes a line of markdown and renders its inline code, bold and italics. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\s)\*([^*]+)\*(?=[\s.,:;)]|$)/g, '$1<i>$2</i>')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default function FixPlan({ issues, projectName, onClose }: Props) {
  const initialMD = useMemo(() => generatePlan(issues, projectName), [issues, projectName])
  const [markdown, setMarkdown] = useState(initialMD)
  const [preview, setPreview] = useState(true)

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fix-plan-${projectName.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
      <div className="bg-surface border border-line rounded-lg shadow-xl w-[90vw] max-w-6xl h-[85vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-line">
          <h2 className="text-base font-semibold text-fg">
            Export Fix Plan — {issues.length} issue{issues.length !== 1 ? 's' : ''}
            <span className="ml-2 text-xs font-normal text-fg-muted">written for Claude Opus · fixes must not change behaviour</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview(!preview)}
              className="btn-secondary"
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={handleDownload}
              className="btn-primary"
            >
              Download .md
            </button>
            <button
              onClick={onClose}
              className="btn-ghost"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div
            className={`${preview ? 'hidden' : 'flex'} flex-col w-1/2 border-r border-line `}
          >
            <div className="shrink-0 px-4 py-1.5 text-xs text-fg-muted bg-subtle border-b border-line font-medium">
              Markdown
            </div>
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="flex-1 w-full resize-none p-4 text-sm font-mono bg-surface text-fg border-0 outline-none leading-relaxed"
            />
          </div>
          <div
            className={`${preview ? 'w-full' : 'w-1/2'} overflow-auto`}
          >
            <div className="shrink-0 px-4 py-1.5 text-xs text-fg-muted bg-subtle border-b border-line font-medium">
              Preview
            </div>
            <div
              className="p-4 text-sm text-fg leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
