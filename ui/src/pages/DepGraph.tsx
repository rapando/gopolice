import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import { ArrowLeft, ArrowRight, Maximize, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import { DepGraph as DepGraphData } from '../api/client'
import { useThemeColors } from '../hooks/useThemeColors'
import EmptyState from '../components/EmptyState'

interface Props {
  depGraph: DepGraphData | null
  onScan?: () => void
  scanning?: boolean
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  isRoot: boolean
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
}

function extractShortName(full: string): string {
  const atIdx = full.lastIndexOf('@')
  const nameOnly = atIdx >= 0 ? full.slice(0, atIdx) : full
  const parts = nameOnly.split('/')
  return parts[parts.length - 1] || nameOnly
}

function linkEnds(d: GraphLink): [string, string] {
  const src = typeof d.source === 'string' ? d.source : d.source.id
  const tgt = typeof d.target === 'string' ? d.target : d.target.id
  return [src, tgt]
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function DepGraph({ depGraph, onScan, scanning }: Props) {
  const colors = useThemeColors()
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchCount, setMatchCount] = useState<number | null>(null)
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const nodeGroupRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null)
  const linkRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<GraphNode[]>([])

  const edges = useMemo(() => depGraph?.edges ?? [], [depGraph])

  const allNodes = useMemo(() => {
    const from = new Set(edges.map((e) => e.from))
    const to = new Set(edges.map((e) => e.to))
    return Array.from(new Set([...from, ...to])).map((id) => ({ id, isRoot: from.has(id) && !to.has(id) }))
  }, [edges])

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

  const selectedInfo = selected ? {
    id: selected,
    shortName: extractShortName(selected),
    deps: outgoing.get(selected) ?? [],
    dependents: incoming.get(selected) ?? [],
  } : null

  /** Zooms so the given nodes (default: all) fill the view. */
  const fitTo = useCallback((nodes: GraphNode[], duration = 450) => {
    const svgEl = svgRef.current
    if (!svgEl || !zoomRef.current || nodes.length === 0) return
    const { width, height } = svgEl.getBoundingClientRect()
    const xs = nodes.map((d) => d.x ?? 0)
    const ys = nodes.map((d) => d.y ?? 0)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 60
    const scale = Math.min(2.5, Math.max(0.1, Math.min(width / (maxX - minX + pad * 2), height / (maxY - minY + pad * 2))))
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
    d3.select(svgEl).transition().duration(duration).call(zoomRef.current.transform, t)
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

    const nodes: GraphNode[] = allNodes.map((n) => ({ ...n }))
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

      // Node radius encodes how many modules depend on it, so the most
      // relied-upon modules stand out in large graphs.
      const maxDependents = Math.max(1, ...nodes.map((n) => incoming.get(n.id)?.length ?? 0))
      const radiusScale = d3.scaleSqrt().domain([0, maxDependents]).range([5, 18])
      const nodeRadius = (d: GraphNode) => Math.max(d.isRoot ? 9 : 5, radiusScale(incoming.get(d.id)?.length ?? 0))

      const simulation = d3.forceSimulation<GraphNode>(nodes)
        .force('link', d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(110))
        .force('charge', d3.forceManyBody().strength(-420))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 16))

      simulationRef.current = simulation

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

      linkRef.current = link

      const group = container.append('g')
        .selectAll<SVGGElement, GraphNode>('g')
        .data(nodes)
        .join('g')
        .attr('cursor', 'pointer')

      nodeGroupRef.current = group

      group.append('circle')
        .attr('r', nodeRadius)
        .attr('fill', (d) => d.isRoot ? colors.series[1] : colors.series[0])
        .attr('stroke', colors.surface)
        .attr('stroke-width', 2)

      // Labels get a halo in the surface color so they stay readable over edges.
      group.append('text')
        .text((d) => extractShortName(d.id))
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => -nodeRadius(d) - 6)
        .attr('font-size', '12px')
        .attr('font-family', 'Inter Variable, sans-serif')
        .attr('fill', colors.text)
        .attr('stroke', colors.surface)
        .attr('stroke-width', 3)
        .attr('paint-order', 'stroke')
        .style('pointer-events', 'none')

      group
        .on('mouseover', (event: MouseEvent, d) => {
          const rect = wrapRef.current!.getBoundingClientRect()
          setTooltip({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12, text: d.id })
        })
        .on('mouseout', () => setTooltip(null))
        .on('click', (event: MouseEvent, d) => {
          event.stopPropagation()
          setSelected(d.id)
        })

      svg.on('click', () => setSelected(null))

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 5])
        // A plain mouse wheel scrolls the page; zoom needs ⌘/Ctrl (trackpad
        // pinch also sends ctrlKey). Without this the graph swallowed every
        // wheel event and the page couldn't be scrolled.
        .filter((event: Event) => {
          if (event.type === 'wheel') return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey
          return !(event as MouseEvent).button
        })
        .on('zoom', (event) => container.attr('transform', event.transform))

      zoomRef.current = zoom
      svg.call(zoom).on('dblclick.zoom', null)

      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as GraphNode).x!)
          .attr('y1', (d) => (d.source as GraphNode).y!)
          .attr('x2', (d) => (d.target as GraphNode).x!)
          .attr('y2', (d) => (d.target as GraphNode).y!)
        group.attr('transform', (d) => `translate(${d.x},${d.y})`)
      })
      simulation.on('end', () => fitTo(nodes, 600))
    } catch (err) {
      setError('Failed to render graph: ' + (err instanceof Error ? err.message : String(err)))
    }

    return () => {
      setError(null)
      simulationRef.current?.stop()
      simulationRef.current = null
      nodeGroupRef.current = null
      linkRef.current = null
      zoomRef.current = null
    }
  }, [edges, allNodes, colors, incoming, fitTo])

  // Highlight the selected node, its dependencies and its dependents; or, when
  // nothing is selected, the nodes matching the filter.
  useEffect(() => {
    if (!nodeGroupRef.current || !linkRef.current) return
    const q = searchQuery.trim().toLowerCase()
    const matchesQuery = (id: string) => !q || id.toLowerCase().includes(q)

    const related = new Set<string>()
    if (selected) {
      related.add(selected)
      for (const d of outgoing.get(selected) ?? []) related.add(d)
      for (const d of incoming.get(selected) ?? []) related.add(d)
    }

    let matches = 0
    nodeGroupRef.current.each(function (d) {
      const visible = selected ? related.has(d.id) : matchesQuery(d.id)
      if (q && matchesQuery(d.id)) matches++
      const g = d3.select(this)
      g.select('circle')
        .attr('opacity', visible ? 1 : 0.12)
        .attr('stroke', selected === d.id ? colors.text : colors.surface)
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
        const visible = matchesQuery(src) || matchesQuery(tgt)
        line.attr('stroke', colors.muted).attr('stroke-width', 1.25).attr('stroke-opacity', visible ? 0.45 : 0.04)
      }
    })

    setMatchCount(q ? matches : null)
  }, [selected, searchQuery, outgoing, incoming, colors])

  // Bring filter matches into view.
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return
    const id = setTimeout(() => {
      const hits = nodesRef.current.filter((n) => n.id.toLowerCase().includes(q))
      if (hits.length) fitTo(hits)
    }, 250)
    return () => clearTimeout(id)
  }, [searchQuery, fitTo])

  if (!depGraph || !edges.length) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <EmptyState message="No dependency graph available." onScan={onScan} scanning={scanning} />
      </div>
    )
  }

  const rootCount = allNodes.filter((n) => n.isRoot).length

  return (
    <div className="h-full min-h-[560px] flex flex-col p-6 gap-3">
      {error && (
        <div className="p-3 bg-danger-soft border border-danger/30 rounded-md text-sm text-danger">{error}</div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-72">
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
          {matchCount === null
            ? `${allNodes.length} modules · ${edges.length} edges`
            : matchCount === 0 ? 'No matches' : `${matchCount} of ${allNodes.length} match`}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-sm text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.series[1] }} /> Your module{rootCount === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors.series[0] }} /> Dependency
          </span>
          <span>Size = number of dependents</span>
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
                <h3 className="text-sm font-semibold truncate">{selectedInfo.shortName}</h3>
                <p className="mt-0.5 text-xs font-mono text-fg-muted break-all">{selectedInfo.id}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close details" className="btn-ghost p-1">
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              <ModuleList
                title="Depends on"
                Icon={ArrowRight}
                tone={colors.series[0]}
                items={selectedInfo.deps}
                empty="No dependencies"
                onSelect={setSelected}
              />
              <ModuleList
                title="Used by"
                Icon={ArrowLeft}
                tone={colors.series[1]}
                items={selectedInfo.dependents}
                empty="Nothing depends on this (root module)"
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

function ModuleList({ title, Icon, tone, items, empty, onSelect }: {
  title: string
  Icon: typeof ArrowRight
  tone: string
  items: string[]
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
          {items.map((dep) => (
            <li key={dep}>
              <button
                onClick={() => onSelect(dep)}
                className="w-full text-left px-2 py-1 rounded hover:bg-subtle"
                title={dep}
              >
                <span className="block text-sm text-fg truncate">{extractShortName(dep)}</span>
                <span className="block text-xs font-mono text-fg-muted truncate">{dep}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
