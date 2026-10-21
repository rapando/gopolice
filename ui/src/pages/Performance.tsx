import { useMemo, useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { Download } from 'lucide-react'
import { BenchmarkResult, ProfileData, ProfileEntry } from '../api/client'
import PerformancePlan from '../components/PerformancePlan'
import { useThemeColors, seriesColorMap } from '../hooks/useThemeColors'
import EmptyState from '../components/EmptyState'
import StatTile, { type StatTone } from '../components/StatTile'
import Bottlenecks from '../components/Bottlenecks'
import { allocationSources, benchShortName, fnShort, isRuntimeFrame, median } from '../lib/perf'

// Chart fills come from the fixed categorical series order; label text on a
// fill picks near-black or white, whichever contrasts more with that fill.
function contrastOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return '#fff'
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16))
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#1f2328' : '#fff'
}

interface Props {
  benchmarks: BenchmarkResult[] | null
  profile: ProfileData | null
  onScan?: () => void
  scanning?: boolean
  projectName?: string
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
  if (allocs === 0) return { score: 100, label: 'Perfect', color: 'text-success' }
  const ratio = bytes / allocs
  if (ratio >= 64) return { score: 95, label: 'Excellent', color: 'text-success' }
  if (ratio >= 32) return { score: 80, label: 'Good', color: 'text-success' }
  if (ratio >= 16) return { score: 60, label: 'Fair', color: 'text-warning' }
  if (ratio >= 8) return { score: 40, label: 'Poor', color: 'text-orange' }
  return { score: 20, label: 'Bad', color: 'text-danger' }
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
  return benchShortName(full)
}

// ---------------------------------------------------------------------------
// Shared presentational primitives
// ---------------------------------------------------------------------------

function SectionHeader({ icon, iconClass, title, hint }: { icon: React.ReactNode; iconClass: string; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-line">
      <span className={iconClass}>{icon}</span>
      <h3 className="text-base font-bold text-fg">{title}</h3>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </div>
  )
}

