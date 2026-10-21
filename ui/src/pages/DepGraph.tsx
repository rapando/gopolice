import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import { ArrowLeft, ArrowRight, Maximize, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import { DepGraph as DepGraphData, type Dependency } from '../api/client'
import { useThemeColors } from '../hooks/useThemeColors'
import EmptyState from '../components/EmptyState'
import { classifyModules, reachableFrom, type ModuleKind, type ModuleNode } from '../lib/modules'

interface Props {
  depGraph: DepGraphData | null
  /** go.mod's requirements, which say which modules are direct and which are indirect. */
  deps?: Dependency[] | null
  onScan?: () => void
  scanning?: boolean
}

interface GraphNode extends d3.SimulationNodeDatum, ModuleNode {}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
}

function linkEnds(d: GraphLink): [string, string] {
  const src = typeof d.source === 'string' ? d.source : d.source.id
  const tgt = typeof d.target === 'string' ? d.target : d.target.id
  return [src, tgt]
}

const KIND_LABEL: Record<ModuleKind, string> = { root: 'your module', direct: 'direct', indirect: 'indirect', transitive: 'transitive only' }
const KIND_CHIP: Record<ModuleKind, string> = {
  root: 'bg-orange-soft text-orange', direct: 'bg-accent-soft text-accent', indirect: 'bg-violet-soft text-violet', transitive: 'bg-subtle text-fg-muted',
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function DepGraph({ depGraph, deps, onScan, scanning }: Props) {
  const colors = useThemeColors()
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const nodeGroupRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null)
  const linkRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<GraphNode[]>([])

  const edges = useMemo(() => depGraph?.edges ?? [], [depGraph])
  const modules = useMemo(() => classifyModules(edges, deps), [edges, deps])
  const byId = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules])
  const counts = useMemo(() => {
    const c = { root: 0, direct: 0, indirect: 0, transitive: 0 }
    for (const m of modules) c[m.kind]++
    return c
  }, [modules])

  const outgoing = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of edges) {
      if (!m.has(e.from)) m.set(e.from, [])
      m.get(e.from)!.push(e.to)
    }
    return m
  }, [edges])

  const incoming = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of edges) {
      if (!m.has(e.to)) m.set(e.to, [])
      m.get(e.to)!.push(e.from)
    }
    return m
  }, [edges])

  const selectedInfo = useMemo(() => {
    if (!selected) return null
    const node = byId.get(selected)
    if (!node) return null
    const pulls = reachableFrom(selected, outgoing)
    let pullsTransitive = 0
    for (const id of pulls) if (byId.get(id)?.kind === 'transitive') pullsTransitive++
    return {
      node,
      requires: outgoing.get(selected) ?? [],
      requiredBy: incoming.get(selected) ?? [],
      pulls: pulls.size,
      pullsTransitive,
    }
  }, [selected, byId, outgoing, incoming])

  const fillFor = useCallback((kind: ModuleKind) => {
    switch (kind) {
      case 'root': return colors.series[1]
      case 'direct': return colors.series[0]
      case 'indirect': return colors.series[6]
      default: return colors.surface
    }
  }, [colors])
  const strokeFor = useCallback((kind: ModuleKind) => (kind === 'transitive' ? colors.muted : fillFor(kind)), [colors, fillFor])

  /** Zooms so the given nodes (default: all) fill the view. */
  const fitTo = useCallback((nodes: GraphNode[], duration = 450) => {
    const svgEl = svgRef.current
    if (!svgEl || !zoomRef.current || nodes.length === 0) return
    const { width, height } = svgEl.getBoundingClientRect()
    const xs = nodes.map((d) => d.x ?? 0)
    const ys = nodes.map((d) => d.y ?? 0)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 70
    const scale = Math.min(2.5, Math.max(0.1, Math.min(width / (maxX - minX + pad * 2), height / (maxY - minY + pad * 2))))
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
    const sel = d3.select(svgEl)
    if (duration > 0) sel.transition().duration(duration).call(zoomRef.current.transform, t)
    else sel.call(zoomRef.current.transform, t)
  }, [])

  const zoomBy = (k: number) => {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, k)
  }

  useEffect(() => {
    if (!edges.length || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const { width, height } = svgRef.current.getBoundingClientRect()

    const nodes: GraphNode[] = modules.map((n) => ({ ...n }))
    nodesRef.current = nodes
    const nodeIds = new Set(nodes.map((n) => n.id))
    const links: GraphLink[] = edges
      .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }))

    if (nodes.length === 0 || links.length === 0) {
      setError('No graph data to render')
      return
    }

    try {
      const container = svg.append('g')

      // Node radius encodes how many modules depend on it.
      const maxDependents = Math.max(1, ...nodes.map((n) => incoming.get(n.id)?.length ?? 0))
      const radiusScale = d3.scaleSqrt().domain([0, maxDependents]).range([5, 16])
      const nodeRadius = (d: GraphNode) => Math.max(d.kind === 'root' ? 9 : 5, radiusScale(incoming.get(d.id)?.length ?? 0))

      // The layout is computed up front and fitted to the panel, so nothing
      // is clipped and the graph doesn't drift under the cursor.
      const simulation = d3.forceSimulation<GraphNode>(nodes)
        .force('link', d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance((l) => ((l.source as GraphNode).kind === 'root' ? 170 : 95)).strength(0.5))
        .force('charge', d3.forceManyBody().strength(-420))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 28))
        .stop()
      for (let i = 0; i < 300; i++) simulation.tick()

      container.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', colors.muted)

      const link = container.append('g')
        .selectAll<SVGLineElement, GraphLink>('line')
        .data(links)
        .join('line')
        .attr('stroke', colors.muted)
        .attr('stroke-width', 1.25)
        .attr('stroke-opacity', 0.45)
        .attr('marker-end', 'url(#arrowhead)')
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!)
      linkRef.current = link

      const group = container.append('g')
        .selectAll<SVGGElement, GraphNode>('g')
        .data(nodes)
        .join('g')
        .attr('cursor', 'pointer')
        .attr('transform', (d) => `translate(${d.x},${d.y})`)
      nodeGroupRef.current = group

      group.append('circle')
        .attr('r', nodeRadius)
        .attr('fill', (d) => fillFor(d.kind))
        .attr('fill-opacity', (d) => (d.kind === 'indirect' ? 0.8 : 1))
        .attr('stroke', (d) => strokeFor(d.kind))
        .attr('stroke-width', 2)

      group.append('text')
        .text((d) => d.label)
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => -nodeRadius(d) - 6)
        .attr('font-size', '12px')
        .attr('font-family', 'Inter Variable, sans-serif')
        .attr('font-weight', (d) => (d.kind === 'root' ? 600 : 400))
        .attr('fill', (d) => (d.kind === 'transitive' ? colors.muted : colors.text))
        .attr('stroke', colors.surface)
        .attr('stroke-width', 3)
        .attr('paint-order', 'stroke')
        .style('pointer-events', 'none')

      group
        .on('mouseover', (event: MouseEvent, d) => {
          const rect = wrapRef.current!.getBoundingClientRect()
          setTooltip({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12, text: `${d.id} · ${KIND_LABEL[d.kind]}` })
        })
        .on('mouseout', () => setTooltip(null))
        .on('click', (event: MouseEvent, d) => {
          event.stopPropagation()
          setSelected(d.id)
        })

      svg.on('click', () => setSelected(null))

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 5])
        .filter((event: Event) => {
          if (event.type === 'wheel') return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey
          return !(event as MouseEvent).button
        })
        .on('zoom', (event) => container.attr('transform', event.transform))

      zoomRef.current = zoom
      svg.call(zoom).on('dblclick.zoom', null)
      fitTo(nodes, 0)
    } catch (err) {
      setError('Failed to render graph: ' + (err instanceof Error ? err.message : String(err)))
    }

    return () => {
      setError(null)
      nodeGroupRef.current = null
      linkRef.current = null
      zoomRef.current = null
    }
  }, [edges, modules, colors, incoming, fitTo, fillFor, strokeFor])

  // Highlight the selected node, what it requires and what requires it; or,
  // when nothing is selected, the nodes matching the filter.
  useEffect(() => {
    if (!nodeGroupRef.current || !linkRef.current) return
    const q = searchQuery.trim().toLowerCase()
    const matchesQuery = (n: GraphNode) => !q || n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)

    const related = new Set<string>()
    if (selected) {
      related.add(selected)
      for (const d of outgoing.get(selected) ?? []) related.add(d)
      for (const d of incoming.get(selected) ?? []) related.add(d)
    }

    let matches = 0
    nodeGroupRef.current.each(function (d) {
      const visible = selected ? related.has(d.id) : matchesQuery(d)
      if (q && matchesQuery(d)) matches++
      const g = d3.select(this)
      g.select('circle')
        .attr('opacity', visible ? 1 : 0.12)
        .attr('stroke', selected === d.id ? colors.text : strokeFor(d.kind))
        .attr('stroke-width', selected === d.id ? 3 : 2)
      g.select('text').attr('opacity', visible ? 1 : 0.12)
    })

    linkRef.current.each(function (d) {
      const [src, tgt] = linkEnds(d)
      const line = d3.select(this)
      if (selected) {
        const out = src === selected
        const inc = tgt === selected
        line
          .attr('stroke', out ? colors.series[0] : inc ? colors.series[1] : colors.muted)
          .attr('stroke-opacity', out || inc ? 0.9 : 0.05)
          .attr('stroke-width', out || inc ? 2.5 : 1)
      } else {
        const visible = matchesQuery(byId.get(src)!) || matchesQuery(byId.get(tgt)!)
        line.attr('stroke', colors.muted).attr('stroke-width', 1.25).attr('stroke-opacity', visible ? 0.45 : 0.04)
      }
    })

    setMatchCount(q ? matches : null)
  }, [selected, searchQuery, outgoing, incoming, colors, byId, strokeFor])

  // Bring filter matches into view.
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return
    const id = setTimeout(() => {
      const hits = nodesRef.current.filter((n) => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q))
      if (hits.length) fitTo(hits)
    }, 250)
    return () => clearTimeout(id)
  }, [searchQuery, fitTo])

  if (!depGraph || !edges.length) {
    return (
      <div className="page">
        <EmptyState message="No dependency graph available." onScan={onScan} scanning={scanning} />
      </div>
    )
  }

  const labelOf = (id: string) => byId.get(id)?.label ?? id

  return (
    <div className="h-full min-h-[560px] flex flex-col p-4 sm:p-6 gap-3">
      {error && (
        <div className="p-3 bg-danger-soft border border-danger/30 rounded-md text-sm text-danger">{error}</div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-72 max-w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelected(null) }}
            placeholder="Filter modules…"
            aria-label="Filter modules"
            className="input w-full pl-8"
          />
        </div>
        <span className="text-sm text-fg-muted tabular-nums" aria-live="polite">
          {matchCount === null ? (
            <>
              <b className="text-fg font-semibold">{modules.length}</b> modules · <b className="text-fg font-semibold">{counts.direct}</b> direct · <b className="text-fg font-semibold">{counts.indirect}</b> indirect · <b className="text-fg font-semibold">{counts.transitive}</b> transitive only · <b className="text-fg font-semibold">{edges.length}</b> edges
            </>
          ) : matchCount === 0 ? 'No matches' : `${matchCount} of ${modules.length} match`}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-sm text-fg-muted flex-wrap" aria-label="Legend">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.series[1] }} /> Your module</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.series[0] }} /> Direct</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full opacity-80" style={{ backgroundColor: colors.series[6] }} /> Indirect <span className="text-fg-subtle">(in go.mod)</span></span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2" style={{ borderColor: colors.muted }} /> Transitive only</span>
          <span className="flex items-center gap-1" title="Node size = number of modules that require it">
            <span className="w-1.5 h-1.5 rounded-full bg-line-strong" /><span className="w-2.5 h-2.5 rounded-full bg-line-strong" /><span className="w-3.5 h-3.5 rounded-full bg-line-strong" /> Dependents
          </span>
        </div>
      </div>

      {/* Graph */}
      <div ref={wrapRef} className="relative flex-1 min-h-0 card overflow-hidden">
        <svg ref={svgRef} className="w-full h-full block" role="img" aria-label="Module dependency graph" />

        <div className="absolute left-3 bottom-3 flex items-center gap-2">
          <div className="flex rounded-md border border-line bg-surface shadow-sm">
            <IconButton label="Zoom in" onClick={() => zoomBy(1.4)}><ZoomIn className="w-4 h-4" /></IconButton>
            <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.4)}><ZoomOut className="w-4 h-4" /></IconButton>
            <IconButton label="Fit to view" onClick={() => fitTo(nodesRef.current)}><Maximize className="w-4 h-4" /></IconButton>
          </div>
          <span className="text-xs text-fg-muted bg-surface/90 px-2 py-1 rounded border border-line">
            Drag to pan · <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'}</kbd> + scroll to zoom · click a module for details
          </span>
        </div>

        {tooltip && (
          <div
            role="tooltip"
            className="absolute z-10 px-2.5 py-1.5 text-xs font-mono bg-inverse text-white rounded-md shadow-lg pointer-events-none max-w-sm break-all"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.text}
          </div>
        )}

        {selectedInfo && (
          <aside className="absolute top-3 right-3 bottom-3 w-96 max-w-[calc(100%-1.5rem)] flex flex-col card shadow-lg">
            <header className="px-4 py-3 border-b border-line flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold font-mono truncate flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fillFor(selectedInfo.node.kind), border: `2px solid ${strokeFor(selectedInfo.node.kind)}` }} />
                  <span className="truncate" title={selectedInfo.node.path}>{selectedInfo.node.path}</span>
                  <span className={`shrink-0 text-[11px] font-sans font-medium px-1.5 py-0.5 rounded-full ${KIND_CHIP[selectedInfo.node.kind]}`}>{KIND_LABEL[selectedInfo.node.kind]}</span>
                </h3>
                <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {selectedInfo.node.version && <><dt className="text-fg-subtle">Version</dt><dd className="font-mono">{selectedInfo.node.version}</dd></>}
                  <dt className="text-fg-subtle">Requires</dt><dd className="font-mono">{selectedInfo.requires.length} module{selectedInfo.requires.length === 1 ? '' : 's'}</dd>
                  <dt className="text-fg-subtle">Required by</dt><dd className="font-mono">{selectedInfo.requiredBy.length === 0 ? 'nothing' : selectedInfo.requiredBy.map(labelOf).join(', ')}</dd>
                  {selectedInfo.pulls > 0 && <><dt className="text-fg-subtle">Pulls in</dt><dd className="font-mono">{selectedInfo.pulls} module{selectedInfo.pulls === 1 ? '' : 's'}{selectedInfo.pullsTransitive > 0 ? ` · ${selectedInfo.pullsTransitive} of the ${counts.transitive} transitive-only` : ''}</dd></>}
                </dl>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close details" className="btn-ghost p-1">
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              <ModuleList
                title="Requires"
                Icon={ArrowRight}
                tone={colors.series[0]}
                items={selectedInfo.requires}
                byId={byId}
                empty="Requires nothing"
                onSelect={setSelected}
              />
              <ModuleList
                title="Required by"
                Icon={ArrowLeft}
                tone={colors.series[1]}
                items={selectedInfo.requiredBy}
                byId={byId}
                empty="Nothing requires this (your module)"
                onSelect={setSelected}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="p-1.5 text-fg-muted hover:text-fg hover:bg-subtle first:rounded-l-md last:rounded-r-md">
      {children}
    </button>
  )
}

function ModuleList({ title, Icon, tone, items, byId, empty, onSelect }: {
  title: string
  Icon: typeof ArrowRight
  tone: string
  items: string[]
  byId: Map<string, ModuleNode>
  empty: string
  onSelect: (id: string) => void
}) {
  return (
    <section className="px-4 py-3 border-b border-line last:border-b-0">
      <h4 className="label mb-2 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color: tone }} aria-hidden="true" />
        {title} <span className="font-normal normal-case tracking-normal">({items.length})</span>
      </h4>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((dep) => {
            const m = byId.get(dep)
            return (
              <li key={dep}>
                <button onClick={() => onSelect(dep)} className="w-full text-left px-2 py-1 rounded hover:bg-subtle flex items-center gap-2 min-w-0" title={dep}>
                  <span className="text-sm text-fg truncate font-mono">{m?.label ?? dep}</span>
                  {m?.version && <span className="text-xs font-mono text-fg-subtle shrink-0">{m.version}</span>}
                  {m && m.kind !== 'root' && <span className={`ml-auto shrink-0 text-[10px] font-medium px-1.5 py-px rounded-full ${KIND_CHIP[m.kind]}`}>{KIND_LABEL[m.kind]}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
