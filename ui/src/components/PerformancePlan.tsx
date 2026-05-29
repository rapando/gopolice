import { useState, useMemo } from 'react'
import { BenchmarkResult, ProfileData } from '../api/client'

interface Props {
  benchmarks: BenchmarkResult[] | null
  profile: ProfileData | null
  projectName: string
  onClose: () => void
}

function fmtDuration(ns: number): string {
  if (ns >= 1_000_000_000) return (ns / 1_000_000_000).toFixed(3) + ' s'
  if (ns >= 1_000_000) return (ns / 1_000_000).toFixed(3) + ' ms'
  if (ns >= 1_000) return (ns / 1_000).toFixed(2) + ' µs'
  return ns.toFixed(0) + ' ns'
}

function fmtBytes(b: number): string {
  if (b === 0) return '0 B'
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(2) + ' MB'
  if (b >= 1_024) return (b / 1_024).toFixed(1) + ' KB'
  return b.toFixed(0) + ' B'
}

function escapeMD(text: string): string {
  return text.replace(/\|/g, '\\|')
}

interface BenchmarkAdvice {
  name: string
  issue: string
  impact: 'high' | 'medium' | 'low'
  suggestion: string
}

function generatePlan(benchmarks: BenchmarkResult[] | null, profile: ProfileData | null, projectName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const md = `# Performance Improvement Plan: ${projectName}

**Generated:** ${date}
`

  if (!benchmarks || benchmarks.length === 0) {
    return md + '\nNo benchmark data available. Run `gopolice scan` to collect performance metrics.'
  }

  const avgTime = benchmarks.reduce((s, b) => s + b.time_per_op, 0) / benchmarks.length
  const avgAllocs = benchmarks.reduce((s, b) => s + b.allocs_per_op, 0) / benchmarks.length
  const avgBytes = benchmarks.reduce((s, b) => s + b.bytes_per_op, 0) / benchmarks.length
  const sortedTime = [...benchmarks].sort((a, b) => b.time_per_op - a.time_per_op)
  const sortedAllocs = [...benchmarks].sort((a, b) => b.allocs_per_op - a.allocs_per_op)

  let totalMD = md

  totalMD += `
## Summary

| Metric | Value |
|--------|-------|
| **Benchmarks** | ${benchmarks.length} |
| **Avg Time/Op** | ${fmtDuration(avgTime)} |
| **Avg Allocs/Op** | ${avgAllocs.toFixed(1)} |
| **Avg Bytes/Op** | ${fmtBytes(avgBytes)} |
| **Slowest** | ${sortedTime[0].name} (${fmtDuration(sortedTime[0].time_per_op)}) |
| **Fastest** | ${sortedTime[sortedTime.length - 1].name} (${fmtDuration(sortedTime[sortedTime.length - 1].time_per_op)}) |
| **Most Allocs** | ${sortedAllocs[0].name} (${sortedAllocs[0].allocs_per_op}/op) |

`

  totalMD += `## Benchmark Results

| Benchmark | Time/Op | Allocs/Op | Bytes/Op | Iterations |
|-----------|---------|-----------|----------|------------|
`
  for (const b of sortedTime) {
    totalMD += `| \`${escapeMD(b.name)}\` | ${fmtDuration(b.time_per_op)} | ${b.allocs_per_op} | ${fmtBytes(b.bytes_per_op)} | ${b.iterations.toLocaleString()} |\n`
  }

  totalMD += `
### Explanation

Each benchmark function measures a specific code path in **${projectName}**. The **Time/Op** column shows how long one operation takes — lower is better. **Allocs/Op** counts heap allocations per operation; each allocation adds GC pressure. **Bytes/Op** is the total memory allocated per operation.

${sortedTime[0].time_per_op > avgTime * 2 ? `**${sortedTime[0].name}** is the slowest benchmark at ${fmtDuration(sortedTime[0].time_per_op)} — more than 2× the average. This is the primary candidate for optimization.` : `The variance between benchmarks is within a reasonable range.`}
${sortedAllocs[0].allocs_per_op > 10 ? `**${sortedAllocs[0].name}** has the highest allocation count (${sortedAllocs[0].allocs_per_op}/op). Each allocation adds overhead for the garbage collector.` : ''}

### Room for Improvement

| Area | Current State | Target | How to Improve |
|------|--------------|--------|----------------|
`
  const improvementRows: string[] = []

  if (sortedTime[0].time_per_op > avgTime * 2) {
    improvementRows.push(`| Execution speed | ${fmtDuration(sortedTime[0].time_per_op)} (slowest) | < ${fmtDuration(avgTime)} (avg) | Profile with \`go tool pprof\`, identify hot loops, consider caching or algorithmic changes |`)
  }

  const highAllocBenchmarks = benchmarks.filter((b) => b.allocs_per_op > 10)
  if (highAllocBenchmarks.length > 0) {
    const worstAlloc = highAllocBenchmarks.reduce((a, b) => (a.allocs_per_op > b.allocs_per_op ? a : b))
    improvementRows.push(`| Allocation count | ${worstAlloc.allocs_per_op}/op (worst) | < 10/op | Reuse buffers, use \`sync.Pool\`, pre-allocate slices with \`make\` |`)
  }

  const inefficient = benchmarks.filter((b) => b.allocs_per_op > 0 && b.bytes_per_op / b.allocs_per_op < 16)
  if (inefficient.length > 0) {
    improvementRows.push(`| Allocation efficiency | ${inefficient.length} benchmarks with < 16 B/alloc | > 32 B/alloc | Consolidate small struct fields, embed instead of pointer, use arrays of structs |`)
  }

  const zeroAlloc = benchmarks.filter((b) => b.allocs_per_op === 0 && b.bytes_per_op === 0)
  if (zeroAlloc.length > 0) {
    improvementRows.push(`| Zero-alloc paths | ${zeroAlloc.length}/${benchmarks.length} benchmarks | ↑ more | Already allocation-free — ensure this pattern is replicated in similar code paths |`)
  }

  if (improvementRows.length > 0) {
    totalMD += improvementRows.join('\n') + '\n'
  } else {
    totalMD += `| — | No significant issues detected | — | Continue monitoring with \`gopolice scan\` |\n`
  }
  totalMD += '\n'

  const advice: BenchmarkAdvice[] = []

  for (const b of benchmarks) {
    if (b.allocs_per_op > 10) {
      advice.push({
        name: b.name,
        issue: `High allocation count (${b.allocs_per_op}/op)`,
        impact: 'high',
        suggestion: `Reduce allocations in ${b.name} by reusing buffers, using object pools, or restructuring hot paths to avoid per-operation heap allocations.`,
      })
    }

    const efficiency = b.bytes_per_op / Math.max(b.allocs_per_op, 1)
    if (b.allocs_per_op > 0 && efficiency < 16) {
      advice.push({
        name: b.name,
        issue: `Inefficient allocation pattern (${efficiency.toFixed(0)} B/alloc)`,
        impact: 'medium',
        suggestion: `Consolidate small allocations in ${b.name}. Each allocation incurs overhead — prefer larger structs or slices over many small objects.`,
      })
    }

    if (b.time_per_op > avgTime * 2) {
      advice.push({
        name: b.name,
        issue: `Slow execution (${fmtDuration(b.time_per_op)})`,
        impact: 'high',
        suggestion: `Profile ${b.name} to identify bottlenecks. Consider algorithmic improvements, caching, or inlining hot functions.`,
      })
    }
  }

  if (profile && ((profile.cpu && profile.cpu.length > 0) || (profile.mem && profile.mem.length > 0))) {
    totalMD += `## Profiling Results

`
    if (profile.cpu && profile.cpu.length > 0) {
      totalMD += `### CPU Profile — Top Functions

| Function | Flat | Flat% | Cum | Cum% |
|----------|------|-------|-----|------|
`
      for (const e of profile.cpu.slice(0, 20)) {
        totalMD += `| \`${escapeMD(e.function)}\` | ${e.flat.toFixed(2)} | ${e.flat_pct.toFixed(1)}% | ${e.cum.toFixed(2)} | ${e.cum_pct.toFixed(1)}% |\n`
      }
      totalMD += '\n'

      const topCPU = profile.cpu[0]
      if (topCPU.flat_pct > 15) {
        totalMD += `**Note:** \`${topCPU.function}\` accounts for ${topCPU.flat_pct.toFixed(1)}% of CPU time. Focus optimization efforts here — consider inlining, reducing allocations in this function, or improving the algorithm.\n\n`
      }
    }

    if (profile.mem && profile.mem.length > 0) {
      totalMD += `### Memory Profile — Top Allocations

| Function | Flat | Flat% | Cum | Cum% |
|----------|------|-------|-----|------|
`
      for (const e of profile.mem.slice(0, 20)) {
        totalMD += `| \`${escapeMD(e.function)}\` | ${e.flat.toFixed(2)} | ${e.flat_pct.toFixed(1)}% | ${e.cum.toFixed(2)} | ${e.cum_pct.toFixed(1)}% |\n`
      }
      totalMD += '\n'

      const topMem = profile.mem[0]
      if (topMem.flat_pct > 15) {
        totalMD += `**Note:** \`${topMem.function}\` allocates ${topMem.flat_pct.toFixed(1)}% of all heap memory. Review for unnecessary allocations — move allocations outside loops, reuse buffers, or use \`sync.Pool\`.\n\n`
      }
    }

    const hotFunctions = new Map<string, number>()
    for (const entry of [...(profile.cpu || []), ...(profile.mem || [])]) {
      if (entry.flat_pct > 10) {
        hotFunctions.set(entry.function, (hotFunctions.get(entry.function) || 0) + entry.flat_pct)
      }
    }
    if (hotFunctions.size > 0) {
      totalMD += `### Hot Functions Summary

`
      const sortedHot = Array.from(hotFunctions.entries()).sort((a, b) => b[1] - a[1])
      for (const [fn, pct] of sortedHot.slice(0, 10)) {
        totalMD += `- **\`${fn}\`** — appears in both CPU and memory profiles with ${pct.toFixed(1)}% combined impact — review for inlining, algorithmic changes, or reducing allocations\n`
      }
      totalMD += '\n'
    }
  }

  if (advice.length > 0) {
    advice.sort((a, b) => (a.impact === 'high' ? -1 : a.impact === 'medium' ? 0 : 1) - (b.impact === 'high' ? -1 : b.impact === 'medium' ? 0 : 1))

    totalMD += `## Optimization Opportunities (${advice.length})

| Priority | Benchmark | Issue | Recommendation |
|----------|-----------|-------|----------------|
`
    for (const a of advice) {
      totalMD += `| **${a.impact === 'high' ? '🔴 HIGH' : a.impact === 'medium' ? '🟡 MED' : '🟢 LOW'}** | \`${escapeMD(a.name)}\` | ${escapeMD(a.issue)} | ${escapeMD(a.suggestion)} |\n`
    }
    totalMD += '\n'
  }

  const withAllocs = benchmarks.filter((b) => b.allocs_per_op > 0).length
  if (withAllocs > 0) {
    totalMD += `## Allocation Efficiency

`
    for (const b of benchmarks) {
      if (b.allocs_per_op === 0) continue
      const eff = b.bytes_per_op / b.allocs_per_op
      const grade = eff >= 64 ? 'Excellent' : eff >= 32 ? 'Good' : eff >= 16 ? 'Fair' : eff >= 8 ? 'Poor' : 'Bad'
      totalMD += `- **${b.name}**: ${b.allocs_per_op} allocs/op, ${fmtBytes(b.bytes_per_op)}/op (${eff.toFixed(0)} B/alloc) — **${grade}**\n`
    }
    totalMD += '\n'
  }

  totalMD += `## Recommended Actions

### Immediate (high impact)
1. Address all ${advice.filter((a) => a.impact === 'high').length} high-priority items listed above
2. Profile the slowest benchmark: \`go test -bench=^${escapeMD(sortedTime[0].name)}$ -benchmem -cpuprofile=cpu.pprof -memprofile=mem.pprof .\`
3. Analyze with: \`go tool pprof -http=:8080 cpu.pprof\`

### Short-term (medium impact)
4. Fix inefficient allocation patterns
5. Reuse buffers in hot paths
6. Consider \`sync.Pool\` for frequently allocated objects

### Long-term (low impact)
7. Set up benchmark regression tracking with \`gopolice scan\`
8. Add CI benchmark gates to prevent performance regressions

---

## Instructions for AI Agent

Please implement the high-priority optimizations first:
1. For each benchmark function, locate the corresponding source code
2. Apply the specific recommendation listed above
3. Verify improvements by running: \`go test -bench=. -benchmem -count=1 ./...\`
4. Run \`go vet ./...\` after making changes
`
  return totalMD
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
          content = content.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
          content = content.replace(/`([^`]+)`/g, '<code>$1</code>')
          return content
        })
      if (isHeader) {
        html += '  <tr class="border-b border-gray-300 dark:border-ctp-surface1 bg-gray-100 dark:bg-ctp-mantle">' + cells.map((c) => `<th class="text-left px-3 py-2 text-xs font-semibold text-gray-600 dark:text-ctp-subtext1">${c}</th>`).join('') + '</tr>\n'
        i++
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

    if (line.startsWith('### ')) {
      html += `<h3>${escapeHtml(line.slice(4))}</h3>\n`
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

    if (line.startsWith('- ')) {
      html += `<li>${escapeHtml(line.slice(2))}</li>\n`
      continue
    }

    let processed = escapeHtml(line)
    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>')
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

export default function PerformancePlan({ benchmarks, profile, projectName, onClose }: Props) {
  const initialMD = useMemo(() => generatePlan(benchmarks, profile, projectName), [benchmarks, profile, projectName])
  const [markdown, setMarkdown] = useState(initialMD)
  const [preview, setPreview] = useState(true)

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `perf-plan-${projectName.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-ctp-base rounded-lg shadow-xl w-[90vw] h-[85vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-ctp-surface1">
          <h2 className="text-base font-semibold text-gray-800 dark:text-ctp-text">
            Performance Improvement Plan
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
              className="px-3 py-1.5 text-xs font-medium rounded text-gray-500 hover:text-gray-700 dark:text-ctp-subtext0 dark:hover:text-ctp-text transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div
            className={`${preview ? 'hidden' : 'flex'} flex-col w-1/2 border-r border-gray-200 dark:border-ctp-surface1`}
          >
            <div className="shrink-0 px-4 py-1.5 text-xs text-gray-500 dark:text-ctp-subtext1 bg-gray-50 dark:bg-ctp-mantle border-b border-gray-200 dark:border-ctp-surface1 font-medium">
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
            <div className="shrink-0 px-4 py-1.5 text-xs text-gray-500 dark:text-ctp-subtext1 bg-gray-50 dark:bg-ctp-mantle border-b border-gray-200 dark:border-ctp-surface1 font-medium">
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
