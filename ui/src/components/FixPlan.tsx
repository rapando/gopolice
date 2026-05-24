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

function generatePlan(issues: Issue[], projectName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const bySeverity = (sev: string) => issues.filter((i) => i.severity === sev)

  const errors = bySeverity('error')
  const warnings = bySeverity('warning')
  const infos = bySeverity('info')

  let md = `# Fix Plan: ${projectName}

**Generated:** ${date}
**Total issues:** ${issues.length}
**Errors:** ${errors.length} | **Warnings:** ${warnings.length} | **Info:** ${infos.length}

`

  for (const issue of issues) {
    md += `## ${issue.rule || 'Issue'} — ${issue.severity.toUpperCase()}\n\n`
    md += `| Field | Value |\n|------|-------|\n`
    md += `| **File** | \`${escapeMD(issue.file)}\` |\n`
    md += `| **Line** | ${issue.line} |\n`
    if (issue.column > 0) md += `| **Column** | ${issue.column} |\n`
    md += `| **Severity** | ${issue.severity} |\n`
    md += `| **Category** | ${issue.category} |\n`
    md += `| **Scanner** | ${issue.scanner} |\n`
    if (issue.module) md += `| **Module** | ${issue.module} |\n`

    md += `\n**Message:** ${issue.message}\n\n`

    if (issue.solution) {
      md += `**Suggested fix:**\n\n\`\`\`\n${issue.solution}\n\`\`\`\n\n`
    }

    md += `---\n\n`
  }

  md += `---

## Instructions for AI Agent

Please fix all issues listed above. For each issue:
1. Locate the file at the specified path and line
2. Apply the suggested fix if provided, otherwise resolve the issue according to the message
3. Preserve existing code style and run \`go vet ./...\` after making changes
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
        html += '  <tr class="border-b border-gray-300 dark:border-ctp-surface1 bg-gray-100 dark:bg-ctp-mantle">' + cells.map((c) => `<th class="text-left px-3 py-2 text-xs font-semibold text-gray-600 dark:text-ctp-subtext1">${c}</th>`).join('') + '</tr>\n'
        i++ // skip separator
      } else {
        html += '  <tr class="border-b border-gray-200 dark:border-ctp-surface1">' + cells.map((c) => `<td class="px-3 py-2 text-sm text-gray-700 dark:text-ctp-subtext0">${c}</td>`).join('') + '</tr>\n'
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

    if (line.startsWith('## ')) {
      html += `<h2>${escapeHtml(line.slice(3))}</h2>\n`
      continue
    }

    if (line.startsWith('# ')) {
      html += `<h1>${escapeHtml(line.slice(2))}</h1>\n`
      continue
    }

    if (line.trim() === '') {
      html += '<br>\n'
      continue
    }

    let processed = escapeHtml(line)

    // inline code
    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>')

    // bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

    html += `<p>${processed}</p>\n`
  }

  if (inCodeBlock) html += '</code></pre>\n'
  if (inTable) html += '</table>\n'

  return html
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-ctp-base rounded-lg shadow-xl w-[90vw] h-[85vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-ctp-surface1">
          <h2 className="text-base font-semibold text-gray-800 dark:text-ctp-text">
            Export Fix Plan — {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview(!preview)}
              className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-ctp-surface1 text-gray-600 dark:text-ctp-subtext0 hover:bg-gray-100 dark:hover:bg-ctp-surface0 transition-colors"
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs font-medium rounded bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base hover:bg-green-700 transition-colors"
            >
              Download .md
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded text-gray-500 hover:text-gray-700 dark:text-ctp-overlay0 dark:hover:text-ctp-text transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div
            className={`${preview ? 'hidden' : 'flex'} flex-col w-1/2 border-r border-gray-200 dark:border-ctp-surface1`}
          >
            <div className="shrink-0 px-4 py-1.5 text-xs text-gray-500 dark:text-ctp-overlay1 bg-gray-50 dark:bg-ctp-mantle border-b border-gray-200 dark:border-ctp-surface1 font-medium">
              Markdown
            </div>
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="flex-1 w-full resize-none p-4 text-sm font-mono bg-white dark:bg-ctp-base text-gray-800 dark:text-ctp-text border-0 outline-none leading-relaxed"
            />
          </div>
          <div
            className={`${preview ? 'w-full' : 'w-1/2'} overflow-auto`}
          >
            <div className="shrink-0 px-4 py-1.5 text-xs text-gray-500 dark:text-ctp-overlay1 bg-gray-50 dark:bg-ctp-mantle border-b border-gray-200 dark:border-ctp-surface1 font-medium">
              Preview
            </div>
            <div
              className="p-4 text-sm text-gray-800 dark:text-ctp-text leading-relaxed prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
