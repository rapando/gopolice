import { useMemo, useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { BenchmarkResult, ProfileData, ProfileEntry } from '../api/client'
import PerformancePlan from '../components/PerformancePlan'
import { useThemeColors, ThemeColors } from '../hooks/useThemeColors'
import EmptyState from '../components/EmptyState'

// A categorical palette drawn from the active theme's accent colors, so
// per-series/per-category chart colors stay coordinated across schemes.
function categoricalPalette(c: ThemeColors): string[] {
  return [c.blue, c.mauve, c.teal, c.peach, c.green, c.sapphire, c.yellow, c.lavender, c.pink, c.red]
}

// Theme accents range from dark-saturated (Dracula red) to pale pastel
// (Catppuccin Latte yellow), so a fixed white/black label color reads poorly
// on roughly half the palette in any given scheme. Pick whichever of
// near-black/near-white yields better contrast against the *actual* resolved
// fill, using the standard YIQ perceived-brightness formula.
function contrastOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return '#fff'
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#1e1e2e' : '#fff'
}

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

function extractShortName(full: string): string {
  const m = full.match(/Benchmark([A-Z][a-z0-9]+|[A-Z]+)/)
  return m ? m[1] : full.length > 20 ? full.slice(0, 18) + '..' : full
}

function inferCategory(name: string): string {
  const m = name.match(/^(Benchmark)?([A-Z][a-z]+|[A-Z]+)/)
  return m ? m[2] : 'Other'
}

// ---------------------------------------------------------------------------
// Shared presentational primitives
// ---------------------------------------------------------------------------

function SectionHeader({ icon, iconClass, title, hint }: { icon: React.ReactNode; iconClass: string; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-200 dark:border-ctp-surface1">
      <span className={iconClass}>{icon}</span>
      <h3 className="text-base font-bold text-gray-800 dark:text-ctp-text">{title}</h3>
      {hint && <span className="text-xs text-gray-400 dark:text-ctp-subtext1">{hint}</span>}
    </div>
  )
}

