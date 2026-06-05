import { useMemo, useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { BenchmarkResult, ProfileData, ProfileEntry } from '../api/client'
import PerformancePlan from '../components/PerformancePlan'

interface Props {
  benchmarks: BenchmarkResult[] | null
  profile: ProfileData | null
  onScan?: () => void
  scanning?: boolean
  projectName?: string
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

function fmtShortNS(ns: number): string {
  if (ns >= 1_000_000_000) return (ns / 1_000_000_000).toFixed(2) + 's'
  if (ns >= 1_000_000) return (ns / 1_000_000).toFixed(2) + 'ms'
  if (ns >= 1_000) return (ns / 1_000).toFixed(1) + 'µs'
  return ns.toFixed(0) + 'ns'
}

function allocEfficiency(allocs: number, bytes: number): { score: number; label: string; color: string } {
  if (allocs === 0) return { score: 100, label: 'Perfect', color: 'text-green-600 dark:text-ctp-green' }
  const ratio = bytes / allocs
  if (ratio >= 64) return { score: 95, label: 'Excellent', color: 'text-green-600 dark:text-ctp-green' }
  if (ratio >= 32) return { score: 80, label: 'Good', color: 'text-emerald-600 dark:text-ctp-teal' }
  if (ratio >= 16) return { score: 60, label: 'Fair', color: 'text-yellow-600 dark:text-ctp-yellow' }
  if (ratio >= 8) return { score: 40, label: 'Poor', color: 'text-orange-600 dark:text-ctp-peach' }
  return { score: 20, label: 'Bad', color: 'text-red-600 dark:text-ctp-red' }
}

interface Suggestion {
  type: 'warning' | 'info' | 'tip'
  title: string
  description: string
  benchmark?: string
}

function generateSuggestions(benchmarks: BenchmarkResult[], profile: ProfileData | null): Suggestion[] {
  const suggestions: Suggestion[] = []

  const allocMarkers = benchmarks.filter((b) => b.allocs_per_op > 0)
  if (allocMarkers.length > 0) {
    const worst = allocMarkers.reduce((a, b) => (a.allocs_per_op > b.allocs_per_op ? a : b))
    suggestions.push({
      type: 'warning',
      title: 'High allocation count detected',
      description: `${worst.name} performs ${worst.allocs_per_op} allocations per operation. Consider reusing buffers or using object pools to reduce GC pressure.`,
      benchmark: worst.name,
    })

    const inefficient = allocMarkers
      .map((b) => ({ b, eff: allocEfficiency(b.allocs_per_op, b.bytes_per_op) }))
      .filter((x) => x.eff.score < 50)
    if (inefficient.length > 0) {
      suggestions.push({
        type: 'warning',
        title: 'Inefficient allocation pattern',
        description: `${inefficient[0].b.name} allocates only ${fmtBytes(inefficient[0].b.bytes_per_op)} across ${inefficient[0].b.allocs_per_op} allocations (${(inefficient[0].b.bytes_per_op / inefficient[0].b.allocs_per_op).toFixed(0)} B/alloc). Many small allocations fragment the heap.`,
        benchmark: inefficient[0].b.name,
      })
    }
  }

  if (benchmarks.length >= 3) {
    const sorted = [...benchmarks].sort((a, b) => a.time_per_op - b.time_per_op)
    const slowest = sorted[sorted.length - 1]
    const fastest = sorted[0]
    const ratio = fastest.time_per_op > 0 ? slowest.time_per_op / fastest.time_per_op : 1
    if (ratio > 5 && slowest.allocs_per_op > 0) {
      suggestions.push({
        type: 'info',
        title: 'Wide performance variance',
        description: `${slowest.name} is ${ratio.toFixed(1)}× slower than ${fastest.name}. Check if both benchmarks have comparable workloads or if the slower one can be optimized.`,
        benchmark: slowest.name,
      })
    }
  }

  if (profile) {
    const allEntries = [...(profile.cpu || []), ...(profile.mem || [])]
    const highFlat = allEntries.filter((e) => e.flat_pct > 20)
    for (const e of highFlat) {
      suggestions.push({
        type: 'tip',
        title: 'Hot function in profile',
        description: `${e.function} accounts for ${e.flat_pct.toFixed(1)}% of ${e.cum_pct > e.flat_pct ? 'self+children' : 'self'} time. Review for inlining or algorithmic improvements.`,
      })
      if (suggestions.length >= 6) break
    }
  }

  return suggestions
}

function extractPkg(fn: string): string {
  const parts = fn.split('/')
  if (parts.length >= 3) return parts[parts.length - 2]
  const dot = fn.lastIndexOf('.')
  if (dot > 0) {
    const pkg = fn.slice(0, dot)
    const lastSlash = pkg.lastIndexOf('/')
    return lastSlash >= 0 ? pkg.slice(lastSlash + 1) : pkg
  }
  return '(global)'
}

function extractFnShort(fn: string): string {
  const dot = fn.lastIndexOf('.')
  return dot > 0 ? fn.slice(dot + 1) : fn
}

const profileColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899', '#14b8a6', '#84cc16']

function BenchmarkRanking({ benchmarks }: { benchmarks: BenchmarkResult[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: BenchmarkResult | null }>({ x: 0, y: 0, data: null })

  const sorted = useMemo(() => [...benchmarks].sort((a, b) => b.time_per_op - a.time_per_op), [benchmarks])
  const maxTime = useMemo(() => Math.max(...benchmarks.map((b) => b.time_per_op), 1), [benchmarks])
  const maxAllocs = useMemo(() => Math.max(...benchmarks.map((b) => b.allocs_per_op), 1), [benchmarks])

  useEffect(() => {
    if (!sorted.length || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const rowH = 28
    const height = sorted.length * rowH + 40
    const pad = { top: 10, right: 120, bottom: 20, left: 0 }
    const innerW = width - pad.left - pad.right

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const xScale = d3.scaleLinear().domain([0, maxTime * 1.15]).range([0, innerW])
    const colorScale = d3.scaleSequentialLog()
      .domain([Math.max(maxAllocs, 1), 0])
      .interpolator(d3.interpolateRgbBasis(['#22c55e', '#eab308', '#ef4444']))

    const g = svg.append('g').attr('transform', `translate(${pad.left},${pad.top})`)

    sorted.forEach((b, i) => {
      const y = i * rowH
      const w = Math.max(xScale(b.time_per_op), 2)
      const color = b.allocs_per_op > 0 ? colorScale(b.allocs_per_op) : '#22c55e'

      g.append('rect')
        .attr('x', 0).attr('y', y).attr('width', w).attr('height', rowH - 4)
        .attr('rx', 3).attr('fill', color).attr('opacity', 0.8)
        .style('cursor', 'pointer')
        .on('mouseover', function (event: MouseEvent) {
          d3.select(this).attr('opacity', 1)
          const rect = svgRef.current!.getBoundingClientRect()
          setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, data: b })
        })
        .on('mousemove', function (event: MouseEvent) {
          const rect = svgRef.current!.getBoundingClientRect()
          setTooltip((prev) => ({ ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top - 10 }))
        })
        .on('mouseout', function () {
          d3.select(this).attr('opacity', 0.8)
          setTooltip({ x: 0, y: 0, data: null })
        })

      g.append('text').attr('x', w + 6).attr('y', y + rowH / 2 + 1)
        .attr('font-size', '11px').attr('fill', '#374151').attr('class', 'dark:fill-ctp-subtext1')
        .attr('dominant-baseline', 'middle')
        .text(`${fmtShortNS(b.time_per_op)} · ${b.allocs_per_op} allocs`)

      g.append('text').attr('x', -4).attr('y', y + rowH / 2 + 1)
        .attr('font-size', '11px').attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-subtext0')
        .attr('dominant-baseline', 'middle').attr('text-anchor', 'end')
        .style('white-space', 'nowrap')
        .text(extractShortName(b.name))
    })

    g.append('text').attr('x', 0).attr('y', height - pad.bottom + 6)
      .attr('font-size', '10px').attr('fill', '#9ca3af').attr('class', 'dark:fill-ctp-overlay1')
      .text('← faster')
    g.append('text').attr('x', innerW).attr('y', height - pad.bottom + 6)
      .attr('font-size', '10px').attr('fill', '#9ca3af').attr('class', 'dark:fill-ctp-overlay1')
      .attr('text-anchor', 'end').text('slower →')
  }, [sorted, maxTime, maxAllocs])

  return (
    <div className="relative bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg overflow-hidden mb-6">
      <svg ref={svgRef} className="w-full" style={{ minHeight: 200 }} />
      {tooltip.data && (
        <div className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-black text-white text-xs rounded-lg shadow-xl px-3 py-2 leading-relaxed max-w-xs"
          style={{ left: Math.min(tooltip.x, window.innerWidth - 260), top: Math.max(tooltip.y, 10) }}
        >
          <div className="font-semibold text-sm mb-1 break-all">{tooltip.data.name}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-300">
            <span>Time/Op</span><span className="text-right font-mono text-green-400">{fmtDuration(tooltip.data.time_per_op)}</span>
            <span>Iterations</span><span className="text-right font-mono">{tooltip.data.iterations.toLocaleString()}</span>
            <span>Allocs/Op</span><span className="text-right font-mono">{tooltip.data.allocs_per_op}</span>
            <span>Bytes/Op</span><span className="text-right font-mono">{fmtBytes(tooltip.data.bytes_per_op)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

interface DonutDatum { label: string; pct: number; fn: string }

function AllocationDonut({ entries }: { entries: ProfileEntry[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string }>({ x: 0, y: 0, text: '' })

  useEffect(() => {
    if (!entries.length || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const sorted = [...entries].sort((a, b) => b.flat_pct - a.flat_pct)
    const top = sorted.slice(0, 8)
    const other = sorted.slice(8)
    const otherPct = other.reduce((s, e) => s + e.flat_pct, 0)
    const data: DonutDatum[] = top.map((e) => ({ label: extractFnShort(e.function), pct: e.flat_pct, fn: e.function }))
    if (otherPct > 0) data.push({ label: 'Other', pct: otherPct, fn: '' })

    const width = svgRef.current.clientWidth
    const height = 320
    const radius = Math.min(width, height) / 2 - 40

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`)

    const pie = d3.pie<DonutDatum>().value((d) => d.pct).sort(null)
    const arc = d3.arc<d3.PieArcDatum<DonutDatum>>().innerRadius(radius * 0.45).outerRadius(radius)
    const hoverArc = d3.arc<d3.PieArcDatum<DonutDatum>>().innerRadius(radius * 0.45).outerRadius(radius + 8)

    g.append('g').selectAll('path').data(pie(data)).join('path')
      .attr('d', (d) => arc(d) as string)
      .attr('fill', (_, i) => profileColors[i % profileColors.length])
      .attr('opacity', 0.85)
      .attr('stroke', '#fff').attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('d', hoverArc(d) as string).attr('opacity', 1)
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, text: `${d.data.fn || d.data.label}: ${d.data.pct.toFixed(1)}%` })
      })
      .on('mousemove', function (event: MouseEvent) {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, text: tooltip.text })
      })
      .on('mouseout', function () {
        const d = d3.select(this).datum() as d3.PieArcDatum<DonutDatum>
        d3.select(this).attr('d', arc(d) as string).attr('opacity', 0.85)
        setTooltip({ x: 0, y: 0, text: '' })
      })

    // Center text
    g.append('text').attr('text-anchor', 'middle').attr('y', -6)
      .attr('font-size', '20px').attr('font-weight', 'bold').attr('fill', '#374151').attr('class', 'dark:fill-ctp-text')
      .text(`${data.length} funcs`)
    g.append('text').attr('text-anchor', 'middle').attr('y', 14)
      .attr('font-size', '11px').attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-subtext0')
      .text('top allocators')

    // Legend
    const legG = svg.append('g').attr('transform', `translate(16, ${height - 10})`)
    data.forEach((d, i) => {
      const lx = i % 2 === 0 ? 0 : width / 2
      const ly = Math.floor(i / 2) * 18
      legG.append('rect').attr('x', lx).attr('y', ly - 10).attr('width', 10).attr('height', 10)
        .attr('rx', 2).attr('fill', profileColors[i % profileColors.length]).attr('opacity', 0.85)
      legG.append('text').attr('x', lx + 14).attr('y', ly - 1)
        .attr('font-size', '10px').attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-subtext0')
        .text(`${d.label} (${d.pct.toFixed(1)}%)`)
    })
  }, [entries])

  return (
    <div className="relative bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg overflow-hidden">
      <svg ref={svgRef} className="w-full" style={{ height: 320 }} />
      {tooltip.text && (
        <div className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-black text-white text-xs rounded-lg shadow-xl px-2 py-1"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
        >{tooltip.text}</div>
      )}
    </div>
  )
}

function FlamegraphChart({ entries }: { entries: ProfileEntry[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string }>({ x: 0, y: 0, text: '' })

  useEffect(() => {
    if (!entries.length || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const sorted = [...entries].sort((a, b) => b.cum_pct - a.cum_pct)
    const top = sorted.slice(0, 30)

    const groups = new Map<string, { pct: number; fns: { name: string; pct: number; flat: number }[] }>()
    for (const e of top) {
      const pkg = extractPkg(e.function)
      const short = extractFnShort(e.function)
      if (!groups.has(pkg)) groups.set(pkg, { pct: 0, fns: [] })
      const g = groups.get(pkg)!
      g.pct += e.flat_pct
      g.fns.push({ name: short, pct: e.flat_pct, flat: e.flat })
    }

    const pkgColors = new Map<string, string>()
    Array.from(groups.keys()).forEach((pkg, i) => pkgColors.set(pkg, profileColors[i % profileColors.length]))
    const color = (pkg: string) => pkgColors.get(pkg) || '#6366f1'

    const width = svgRef.current.clientWidth
    const rowH = 24
    const headerH = 22
    const rows = Array.from(groups.entries())
    const height = headerH + rows.length * rowH + rows.reduce((s, [_, g]) => s + Math.min(g.fns.length, 4) * rowH, 0) + 20
    const pad = { left: 10, right: 10 }

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const g = svg.append('g').attr('transform', `translate(${pad.left},0)`)
    const innerW = width - pad.left - pad.right
    const totalPct = Math.max(...sorted.map((e) => e.cum_pct), 1)

    // Header
    g.append('text').attr('x', 0).attr('y', 14).attr('font-size', '11px').attr('font-weight', 'bold')
      .attr('fill', '#374151').attr('class', 'dark:fill-ctp-text').text(`CPU Profile · Top ${top.length} functions`)

    let yy = headerH
    for (const [pkg, grp] of rows) {
      const pkgW = Math.max((grp.pct / totalPct) * innerW, 40)
      g.append('rect').attr('x', 0).attr('y', yy).attr('width', pkgW).attr('height', rowH - 2)
        .attr('rx', 2).attr('fill', color(pkg)).attr('opacity', 0.7)
      g.append('text').attr('x', 6).attr('y', yy + rowH / 2 + 1).attr('font-size', '10px').attr('font-weight', 'bold')
        .attr('fill', '#fff').attr('dominant-baseline', 'middle').text(`${pkg} (${grp.pct.toFixed(1)}%)`)
      yy += rowH

      const fns = grp.fns.slice(0, 4)
      for (const fn of fns) {
        const fnW = Math.max((fn.pct / totalPct) * innerW, 20)
        g.append('rect').attr('x', 0).attr('y', yy).attr('width', fnW).attr('height', rowH - 3)
          .attr('rx', 2).attr('fill', color(pkg)).attr('opacity', 0.35)
          .style('cursor', 'pointer')
          .on('mouseover', function (event: MouseEvent) {
            d3.select(this).attr('opacity', 0.7)
            const rect = svgRef.current!.getBoundingClientRect()
            setTooltip({ x: event.clientX - rect.left + 10, y: event.clientY - rect.top - 10, text: `${pkg}.${fn.name}: ${fn.pct.toFixed(1)}% (flat ${fn.flat.toFixed(2)})` })
          })
          .on('mousemove', function (event: MouseEvent) {
            const rect = svgRef.current!.getBoundingClientRect()
            setTooltip((prev) => ({ ...prev, x: event.clientX - rect.left + 10, y: event.clientY - rect.top - 10 }))
          })
          .on('mouseout', function () {
            d3.select(this).attr('opacity', 0.35)
            setTooltip({ x: 0, y: 0, text: '' })
          })
        g.append('text').attr('x', 6).attr('y', yy + rowH / 2 + 1).attr('font-size', '9px')
          .attr('fill', '#374151').attr('class', 'dark:fill-ctp-subtext1').attr('dominant-baseline', 'middle')
          .text(fn.pct > 5 ? `${fn.name} ${fn.pct.toFixed(1)}%` : '')
        yy += rowH
      }
    }
  }, [entries])

  return (
    <div className="relative bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg overflow-hidden mb-6">
      <svg ref={svgRef} className="w-full" style={{ minHeight: 200 }} />
      {tooltip.text && (
        <div className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-black text-white text-xs rounded-lg shadow-xl px-2 py-1"
          style={{ left: tooltip.x, top: tooltip.y }}
        >{tooltip.text}</div>
      )}
    </div>
  )
}

function ProfileTable({ title, entries, maxFlat }: { title: string; entries: ProfileEntry[] | null; maxFlat: number }) {
  if (!entries || entries.length === 0) return null

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide mb-3">{title}</h3>
      <div className="overflow-x-auto bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-ctp-surface1 text-left text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">
              <th className="py-3 px-4 font-medium">Function</th>
              <th className="py-3 px-4 font-medium text-right">Flat</th>
              <th className="py-3 px-4 font-medium text-right">Flat%</th>
              <th className="py-3 px-4 font-medium text-right">Cum</th>
              <th className="py-3 px-4 font-medium text-right">Cum%</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, 20).map((e, i) => {
              const barW = maxFlat > 0 ? (e.flat / maxFlat) * 100 : 0
              const isHot = e.flat_pct > 15
              return (
                <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                  <td className="py-2.5 px-4 font-mono text-xs text-gray-800 dark:text-ctp-text max-w-md truncate">
                    {isHot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle" />}
                    {e.function}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`font-mono text-xs ${isHot ? 'text-red-600 dark:text-ctp-red font-semibold' : 'text-gray-700 dark:text-ctp-subtext1'}`}>{e.flat.toFixed(2)}</span>
                      <div className="w-20 h-2 bg-gray-200 dark:bg-ctp-surface1 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${isHot ? 'bg-red-500 dark:bg-ctp-red' : 'bg-blue-500 dark:bg-ctp-blue'}`} style={{ width: `${barW}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className={`py-2.5 px-4 text-right font-mono text-xs ${isHot ? 'text-red-600 dark:text-ctp-red font-semibold' : 'text-gray-700 dark:text-ctp-subtext1'}`}>{e.flat_pct.toFixed(1)}%</td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-gray-700 dark:text-ctp-subtext1">{e.cum.toFixed(2)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-gray-700 dark:text-ctp-subtext1">{e.cum_pct.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function extractShortName(full: string): string {
  const m = full.match(/Benchmark([A-Z][a-z0-9]+|[A-Z]+)/)
  return m ? m[1] : full.length > 20 ? full.slice(0, 18) + '..' : full
}

function inferCategory(name: string): string {
  const m = name.match(/^(Benchmark)?([A-Z][a-z]+|[A-Z]+)/)
  return m ? m[2] : 'Other'
}

const catPalette = [
  '#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16',
]

function BenchmarkScatter({ benchmarks }: { benchmarks: BenchmarkResult[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: BenchmarkResult | null }>({ x: 0, y: 0, data: null })

  const sorted = useMemo(() => [...benchmarks].sort((a, b) => b.time_per_op - a.time_per_op), [benchmarks])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const b of benchmarks) seen.add(inferCategory(b.name))
    return Array.from(seen).sort()
  }, [benchmarks])

  const catColor = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c, i) => m.set(c, catPalette[i % catPalette.length]))
    return m
  }, [categories])

  useEffect(() => {
    if (!benchmarks.length || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = Math.max(500, window.innerHeight * 0.5)
    const pad = { top: 35, right: 140, bottom: 60, left: 70 }
    const innerW = width - pad.left - pad.right
    const innerH = height - pad.top - pad.bottom

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const maxTime = d3.max(benchmarks, (d) => d.time_per_op) || 1
    const maxAllocs = d3.max(benchmarks, (d) => d.allocs_per_op) || 1

    const xScale = d3.scaleLinear()
      .domain([0, maxTime * 1.12])
      .range([0, innerW])

    const yScale = d3.scaleLinear()
      .domain([0, maxAllocs * 1.12])
      .range([innerH, 0])

    const g = svg.append('g').attr('transform', `translate(${pad.left},${pad.top})`)

    // Grid lines
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(8).tickSize(-innerW).tickFormat(() => ''))
      .attr('stroke', '#e5e7eb').attr('class', 'dark:stroke-ctp-surface1')

    g.append('g')
      .call(d3.axisBottom(xScale).ticks(8).tickSize(innerH).tickFormat(() => ''))
      .attr('transform', `translate(0,${innerH})`)
      .attr('stroke', '#e5e7eb').attr('class', 'dark:stroke-ctp-surface1')

    // Axes
    const xAxis = g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(6).tickFormat((d) => fmtShortNS(d as number)))
      .attr('color', '#9ca3af').attr('font-size', '11px')

    xAxis.selectAll('.domain').attr('stroke', '#d1d5db').attr('class', 'dark:stroke-ctp-surface1')
    xAxis.selectAll('.tick line').attr('stroke', '#d1d5db').attr('class', 'dark:stroke-ctp-surface1')

    const yAxis = g.append('g')
      .call(d3.axisLeft(yScale).ticks(6))
      .attr('color', '#9ca3af').attr('font-size', '11px')

    yAxis.selectAll('.domain').attr('stroke', '#d1d5db').attr('class', 'dark:stroke-ctp-surface1')
    yAxis.selectAll('.tick line').attr('stroke', '#d1d5db').attr('class', 'dark:stroke-ctp-surface1')

    // Axis labels
    g.append('text').attr('x', innerW / 2).attr('y', innerH + 42)
      .attr('text-anchor', 'middle').attr('font-size', '12px')
      .attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-overlay1').text('Time / Op')

    g.append('text').attr('y', -42).attr('x', -(innerH / 2))
      .attr('transform', 'rotate(-90)').attr('text-anchor', 'middle').attr('font-size', '12px')
      .attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-overlay1').text('Allocs / Op')

    // Quadrant divider lines
    const medTime = d3.median(benchmarks, (d) => d.time_per_op) || 0
    const medAllocs = d3.median(benchmarks, (d) => d.allocs_per_op) || 0

    g.append('line').attr('x1', xScale(medTime)).attr('x2', xScale(medTime))
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', '#d1d5db').attr('stroke-dasharray', '4,4').attr('stroke-width', 1)
      .attr('class', 'dark:stroke-ctp-surface1')

    g.append('line').attr('x1', 0).attr('x2', innerW)
      .attr('y1', yScale(medAllocs)).attr('y2', yScale(medAllocs))
      .attr('stroke', '#d1d5db').attr('stroke-dasharray', '4,4').attr('stroke-width', 1)
      .attr('class', 'dark:stroke-ctp-surface1')

    // Quadrant badges
    const qBadges: { x: number; y: number; anchor: string; label: string; color: string; desc: string }[] = [
      { x: innerW - 6, y: 4, anchor: 'end', label: '✦ Best', color: '#16a34a', desc: 'Fast · low allocs' },
      { x: innerW - 6, y: yScale(medAllocs) + 14, anchor: 'end', label: 'Fast', color: '#22c55e', desc: 'but alloc-heavy' },
      { x: 6, y: 4, anchor: 'start', label: '✘ Worst', color: '#ef4444', desc: 'Slow · alloc-heavy' },
      { x: 6, y: yScale(medAllocs) + 14, anchor: 'start', label: 'Slow', color: '#f97316', desc: 'but few allocs' },
    ]
    qBadges.forEach((qb) => {
      const bg = g.append('g')
      const t = bg.append('text').attr('x', qb.x).attr('y', qb.y)
        .attr('text-anchor', qb.anchor).attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', qb.color)
        .text(qb.label)
      const bbox = (t.node() as SVGTextElement).getBBox()
      bg.insert('rect', 'text').attr('x', qb.anchor === 'end' ? qb.x - bbox.width - 3 : qb.x - 3)
        .attr('y', qb.y - 9).attr('width', bbox.width + 6).attr('height', bbox.height + 2)
        .attr('rx', 3).attr('fill', qb.color).attr('opacity', 0.12)
      g.append('text').attr('x', qb.x).attr('y', qb.y + 13)
        .attr('text-anchor', qb.anchor).attr('font-size', '9px').attr('fill', '#9ca3af')
        .attr('class', 'dark:fill-ctp-overlay1').text(qb.desc)
    })

    // Dots + labels
    const rScale = d3.scaleSqrt()
      .domain([0, d3.max(benchmarks, (d) => d.bytes_per_op) || 1])
      .range([4, 18])

    const dotGroup = g.append('g')

    benchmarks.forEach((d) => {
      const cx = xScale(d.time_per_op)
      const cy = yScale(d.allocs_per_op)
      const r = Math.max(rScale(d.bytes_per_op), 5)
      const cat = inferCategory(d.name)

      dotGroup.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', r)
        .attr('fill', catColor.get(cat) || '#6366f1')
        .attr('opacity', 0.75).attr('stroke', '#fff').attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .on('mouseover', function (event: MouseEvent) {
          d3.select(this).attr('opacity', 1).attr('stroke-width', 3)
          const rect = svgRef.current!.getBoundingClientRect()
          setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, data: d })
        })
        .on('mousemove', function (event: MouseEvent) {
          const rect = svgRef.current!.getBoundingClientRect()
          setTooltip((prev) => ({ ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top - 10 }))
        })
        .on('mouseout', function () {
          d3.select(this).attr('opacity', 0.75).attr('stroke-width', 1.5)
          setTooltip({ x: 0, y: 0, data: null })
        })

      // Label
      const label = extractShortName(d.name)
      dotGroup.append('text')
        .attr('x', cx + r + 5).attr('y', cy + 4)
        .attr('font-size', '10px').attr('fill', '#374151')
        .attr('class', 'dark:fill-ctp-subtext1')
        .style('pointer-events', 'none')
        .style('text-shadow', '0 0 3px white, 0 0 3px white')
        .text(label)
    })

    // Label overlap mitigation — move labels that are too close upwards/downwards
    const labelNodes: { x: number; y: number; el: d3.Selection<SVGTextElement, unknown, null, undefined> }[] = []
    dotGroup.selectAll<SVGTextElement, unknown>('text').each(function () {
      const el = d3.select(this)
      const x = +el.attr('x')
      const y = +el.attr('y')
      labelNodes.push({ x, y, el })
    })
    for (let i = 1; i < labelNodes.length; i++) {
      for (let j = 0; j < i; j++) {
        const dx = Math.abs(labelNodes[i].x - labelNodes[j].x)
        const dy = Math.abs(labelNodes[i].y - labelNodes[j].y)
        if (dx < 40 && dy < 16) {
          labelNodes[i].el.attr('y', labelNodes[i].y - 10)
          labelNodes[i].y -= 10
        }
      }
    }

    // Category legend (right side)
    const legG = svg.append('g').attr('transform', `translate(${width - pad.right + 12}, ${pad.top + 20})`)
    legG.append('text').text('Category').attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-overlay1')
    categories.forEach((c, i) => {
      const ly = (i + 1) * 20
      legG.append('circle').attr('cx', 0).attr('cy', ly).attr('r', 5).attr('fill', catPalette[i % catPalette.length]).attr('opacity', 0.8)
      legG.append('text').attr('x', 12).attr('y', ly + 4).attr('font-size', '10px').attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-subtext0').text(c)
    })

    // Size legend
    const sizeLegY = (categories.length + 2) * 20
    legG.append('text').text('Bytes/Op').attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', '#6b7280').attr('class', 'dark:fill-ctp-overlay1').attr('y', sizeLegY)
    const sizeSamples = [
      { r: 5, label: '0 B' },
      { r: 10, label: '~100 B' },
      { r: 16, label: '~1 KB+' },
    ]
    sizeSamples.forEach((s, i) => {
      const sy = sizeLegY + (i + 1) * 22
      legG.append('circle').attr('cx', 0).attr('cy', sy).attr('r', s.r).attr('fill', '#94a3b8').attr('opacity', 0.5)
      legG.append('text').attr('x', s.r + 8).attr('y', sy + 4).attr('font-size', '10px').attr('fill', '#9ca3af').attr('class', 'dark:fill-ctp-overlay1').text(s.label)
    })
  }, [benchmarks, categories, catColor])

  return (
    <section className="mb-10">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Benchmark Overview
        <span className="text-xs font-normal text-gray-400 dark:text-ctp-subtext1 ml-1">({benchmarks.length} benchmarks)</span>
      </h3>
      <div className="relative bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg overflow-hidden">
        <svg ref={svgRef} className="w-full" style={{ height: '52vh', minHeight: 500 }} />
        {tooltip.data && (
          <div
            className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-black text-white text-xs rounded-lg shadow-xl px-3 py-2 leading-relaxed max-w-xs"
            style={{ left: Math.min(tooltip.x, window.innerWidth - 260), top: Math.max(tooltip.y, 10) }}
          >
            <div className="font-semibold text-sm mb-1 break-all">{tooltip.data.name}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-300">
              <span>Time/Op</span><span className="text-right font-mono text-green-400">{fmtDuration(tooltip.data.time_per_op)}</span>
              <span>Iterations</span><span className="text-right font-mono">{tooltip.data.iterations.toLocaleString()}</span>
              <span>Allocs/Op</span><span className="text-right font-mono">{tooltip.data.allocs_per_op}</span>
              <span>Bytes/Op</span><span className="text-right font-mono">{fmtBytes(tooltip.data.bytes_per_op)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Compact reference table */}
      <div className="mt-3 overflow-x-auto bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 dark:border-ctp-surface1 text-left text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">
              <th className="py-2 px-3 font-medium">Benchmark</th>
              <th className="py-2 px-3 font-medium text-right">Time/Op</th>
              <th className="py-2 px-3 font-medium text-right">Allocs</th>
              <th className="py-2 px-3 font-medium text-right">Bytes</th>
              <th className="py-2 px-3 font-medium text-right">Iterations</th>
              <th className="py-2 px-3 font-medium text-right group relative cursor-help">
                <span className="border-b border-dotted border-gray-400">CPUs</span>
                <span className="invisible group-hover:visible absolute right-0 top-full mt-1 z-10 w-44 px-2 py-1 bg-gray-800 text-white text-[10px] font-normal rounded shadow-lg whitespace-normal normal-case">
                  GOMAXPROCS — number of OS threads used for this benchmark run
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => {
              const cat = inferCategory(b.name)
              const cpuMatch = b.name.match(/-(\d+)$/)
              return (
                <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                  <td className="py-1.5 px-3">
                    <div className="flex items-center gap-1.5 font-mono text-gray-800 dark:text-ctp-text">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor.get(cat) }} />
                      <span className="truncate">{b.name}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{fmtDuration(b.time_per_op)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{b.allocs_per_op}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{fmtBytes(b.bytes_per_op)}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500 dark:text-ctp-subtext0">{b.iterations.toLocaleString()}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-gray-500 dark:text-ctp-subtext0">
                    {cpuMatch ? `${cpuMatch[1]} thread${cpuMatch[1] !== '1' ? 's' : ''}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Performance({ benchmarks, profile, onScan, scanning, projectName }: Props) {
  const hasBenchmarks = benchmarks && benchmarks.length > 0
  const hasProfile = profile && ((profile.cpu && profile.cpu.length > 0) || (profile.mem && profile.mem.length > 0))

  const avgTime = useMemo(() => {
    if (!benchmarks || !benchmarks.length) return 0
    return benchmarks.reduce((s, b) => s + b.time_per_op, 0) / benchmarks.length
  }, [benchmarks])

  const avgAllocs = useMemo(() => {
    if (!benchmarks || !benchmarks.length) return 0
    return benchmarks.reduce((s, b) => s + b.allocs_per_op, 0) / benchmarks.length
  }, [benchmarks])

  const avgBytes = useMemo(() => {
    if (!benchmarks || !benchmarks.length) return 0
    return benchmarks.reduce((s, b) => s + b.bytes_per_op, 0) / benchmarks.length
  }, [benchmarks])

  const allProfileMaxFlat = useMemo(() => {
    let m = 0
    if (profile?.cpu) for (const e of profile.cpu) if (e.flat > m) m = e.flat
    if (profile?.mem) for (const e of profile.mem) if (e.flat > m) m = e.flat
    return m
  }, [profile])

  const suggestions = useMemo(() => generateSuggestions(benchmarks || [], profile), [benchmarks, profile])
  const [showPlan, setShowPlan] = useState(false)

  if (!hasBenchmarks && !hasProfile) {
    return (
      <div className="mx-auto p-8" style={{ maxWidth: 'min(95vw, 1400px)' }}>
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Performance</h2>
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-subtext0 mb-4">No performance data available.</p>
          {onScan && (
            <button onClick={onScan} disabled={scanning}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >{scanning ? 'Scanning...' : 'Run Scan'}</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto p-8" style={{ maxWidth: 'min(95vw, 1400px)' }}>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text">Performance</h2>
      </div>

      {/* Benchmarking section */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200 dark:border-ctp-surface1">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="text-base font-bold text-gray-800 dark:text-ctp-text">Benchmarking</h3>
          {hasBenchmarks && <span className="text-xs text-gray-400 dark:text-ctp-subtext1">({benchmarks!.length} benchmarks)</span>}
        </div>

        {hasBenchmarks ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-0.5">Benchmarks</div>
                <div className="text-xl font-bold text-gray-800 dark:text-ctp-text">{benchmarks!.length}</div>
              </div>
              <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-0.5">Avg Time/Op</div>
                <div className="text-xl font-bold text-gray-800 dark:text-ctp-text">{fmtShortNS(avgTime)}</div>
              </div>
              <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-0.5">Avg Allocs/Op</div>
                <div className="text-xl font-bold text-gray-800 dark:text-ctp-text">{avgAllocs.toFixed(1)}</div>
              </div>
              <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-0.5">Avg Bytes/Op</div>
                <div className="text-xl font-bold text-gray-800 dark:text-ctp-text">{fmtBytes(avgBytes)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <BenchmarkScatter benchmarks={benchmarks!} />
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-2">Ranking by Time/Op</h4>
                <BenchmarkRanking benchmarks={benchmarks!} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500 dark:text-ctp-subtext0 italic">No benchmark data collected.</p>
        )}
      </section>

      {/* Profiling section */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200 dark:border-ctp-surface1">
          <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h3 className="text-base font-bold text-gray-800 dark:text-ctp-text">Profiling</h3>
          {hasProfile && <span className="text-xs text-gray-400 dark:text-ctp-subtext1">(CPU + memory)</span>}
        </div>

        {hasProfile ? (
          <>
            {profile!.cpu && profile!.cpu.length > 0 && (
              <div className="mb-6">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-2">CPU Hot Paths</h4>
                <FlamegraphChart entries={profile!.cpu} />
              </div>
            )}
            {profile!.mem && profile!.mem.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-2">Memory Allocation Breakdown</h4>
                  <AllocationDonut entries={profile!.mem} />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-2">Top Functions (Table)</h4>
                  <ProfileTable title="" entries={profile!.mem} maxFlat={allProfileMaxFlat} />
                </div>
              </div>
            )}
            {profile!.cpu && profile!.cpu.length > 0 && (
              <ProfileTable title="CPU — Top Functions" entries={profile!.cpu} maxFlat={allProfileMaxFlat} />
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500 dark:text-ctp-subtext0 italic">No profile data collected.</p>
        )}
      </section>

      {/* Advice section */}
      <section>
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-200 dark:border-ctp-surface1">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <h3 className="text-base font-bold text-gray-800 dark:text-ctp-text">Advice</h3>
          </div>
          {(hasBenchmarks || hasProfile) && (
            <button
              onClick={() => setShowPlan(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Generate Plan
            </button>
          )}
        </div>

        {suggestions.length > 0 ? (
          <div className="grid gap-2">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  s.type === 'warning'
                    ? 'bg-orange-50 dark:bg-ctp-surface0 border-orange-200 dark:border-ctp-surface1'
                    : s.type === 'info'
                    ? 'bg-blue-50 dark:bg-ctp-surface0 border-blue-200 dark:border-ctp-surface1'
                    : 'bg-emerald-50 dark:bg-ctp-surface0 border-emerald-200 dark:border-ctp-surface1'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    {s.type === 'warning' ? (
                      <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.27 14.31A1 1 0 002.93 20h18.14a1 1 0 00.86-1.53l-8.27-14.31a1 1 0 00-1.72 0z" />
                      </svg>
                    ) : s.type === 'info' ? (
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 dark:text-ctp-text">{s.title}</div>
                    <div className="text-gray-600 dark:text-ctp-subtext0 mt-0.5 leading-relaxed">{s.description}</div>
                    {s.benchmark && <div className="text-xs font-mono text-gray-400 dark:text-ctp-subtext1 mt-1">{s.benchmark}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-ctp-subtext0 italic">No advice generated. Collect benchmark or profile data to see suggestions.</p>
        )}
      </section>

      {showPlan && (
        <PerformancePlan
          benchmarks={benchmarks}
          profile={profile}
          projectName={projectName || 'project'}
          onClose={() => setShowPlan(false)}
        />
      )}
    </div>
  )
}