function ChartCard({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-line">
        <h4 className="text-sm font-medium text-fg-muted">{title}</h4>
        {caption && <p className="text-xs text-fg-subtle mt-0.5">{caption}</p>}
      </div>
      <div className="relative p-3">{children}</div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  const tone: StatTone = accent === 'text-danger' ? 'danger' : accent === 'text-warning' ? 'warning' : accent === 'text-orange' ? 'orange' : accent === 'text-success' ? 'success' : 'default'
  return <StatTile label={label} value={value} sub={sub} tone={tone} />
}

// ---------------------------------------------------------------------------
// Benchmark: horizontal diverging bar — primary view (time, colored by allocs)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Benchmark scatter — secondary view (time vs allocs, quadrants)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Profile: treemap of hottest functions (area = flat%, grouped by package)
// ---------------------------------------------------------------------------

interface TreeLeaf { name: string; pkg: string; fn: string; value: number; flat: number }

function ProfileTreemap({ entries }: { entries: ProfileEntry[] }) {
  const colors = useThemeColors()
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string }>({ x: 0, y: 0, text: '' })

  useEffect(() => {
    if (!entries.length || !svgRef.current) return
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const sorted = [...entries].filter((e) => e.flat_pct > 0).sort((a, b) => b.flat_pct - a.flat_pct).slice(0, 24)
    if (!sorted.length) return

    const pkgs = Array.from(new Set(sorted.map((e) => extractPkg(e.function))))
    const pkgColor = seriesColorMap(pkgs, colors)

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
      .attr('fill', (d) => pkgColor.get((d.data as TreeLeaf).pkg) || colors.series[0])
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
      const labelColor = contrastOn(pkgColor.get(leaf.pkg) || colors.series[0])
      const t = d3.select(this).append('text')
        .attr('x', 5).attr('y', 14).attr('font-size', '10px').attr('font-weight', 'bold')
        .attr('fill', labelColor).style('pointer-events', 'none')
        .text(leaf.name.length > Math.floor(w / 6) ? leaf.name.slice(0, Math.floor(w / 6)) + '…' : leaf.name)
      if (h >= 40) {
        t.clone(true).attr('y', 28).attr('font-size', '9px').attr('font-weight', 'normal')
          .attr('fill', labelColor).attr('opacity', 0.85).text(`${leaf.value.toFixed(1)}%`)
      }
    })
  }, [entries, colors])

  return (
    <div className="relative">
      <svg ref={svgRef} className="w-full" style={{ height: 360 }} />
      {tooltip.text && (
        <div role="tooltip" className="absolute z-20 pointer-events-none bg-inverse text-white text-xs rounded-lg shadow-xl px-2 py-1 max-w-xs break-all"
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
    <div className="overflow-x-auto bg-surface border border-line rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-fg-muted">
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
              <tr key={i} className="border-b border-line hover:bg-subtle transition-colors">
                <td className="py-2.5 px-4 font-mono text-xs text-fg max-w-md truncate" title={e.function}>
                  {isHot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger-solid mr-1.5 align-middle" />}
                  {e.function}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`font-mono text-xs tabular-nums ${isHot ? 'text-danger font-semibold' : 'text-fg'}`}>{e.flat.toFixed(2)}</span>
                    <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${isHot ? 'bg-danger-solid' : 'bg-accent-solid'}`} style={{ width: `${barW}%` }} />
                    </div>
                  </div>
                </td>
                <td className={`py-2.5 px-4 text-right font-mono text-xs tabular-nums ${isHot ? 'text-danger font-semibold' : 'text-fg'}`}>{e.flat_pct.toFixed(1)}%</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-fg">{e.cum_pct.toFixed(1)}%</td>
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
    const medTime = median(benchmarks.map((b) => b.time_per_op))
    const avgAllocs = benchmarks.reduce((s, b) => s + b.allocs_per_op, 0) / n
    const slowest = benchmarks.reduce((a, b) => (a.time_per_op > b.time_per_op ? a : b))
    const heaviest = benchmarks.reduce((a, b) => (a.allocs_per_op > b.allocs_per_op ? a : b))
    const zeroAlloc = benchmarks.filter((b) => b.allocs_per_op === 0).length
    return { n, avgTime, medTime, avgAllocs, slowest, heaviest, zeroAlloc }
  }, [benchmarks])

  // Runtime, GC and profiler frames are the cost of measuring, not of the
  // code under test; they are hidden unless asked for.
  const [showRuntime, setShowRuntime] = useState(false)
  const rawEntries = profileTab === 'cpu' ? profile?.cpu : profile?.mem
  const activeEntries = useMemo(() => {
    if (!rawEntries) return rawEntries
    return showRuntime ? rawEntries : rawEntries.filter((e) => !isRuntimeFrame(e.function))
  }, [rawEntries, showRuntime])
  const hiddenCount = (rawEntries?.length ?? 0) - (activeEntries?.length ?? 0)
  const sources = useMemo(() => allocationSources(profile, projectName).slice(0, 6), [profile, projectName])
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
      <div className="page">
        <EmptyState message="No performance data available. Run a scan with benchmarks and profiling enabled." onScan={onScan} scanning={scanning} />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="flex items-center justify-between gap-4 mb-6">
        <p className="text-sm text-fg-muted">Benchmarks from <code className="font-mono">go test -bench</code> and CPU/memory profiles of those benchmarks.</p>
        <button onClick={() => setShowPlan(true)} className="btn-secondary shrink-0">
          <Download className="w-4 h-4" aria-hidden="true" />
          Export plan
        </button>
      </div>

      {/* At-a-glance summary cards */}
      {(stats || hottest) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats && (
            <>
              <StatCard label="Benchmarks" value={String(stats.n)} sub={`${stats.zeroAlloc} allocation-free · ${profile?.packages?.length ?? 0} packages profiled`} />
              <StatCard label="Median time/op" value={fmtShortNS(stats.medTime)} sub={stats.avgTime > stats.medTime * 2 ? `mean ${fmtShortNS(stats.avgTime)}, pulled up by ${extractShortName(stats.slowest.name)}` : `mean ${fmtShortNS(stats.avgTime)}`} />
              <StatCard
                label="Slowest"
                value={fmtShortNS(stats.slowest.time_per_op)}
                sub={`${extractShortName(stats.slowest.name)} · ${stats.slowest.allocs_per_op} allocs/op`}
                accent="text-danger"
              />
              <StatCard
                label="Most allocations"
                value={`${stats.heaviest.allocs_per_op}/op`}
                sub={`${extractShortName(stats.heaviest.name)} · ${fmtBytes(stats.heaviest.bytes_per_op)} per op`}
                accent={stats.heaviest.allocs_per_op > 0 ? 'text-orange' : undefined}
              />
            </>
          )}
          {!stats && hottest && (
            <StatCard
              label={`Hottest (${profileTab.toUpperCase()})`}
              value={`${hottest.flat_pct.toFixed(1)}%`}
              sub={fnShort(hottest.function)}
              accent="text-danger "
            />
          )}
        </div>
      )}

      {/* Benchmarking section */}
      {hasBenchmarks && (
        <section className="mb-10">
          <SectionHeader
            iconClass="w-5 h-5 text-accent "
            title="Benchmarking"
            hint={`${benchmarks!.length} benchmarks`}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />

          <Bottlenecks benchmarks={benchmarks!} profile={profile} projectName={projectName} />

          {sources.length > 0 && (
            <div className="card mt-6">
              <div className="px-4 py-3 border-b border-line">
                <h3 className="text-[15px] font-semibold">Allocation sources in your code</h3>
                <p className="text-xs text-fg-subtle">Project functions by share of their package's memory profile (self, excluding callees).</p>
              </div>
              <ul className="px-4 py-3 space-y-1.5">
                {sources.map((src) => (
                  <li key={src.pkg + src.fn} className="grid grid-cols-[minmax(0,1fr)_8rem_3.5rem] items-center gap-3 text-sm">
                    <span className="font-mono text-[13px] truncate" title={src.fn}>{src.short}</span>
                    <span className="h-2 bg-subtle rounded-full overflow-hidden"><span className="block h-full bg-violet rounded-full" style={{ width: `${Math.min(100, src.pct)}%` }} /></span>
                    <span className="font-mono text-xs tabular-nums text-right text-fg-muted">{src.pct.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Profiling section */}
      {hasProfile && (
        <section className="mb-10">
          <SectionHeader
            iconClass="w-5 h-5 text-danger "
            title="Profiling"
            hint={hasCpu && hasMem ? 'CPU + memory' : hasCpu ? 'CPU' : 'memory'}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />

          <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="inline-flex rounded-lg border border-line p-0.5 bg-subtle">
            {hasCpu && (
              <button
                onClick={() => setProfileTab('cpu')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${profileTab === 'cpu' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
              >
                CPU
              </button>
            )}
            {hasMem && (
              <button
                onClick={() => setProfileTab('mem')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${profileTab === 'mem' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
              >
                Memory
              </button>
            )}
          </div>
            <label className="inline-flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <input type="checkbox" checked={showRuntime} onChange={(e) => setShowRuntime(e.target.checked)} className="w-3.5 h-3.5" />
              Show runtime frames{hiddenCount > 0 && !showRuntime ? ` (${hiddenCount} hidden)` : ''}
            </label>
            <p className="text-xs text-fg-subtle">
              Runtime, GC and profiler frames are the cost of measuring. Shares are of each package's own profile, so they don't sum to 100%.
            </p>
          </div>

          {activeEntries && activeEntries.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ChartCard
                title={`${profileTab === 'cpu' ? 'CPU' : 'Memory'} hotspots`}
                caption="Each tile is a function; area = self %, color groups by package. Larger = hotter."
              >
                <ProfileTreemap entries={activeEntries} />
              </ChartCard>
              <div>
                <h4 className="text-sm font-medium text-fg-muted mb-2">
                  Top functions ({profileTab === 'cpu' ? 'self CPU' : 'self memory'})
                </h4>
                <ProfileTable entries={activeEntries} maxFlat={profileMaxFlat} unit={profileTab === 'cpu' ? 's' : 'MB'} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-fg-muted italic">{hiddenCount > 0 ? `Only runtime frames in this profile (${hiddenCount} hidden).` : `No ${profileTab === 'cpu' ? 'CPU' : 'memory'} profile data collected.`}</p>
          )}
        </section>
      )}

      {/* Advice section */}
      <section>
        <SectionHeader
          iconClass="w-5 h-5 text-warning "
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
                    ? 'bg-orange-soft border-orange/30'
                    : s.type === 'info'
                    ? 'bg-accent-soft border-accent/30'
                    : 'bg-success-soft border-success/30'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    {s.type === 'warning' ? (
                      <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86l-8.27 14.31A1 1 0 002.93 20h18.14a1 1 0 00.86-1.53l-8.27-14.31a1 1 0 00-1.72 0z" />
                      </svg>
                    ) : s.type === 'info' ? (
                      <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-fg">{s.title}</div>
                    <div className="text-fg-muted mt-0.5 leading-relaxed">{s.description}</div>
                    {s.benchmark && <div className="text-xs font-mono text-fg-subtle mt-1 truncate">{s.benchmark}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-muted italic">No advice generated. Collect benchmark or profile data to see suggestions.</p>
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