function ChartCard({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 dark:border-ctp-surface1">
        <h4 className="text-xs font-semibold text-gray-600 dark:text-ctp-subtext1 uppercase tracking-wide">{title}</h4>
        {caption && <p className="text-[11px] text-gray-400 dark:text-ctp-subtext0 mt-0.5">{caption}</p>}
      </div>
      <div className="relative p-3">{children}</div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg px-4 py-3">
      <div className="text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${accent || 'text-gray-800 dark:text-ctp-text'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 dark:text-ctp-subtext0 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

function useTooltip<T>() {
  return useState<{ x: number; y: number; data: T | null }>({ x: 0, y: 0, data: null })
}

// ---------------------------------------------------------------------------
// Benchmark: horizontal diverging bar — primary view (time, colored by allocs)
// ---------------------------------------------------------------------------

function BenchmarkBars({ benchmarks }: { benchmarks: BenchmarkResult[] }) {
  const colors = useThemeColors()
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useTooltip<BenchmarkResult>()

  const sorted = useMemo(() => [...benchmarks].sort((a, b) => b.time_per_op - a.time_per_op), [benchmarks])
  const maxTime = useMemo(() => Math.max(...benchmarks.map((b) => b.time_per_op), 1), [benchmarks])
  const maxAllocs = useMemo(() => Math.max(...benchmarks.map((b) => b.allocs_per_op), 1), [benchmarks])

  useEffect(() => {
    if (!sorted.length || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const rowH = 30
    const pad = { top: 8, right: 130, bottom: 24, left: 150 }
    const height = sorted.length * rowH + pad.top + pad.bottom
    const innerW = width - pad.left - pad.right

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const xScale = d3.scaleLinear().domain([0, maxTime * 1.05]).range([0, Math.max(innerW, 1)])
    // Color encodes allocations: green (none) -> yellow -> red (many).
    const colorScale = d3.scaleSequentialSqrt()
      .domain([0, Math.max(maxAllocs, 1)])
      .interpolator(d3.interpolateRgbBasis([colors.green, colors.yellow, colors.red]))

    const g = svg.append('g').attr('transform', `translate(${pad.left},${pad.top})`)

    // x gridlines
    const ticks = xScale.ticks(5)
    g.append('g').selectAll('line').data(ticks).join('line')
      .attr('x1', (d) => xScale(d)).attr('x2', (d) => xScale(d))
      .attr('y1', 0).attr('y2', sorted.length * rowH)
      .attr('stroke', colors.border).attr('stroke-opacity', 0.5)
    g.append('g').selectAll('text').data(ticks).join('text')
      .attr('x', (d) => xScale(d)).attr('y', sorted.length * rowH + 14)
      .attr('text-anchor', 'middle').attr('font-size', '9px').attr('fill', colors.overlay1)
      .text((d) => fmtShortNS(d as number))

    sorted.forEach((b, i) => {
      const y = i * rowH
      const w = Math.max(xScale(b.time_per_op), 2)
      const color = b.allocs_per_op > 0 ? colorScale(b.allocs_per_op) : colors.green

      // row label (benchmark name)
      g.append('text').attr('x', -10).attr('y', y + rowH / 2)
        .attr('font-size', '11px').attr('fill', colors.text)
        .attr('dominant-baseline', 'middle').attr('text-anchor', 'end')
        .text(extractShortName(b.name))

      const bar = g.append('rect')
        .attr('x', 0).attr('y', y + 3).attr('width', w).attr('height', rowH - 10)
        .attr('rx', 3).attr('fill', color as string).attr('opacity', 0.85)
        .style('cursor', 'pointer')
      bar
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
          d3.select(this).attr('opacity', 0.85)
          setTooltip({ x: 0, y: 0, data: null })
        })

      g.append('text').attr('x', w + 8).attr('y', y + rowH / 2)
        .attr('font-size', '11px').attr('fill', colors.muted)
        .attr('dominant-baseline', 'middle')
        .text(`${fmtShortNS(b.time_per_op)} · ${b.allocs_per_op} alloc`)
    })
  }, [sorted, maxTime, maxAllocs, colors, setTooltip])

  return (
    <div className="relative">
      <svg ref={svgRef} className="w-full" style={{ minHeight: 120 }} />
      <BenchTooltip tooltip={tooltip} />
    </div>
  )
}

function BenchTooltip({ tooltip }: { tooltip: { x: number; y: number; data: BenchmarkResult | null } }) {
  if (!tooltip.data) return null
  const eff = allocEfficiency(tooltip.data.allocs_per_op, tooltip.data.bytes_per_op)
  return (
    <div role="tooltip" className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-black text-white text-xs rounded-lg shadow-xl px-3 py-2 leading-relaxed max-w-xs"
      style={{ left: Math.min(tooltip.x, window.innerWidth - 280), top: Math.max(tooltip.y, 10) }}
    >
      <div className="font-semibold text-sm mb-1 break-all">{tooltip.data.name}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-300">
        <span>Time/Op</span><span className="text-right font-mono text-green-400">{fmtDuration(tooltip.data.time_per_op)}</span>
        <span>Iterations</span><span className="text-right font-mono">{tooltip.data.iterations.toLocaleString()}</span>
        <span>Allocs/Op</span><span className="text-right font-mono">{tooltip.data.allocs_per_op}</span>
        <span>Bytes/Op</span><span className="text-right font-mono">{fmtBytes(tooltip.data.bytes_per_op)}</span>
        <span>Alloc efficiency</span><span className="text-right font-mono">{eff.label}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Benchmark scatter — secondary view (time vs allocs, quadrants)
// ---------------------------------------------------------------------------

function BenchmarkScatter({ benchmarks }: { benchmarks: BenchmarkResult[] }) {
  const colors = useThemeColors()
  const catPalette = useMemo(() => categoricalPalette(colors), [colors])
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useTooltip<BenchmarkResult>()

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const b of benchmarks) seen.add(inferCategory(b.name))
    return Array.from(seen).sort()
  }, [benchmarks])

  const catColor = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c, i) => m.set(c, catPalette[i % catPalette.length]))
    return m
  }, [categories, catPalette])

  useEffect(() => {
    if (!benchmarks.length || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = Math.max(420, window.innerHeight * 0.45)
    const pad = { top: 30, right: Math.round(Math.max(90, Math.min(140, width * 0.11))), bottom: 56, left: 64 }
    const innerW = width - pad.left - pad.right
    const innerH = height - pad.top - pad.bottom

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const maxTime = d3.max(benchmarks, (d) => d.time_per_op) || 1
    const maxAllocs = d3.max(benchmarks, (d) => d.allocs_per_op) || 1

    const xScale = d3.scaleLinear().domain([0, maxTime * 1.12]).range([0, innerW])
    const yScale = d3.scaleLinear().domain([0, maxAllocs * 1.12]).range([innerH, 0])

    const g = svg.append('g').attr('transform', `translate(${pad.left},${pad.top})`)

    g.append('g').call(d3.axisLeft(yScale).ticks(8).tickSize(-innerW).tickFormat(() => '')).attr('stroke', colors.border)
    g.append('g').call(d3.axisBottom(xScale).ticks(8).tickSize(innerH).tickFormat(() => ''))
      .attr('transform', `translate(0,${innerH})`).attr('stroke', colors.border)

    const xAxis = g.append('g').attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).ticks(6).tickFormat((d) => fmtShortNS(d as number)))
      .attr('color', colors.overlay1).attr('font-size', '11px')
    xAxis.selectAll('.domain').attr('stroke', colors.border)
    xAxis.selectAll('.tick line').attr('stroke', colors.border)

    const yAxis = g.append('g').call(d3.axisLeft(yScale).ticks(6)).attr('color', colors.overlay1).attr('font-size', '11px')
    yAxis.selectAll('.domain').attr('stroke', colors.border)
    yAxis.selectAll('.tick line').attr('stroke', colors.border)

    g.append('text').attr('x', innerW / 2).attr('y', innerH + 40)
      .attr('text-anchor', 'middle').attr('font-size', '12px').attr('fill', colors.muted).text('Time / Op  →  slower')
    g.append('text').attr('y', -46).attr('x', -(innerH / 2))
      .attr('transform', 'rotate(-90)').attr('text-anchor', 'middle').attr('font-size', '12px')
      .attr('fill', colors.muted).text('Allocs / Op  →  more')

    const medTime = d3.median(benchmarks, (d) => d.time_per_op) || 0
    const medAllocs = d3.median(benchmarks, (d) => d.allocs_per_op) || 0

    g.append('line').attr('x1', xScale(medTime)).attr('x2', xScale(medTime)).attr('y1', 0).attr('y2', innerH)
      .attr('stroke', colors.border).attr('stroke-dasharray', '4,4')
    g.append('line').attr('x1', 0).attr('x2', innerW).attr('y1', yScale(medAllocs)).attr('y2', yScale(medAllocs))
      .attr('stroke', colors.border).attr('stroke-dasharray', '4,4')

    const qBadges = [
      { x: innerW - 6, y: 4, anchor: 'end', label: '✦ Best', color: colors.green, desc: 'fast · low allocs' },
      { x: 6, y: 4, anchor: 'start', label: '✘ Worst', color: colors.red, desc: 'slow · alloc-heavy' },
    ]
    qBadges.forEach((qb) => {
      g.append('text').attr('x', qb.x).attr('y', qb.y).attr('text-anchor', qb.anchor)
        .attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', qb.color).text(qb.label)
      g.append('text').attr('x', qb.x).attr('y', qb.y + 13).attr('text-anchor', qb.anchor)
        .attr('font-size', '9px').attr('fill', colors.overlay1).text(qb.desc)
    })

    const rScale = d3.scaleSqrt().domain([0, d3.max(benchmarks, (d) => d.bytes_per_op) || 1]).range([4, 18])
    const dotGroup = g.append('g')

    benchmarks.forEach((d) => {
      const cx = xScale(d.time_per_op)
      const cy = yScale(d.allocs_per_op)
      const r = Math.max(rScale(d.bytes_per_op), 5)
      const cat = inferCategory(d.name)

      dotGroup.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r)
        .attr('fill', catColor.get(cat) || colors.lavender)
        .attr('opacity', 0.75).attr('stroke', colors.surface).attr('stroke-width', 1.5)
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

      dotGroup.append('text').attr('x', cx + r + 5).attr('y', cy + 4)
        .attr('font-size', '10px').attr('fill', colors.muted).style('pointer-events', 'none')
        .style('text-shadow', `0 0 3px ${colors.surface}, 0 0 3px ${colors.surface}`)
        .text(extractShortName(d.name))
    })

    // label overlap mitigation
    const labelNodes: { x: number; y: number; el: d3.Selection<SVGTextElement, unknown, null, undefined> }[] = []
    dotGroup.selectAll<SVGTextElement, unknown>('text').each(function () {
      const el = d3.select(this)
      labelNodes.push({ x: +el.attr('x'), y: +el.attr('y'), el })
    })
    for (let i = 1; i < labelNodes.length; i++) {
      for (let j = 0; j < i; j++) {
        if (Math.abs(labelNodes[i].x - labelNodes[j].x) < 40 && Math.abs(labelNodes[i].y - labelNodes[j].y) < 16) {
          labelNodes[i].el.attr('y', labelNodes[i].y - 10)
          labelNodes[i].y -= 10
        }
      }
    }

    const legG = svg.append('g').attr('transform', `translate(${width - pad.right + 12}, ${pad.top + 16})`)
    legG.append('text').text('Category').attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', colors.overlay1)
    categories.forEach((c, i) => {
      const ly = (i + 1) * 20
      legG.append('circle').attr('cx', 0).attr('cy', ly).attr('r', 5).attr('fill', catPalette[i % catPalette.length]).attr('opacity', 0.8)
      legG.append('text').attr('x', 12).attr('y', ly + 4).attr('font-size', '10px').attr('fill', colors.muted).text(c)
    })
    const sizeLegY = (categories.length + 2) * 20
    legG.append('text').text('Bytes/Op').attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', colors.overlay1).attr('y', sizeLegY)
    ;[{ r: 5, label: '0 B' }, { r: 10, label: '~100 B' }, { r: 16, label: '~1 KB+' }].forEach((s, i) => {
      const sy = sizeLegY + (i + 1) * 22
      legG.append('circle').attr('cx', 0).attr('cy', sy).attr('r', s.r).attr('fill', colors.overlay0).attr('opacity', 0.5)
      legG.append('text').attr('x', s.r + 8).attr('y', sy + 4).attr('font-size', '10px').attr('fill', colors.overlay1).text(s.label)
    })
  }, [benchmarks, categories, catColor, colors, catPalette, setTooltip])

  return (
    <div className="relative">
      <svg ref={svgRef} className="w-full" style={{ height: '45vh', minHeight: 420 }} />
      <BenchTooltip tooltip={tooltip} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile: treemap of hottest functions (area = flat%, grouped by package)
// ---------------------------------------------------------------------------

interface TreeLeaf { name: string; pkg: string; fn: string; value: number; flat: number }

function ProfileTreemap({ entries }: { entries: ProfileEntry[] }) {
  const colors = useThemeColors()
  const palette = useMemo(() => categoricalPalette(colors), [colors])
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string }>({ x: 0, y: 0, text: '' })

  useEffect(() => {
    if (!entries.length || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const sorted = [...entries].filter((e) => e.flat_pct > 0).sort((a, b) => b.flat_pct - a.flat_pct).slice(0, 24)
    if (!sorted.length) return

    const pkgs = Array.from(new Set(sorted.map((e) => extractPkg(e.function))))
    const pkgColor = new Map<string, string>()
    pkgs.forEach((p, i) => pkgColor.set(p, palette[i % palette.length]))

    const leaves: TreeLeaf[] = sorted.map((e) => ({
      name: extractFnShort(e.function), pkg: extractPkg(e.function), fn: e.function, value: e.flat_pct, flat: e.flat,
    }))

    const width = svgRef.current.clientWidth
    const height = 360

    const root = d3.hierarchy<{ children?: TreeLeaf[] } | TreeLeaf>({ children: leaves })
      .sum((d) => ('value' in d ? d.value : 0))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    d3.treemap<{ children?: TreeLeaf[] } | TreeLeaf>().size([width, height]).paddingInner(2).round(true)(root)

    const svgSel = svg.attr('viewBox', `0 0 ${width} ${height}`)
    const cell = svgSel.selectAll('g').data(root.leaves()).join('g')
      .attr('transform', (d) => `translate(${(d as d3.HierarchyRectangularNode<unknown>).x0},${(d as d3.HierarchyRectangularNode<unknown>).y0})`)

    cell.append('rect')
      .attr('width', (d) => { const n = d as d3.HierarchyRectangularNode<unknown>; return n.x1 - n.x0 })
      .attr('height', (d) => { const n = d as d3.HierarchyRectangularNode<unknown>; return n.y1 - n.y0 })
      .attr('rx', 3)
      .attr('fill', (d) => pkgColor.get((d.data as TreeLeaf).pkg) || colors.lavender)
      .attr('opacity', 0.85)
      .attr('stroke', colors.surface).attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1)
        const leaf = d.data as TreeLeaf
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, text: `${leaf.fn} — ${leaf.value.toFixed(1)}% (flat ${leaf.flat.toFixed(2)})` })
      })
      .on('mousemove', function (event: MouseEvent) {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip((prev) => ({ ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top }))
      })
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 0.85)
        setTooltip({ x: 0, y: 0, text: '' })
      })

    cell.each(function (d) {
      const n = d as d3.HierarchyRectangularNode<unknown>
      const w = n.x1 - n.x0
      const h = n.y1 - n.y0
      const leaf = d.data as TreeLeaf
      if (w < 46 || h < 26) return
      const labelColor = contrastOn(pkgColor.get(leaf.pkg) || colors.lavender)
      const t = d3.select(this).append('text')
        .attr('x', 5).attr('y', 14).attr('font-size', '10px').attr('font-weight', 'bold')
        .attr('fill', labelColor).style('pointer-events', 'none')
        .text(leaf.name.length > Math.floor(w / 6) ? leaf.name.slice(0, Math.floor(w / 6)) + '…' : leaf.name)
      if (h >= 40) {
        t.clone(true).attr('y', 28).attr('font-size', '9px').attr('font-weight', 'normal')
          .attr('fill', labelColor).attr('opacity', 0.85).text(`${leaf.value.toFixed(1)}%`)
      }
    })
  }, [entries, colors, palette])

  return (
    <div className="relative">
      <svg ref={svgRef} className="w-full" style={{ height: 360 }} />
      {tooltip.text && (
        <div role="tooltip" className="absolute z-20 pointer-events-none bg-gray-900 dark:bg-black text-white text-xs rounded-lg shadow-xl px-2 py-1 max-w-xs break-all"
          style={{ left: Math.min(tooltip.x + 10, window.innerWidth - 280), top: tooltip.y - 10 }}
        >{tooltip.text}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile table — used for both CPU and memory, with flat/cum bars
// ---------------------------------------------------------------------------

function ProfileTable({ entries, maxFlat, unit }: { entries: ProfileEntry[] | null; maxFlat: number; unit: string }) {
  if (!entries || entries.length === 0) return null
  return (
    <div className="overflow-x-auto bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-ctp-surface1 text-left text-xs text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">
            <th className="py-3 px-4 font-medium">Function</th>
            <th className="py-3 px-4 font-medium text-right">Self ({unit})</th>
            <th className="py-3 px-4 font-medium text-right">Self %</th>
            <th className="py-3 px-4 font-medium text-right">Cumulative %</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 20).map((e, i) => {
            const barW = maxFlat > 0 ? (e.flat / maxFlat) * 100 : 0
            const isHot = e.flat_pct > 15
            return (
              <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                <td className="py-2.5 px-4 font-mono text-xs text-gray-800 dark:text-ctp-text max-w-md truncate" title={e.function}>
                  {isHot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 dark:bg-ctp-red mr-1.5 align-middle" />}
                  {e.function}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`font-mono text-xs tabular-nums ${isHot ? 'text-red-600 dark:text-ctp-red font-semibold' : 'text-gray-700 dark:text-ctp-subtext1'}`}>{e.flat.toFixed(2)}</span>
                    <div className="w-20 h-2 bg-gray-200 dark:bg-ctp-surface1 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isHot ? 'bg-red-500 dark:bg-ctp-red' : 'bg-blue-500 dark:bg-ctp-blue'}`} style={{ width: `${barW}%` }} />
                    </div>
                  </div>
                </td>
                <td className={`py-2.5 px-4 text-right font-mono text-xs tabular-nums ${isHot ? 'text-red-600 dark:text-ctp-red font-semibold' : 'text-gray-700 dark:text-ctp-subtext1'}`}>{e.flat_pct.toFixed(1)}%</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-gray-700 dark:text-ctp-subtext1">{e.cum_pct.toFixed(1)}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Benchmark reference table (full detail, sorted slow -> fast)
// ---------------------------------------------------------------------------

function BenchmarkTable({ benchmarks }: { benchmarks: BenchmarkResult[] }) {
  const colors = useThemeColors()
  const catPalette = useMemo(() => categoricalPalette(colors), [colors])
  const sorted = useMemo(() => [...benchmarks].sort((a, b) => b.time_per_op - a.time_per_op), [benchmarks])
  const categories = useMemo(() => Array.from(new Set(benchmarks.map((b) => inferCategory(b.name)))).sort(), [benchmarks])
  const catColor = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c, i) => m.set(c, catPalette[i % catPalette.length]))
    return m
  }, [categories, catPalette])

  return (
    <div className="overflow-x-auto bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 dark:border-ctp-surface1 text-left text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">
            <th className="py-2 px-3 font-medium">Benchmark</th>
            <th className="py-2 px-3 font-medium text-right">Time/Op</th>
            <th className="py-2 px-3 font-medium text-right">Allocs</th>
            <th className="py-2 px-3 font-medium text-right">Bytes</th>
            <th className="py-2 px-3 font-medium text-right">Efficiency</th>
            <th className="py-2 px-3 font-medium text-right">Iterations</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((b, i) => {
            const cat = inferCategory(b.name)
            const eff = allocEfficiency(b.allocs_per_op, b.bytes_per_op)
            return (
              <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                <td className="py-1.5 px-3">
                  <div className="flex items-center gap-1.5 font-mono text-gray-800 dark:text-ctp-text">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor.get(cat) }} />
                    <span className="truncate" title={b.name}>{b.name}</span>
                  </div>
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-gray-700 dark:text-ctp-subtext1">{fmtDuration(b.time_per_op)}</td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-gray-700 dark:text-ctp-subtext1">{b.allocs_per_op}</td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-gray-700 dark:text-ctp-subtext1">{fmtBytes(b.bytes_per_op)}</td>
                <td className={`py-1.5 px-3 text-right font-medium ${eff.color}`}>{eff.label}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-gray-500 dark:text-ctp-subtext0">{b.iterations.toLocaleString()}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Performance({ benchmarks, profile, onScan, scanning, projectName }: Props) {
  const hasBenchmarks = benchmarks && benchmarks.length > 0
  const hasCpu = !!(profile && profile.cpu && profile.cpu.length > 0)
  const hasMem = !!(profile && profile.mem && profile.mem.length > 0)
  const hasProfile = hasCpu || hasMem

  const [profileTab, setProfileTab] = useState<'cpu' | 'mem'>('cpu')
  const [showPlan, setShowPlan] = useState(false)

  // Default the profile tab to whichever data exists.
  useEffect(() => {
    if (!hasCpu && hasMem) setProfileTab('mem')
    else if (hasCpu) setProfileTab('cpu')
  }, [hasCpu, hasMem])

  const stats = useMemo(() => {
    if (!benchmarks || !benchmarks.length) return null
    const n = benchmarks.length
    const avgTime = benchmarks.reduce((s, b) => s + b.time_per_op, 0) / n
    const avgAllocs = benchmarks.reduce((s, b) => s + b.allocs_per_op, 0) / n
    const slowest = benchmarks.reduce((a, b) => (a.time_per_op > b.time_per_op ? a : b))
    const heaviest = benchmarks.reduce((a, b) => (a.allocs_per_op > b.allocs_per_op ? a : b))
    const zeroAlloc = benchmarks.filter((b) => b.allocs_per_op === 0).length
    return { n, avgTime, avgAllocs, slowest, heaviest, zeroAlloc }
  }, [benchmarks])

  const activeEntries = profileTab === 'cpu' ? profile?.cpu : profile?.mem
  const profileMaxFlat = useMemo(() => {
    if (!activeEntries) return 0
    return activeEntries.reduce((m, e) => (e.flat > m ? e.flat : m), 0)
  }, [activeEntries])

  const hottest = useMemo(() => {
    if (!activeEntries || !activeEntries.length) return null
    return [...activeEntries].sort((a, b) => b.flat_pct - a.flat_pct)[0]
  }, [activeEntries])

  const suggestions = useMemo(() => generateSuggestions(benchmarks || [], profile), [benchmarks, profile])

  if (!hasBenchmarks && !hasProfile) {
    return (
      <div className="mx-auto p-8" style={{ maxWidth: 'min(95vw, 1600px)' }}>
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Performance</h2>
        <EmptyState message="No performance data available. Run a scan with benchmarks and profiling enabled." onScan={onScan} scanning={scanning} />
      </div>
    )
  }

  return (
    <div className="mx-auto p-8" style={{ maxWidth: 'min(95vw, 1600px)' }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text">Performance</h2>
        {(hasBenchmarks || hasProfile) && (
          <button
            onClick={() => setShowPlan(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-ctp-lavender dark:text-ctp-base dark:hover:bg-ctp-mauve transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Generate Plan
          </button>
        )}
      </div>

      {/* At-a-glance summary cards */}
      {(stats || hottest) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats && (
            <>
              <StatCard label="Benchmarks" value={String(stats.n)} sub={`${stats.zeroAlloc} alloc-free`} />
              <StatCard label="Avg Time/Op" value={fmtShortNS(stats.avgTime)} />
              <StatCard
                label="Slowest"
                value={fmtShortNS(stats.slowest.time_per_op)}
                sub={extractShortName(stats.slowest.name)}
                accent="text-red-600 dark:text-ctp-red"
              />
              <StatCard
                label="Most Allocations"
                value={`${stats.heaviest.allocs_per_op}/op`}
                sub={extractShortName(stats.heaviest.name)}
                accent={stats.heaviest.allocs_per_op > 0 ? 'text-orange-600 dark:text-ctp-peach' : undefined}
              />
            </>
          )}
          {!stats && hottest && (
            <StatCard
              label={`Hottest (${profileTab.toUpperCase()})`}
              value={`${hottest.flat_pct.toFixed(1)}%`}
              sub={extractFnShort(hottest.function)}
              accent="text-red-600 dark:text-ctp-red"
            />
          )}
        </div>
      )}

      {/* Benchmarking section */}
      {hasBenchmarks && (
        <section className="mb-10">
          <SectionHeader
            iconClass="w-5 h-5 text-indigo-500 dark:text-ctp-lavender"
            title="Benchmarking"
            hint={`${benchmarks!.length} benchmarks`}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <ChartCard title="Ranking by Time/Op" caption="Bar length = time per op · color = allocations (green → red)">
              <BenchmarkBars benchmarks={benchmarks!} />
            </ChartCard>
            <ChartCard title="Time vs Allocations" caption="X = time, Y = allocs, bubble size = bytes/op. Bottom-right is the danger zone.">
              <BenchmarkScatter benchmarks={benchmarks!} />
            </ChartCard>
          </div>

          <BenchmarkTable benchmarks={benchmarks!} />
        </section>
      )}

      {/* Profiling section */}
      {hasProfile && (
        <section className="mb-10">
          <SectionHeader
            iconClass="w-5 h-5 text-rose-500 dark:text-ctp-pink"
            title="Profiling"
            hint={hasCpu && hasMem ? 'CPU + memory' : hasCpu ? 'CPU' : 'memory'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />

          {/* CPU/Memory toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-ctp-surface1 p-0.5 mb-4 bg-gray-50 dark:bg-ctp-mantle">
            {hasCpu && (
              <button
                onClick={() => setProfileTab('cpu')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${profileTab === 'cpu' ? 'bg-white dark:bg-ctp-surface1 text-gray-800 dark:text-ctp-text shadow-sm' : 'text-gray-500 dark:text-ctp-subtext0'}`}
              >
                CPU
              </button>
            )}
            {hasMem && (
              <button
                onClick={() => setProfileTab('mem')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${profileTab === 'mem' ? 'bg-white dark:bg-ctp-surface1 text-gray-800 dark:text-ctp-text shadow-sm' : 'text-gray-500 dark:text-ctp-subtext0'}`}
              >
                Memory
              </button>
            )}
          </div>

          {activeEntries && activeEntries.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ChartCard
                title={`${profileTab === 'cpu' ? 'CPU' : 'Memory'} Hotspots`}
                caption="Each tile is a function; area = self %, color groups by package. Larger = hotter."
              >
                <ProfileTreemap entries={activeEntries} />
              </ChartCard>
              <div>
                <h4 className="text-xs font-semibold text-gray-600 dark:text-ctp-subtext1 uppercase tracking-wide mb-2">
                  Top Functions ({profileTab === 'cpu' ? 'self CPU' : 'self memory'})
                </h4>
                <ProfileTable entries={activeEntries} maxFlat={profileMaxFlat} unit={profileTab === 'cpu' ? 's' : 'MB'} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-ctp-subtext0 italic">No {profileTab === 'cpu' ? 'CPU' : 'memory'} profile data collected.</p>
          )}
        </section>
      )}

      {/* Advice section */}
      <section>
        <SectionHeader
          iconClass="w-5 h-5 text-amber-500 dark:text-ctp-peach"
          title="Advice"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          }
        />

        {suggestions.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
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
                    {s.benchmark && <div className="text-xs font-mono text-gray-400 dark:text-ctp-subtext1 mt-1 truncate">{s.benchmark}</div>}
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
