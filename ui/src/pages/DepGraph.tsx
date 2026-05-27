import { useRef, useEffect, useState, useMemo } from 'react'
import { DepGraph as DepGraphData } from '../api/client'
import * as d3 from 'd3'

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

export default function DepGraph({ depGraph, onScan, scanning }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showPanel, setShowPanel] = useState(false)
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const nodeGroupRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null)
  const linkRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null>(null)

  const edges = depGraph?.edges ?? []
  const allNodes = useMemo(() => {
    if (!edges.length) return []
    const rootModules = new Set(edges.map((e) => e.from))
    const depModules = new Set(edges.map((e) => e.to))
    const nodeIds = new Set([...rootModules, ...depModules])
    return Array.from(nodeIds).map((id) => ({
      id,
      isRoot: rootModules.has(id) && !depModules.has(id),
    }))
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

  useEffect(() => {
    if (!depGraph || !edges.length || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = Math.max(700, window.innerHeight - 200)

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const rootModules = new Set(edges.map((e) => e.from))
    const depModules = new Set(edges.map((e) => e.to))

    const nodeIds = new Set([...rootModules, ...depModules])
    const nodes: GraphNode[] = Array.from(nodeIds).map((id) => ({
      id,
      isRoot: rootModules.has(id) && !depModules.has(id),
    }))

    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const links: GraphLink[] = edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }))

    if (nodes.length === 0 || links.length === 0) {
      setError('No graph data to render')
      return
    }

    try {
      const container = svg.append('g').attr('class', 'graph-container')

      const simulation = d3.forceSimulation<GraphNode>(nodes)
        .force('link', d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(130))
        .force('charge', d3.forceManyBody().strength(-500))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(35))

      simulationRef.current = simulation

      const defs = container.append('defs')
      defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 22)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#94a3b8')

      const link = container.append('g')
        .selectAll<SVGLineElement, GraphLink>('line')
        .data(links)
        .join('line')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6)
        .attr('marker-end', 'url(#arrowhead)')

      linkRef.current = link

      const group = container.append('g')
        .selectAll<SVGGElement, GraphNode>('g')
        .data(nodes)
        .join('g')
        .attr('cursor', 'pointer')

      nodeGroupRef.current = group

      group.append('circle')
        .attr('r', (d) => d.isRoot ? 11 : 8)
        .attr('fill', (d) => d.isRoot ? '#f59e0b' : '#6366f1')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2.5)

      group.append('text')
        .text((d) => extractShortName(d.id))
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => d.isRoot ? -18 : -14)
        .attr('font-size', '11px')
        .attr('fill', '#475569')
        .attr('class', 'dark:fill-ctp-subtext1')
        .style('pointer-events', 'none')

      group.on('mouseover', (event: MouseEvent, d) => {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({ x: event.clientX - rect.left + 10, y: event.clientY - rect.top - 10, text: d.id })
      })
        .on('mouseout', () => setTooltip(null))
        .on('click', (_event: MouseEvent, d) => {
          setSelected(d.id)
          setShowPanel(true)
        })

      // Reset selection on background click
      svg.on('click', (event: MouseEvent) => {
        if ((event.target as Element).tagName === 'svg') {
          setSelected(null)
          setShowPanel(false)
        }
      })

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 5])
        .on('zoom', (event) => {
          container.attr('transform', event.transform)
        })

      svg.call(zoom)

      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as GraphNode).x!)
          .attr('y1', (d) => (d.source as GraphNode).y!)
          .attr('x2', (d) => (d.target as GraphNode).x!)
          .attr('y2', (d) => (d.target as GraphNode).y!)

        group.attr('transform', (d) => `translate(${d.x},${d.y})`)
      })
    } catch (err) {
      setError('Failed to render graph: ' + (err instanceof Error ? err.message : String(err)))
    }

    return () => {
      setError(null)
      simulationRef.current?.stop()
      simulationRef.current = null
      nodeGroupRef.current = null
      linkRef.current = null
    }
  }, [depGraph])

  useEffect(() => {
    if (!nodeGroupRef.current || !linkRef.current) return

    const related = new Set<string>()
    if (selected) {
      related.add(selected)
      for (const d of (outgoing.get(selected) ?? [])) related.add(d)
      for (const d of (incoming.get(selected) ?? [])) related.add(d)
    }

    nodeGroupRef.current.each(function (d) {
      const group = d3.select(this)
      const circle = group.select('circle')
      const text = group.select('text')
      const isMatching = !selected || related.has(d.id)

      circle
        .attr('opacity', isMatching ? 1 : 0.15)
        .attr('stroke-width', selected === d.id ? 3.5 : 2.5)
        .attr('stroke', selected === d.id ? '#f59e0b' : '#fff')

      text.attr('opacity', isMatching ? 1 : 0.15)
    })

    const selectedOut = new Set(selected ? outgoing.get(selected) ?? [] : [])
    const selectedIn = new Set(selected ? incoming.get(selected) ?? [] : [])

    linkRef.current.each(function (d) {
      const src = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id
      const tgt = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id
      const line = d3.select(this)

      if (!selected) {
        line.attr('stroke-opacity', 0.6)
          .attr('stroke', '#94a3b8')
          .attr('stroke-width', 1.5)
        return
      }

      const isFromSelected = src === selected && selectedOut.has(tgt)
      const isToSelected = tgt === selected && selectedIn.has(src)

      if (isFromSelected) {
        line.attr('stroke', '#22c55e')
          .attr('stroke-opacity', 1)
          .attr('stroke-width', 3)
      } else if (isToSelected) {
        line.attr('stroke', '#3b82f6')
          .attr('stroke-opacity', 1)
          .attr('stroke-width', 3)
      } else {
        line.attr('stroke-opacity', 0.06)
          .attr('stroke', '#94a3b8')
          .attr('stroke-width', 0.5)
      }
    })
  }, [selected, outgoing, incoming])

  useEffect(() => {
    if (!nodeGroupRef.current || !linkRef.current) return
    const q = searchQuery.toLowerCase()

    nodeGroupRef.current.each(function (d) {
      const matches = !q || d.id.toLowerCase().includes(q) || extractShortName(d.id).toLowerCase().includes(q)
      d3.select(this).select('circle').attr('opacity', matches ? 1 : 0.08)
      d3.select(this).select('text').attr('opacity', matches ? 1 : 0.08)
    })

    linkRef.current.each(function (d) {
      const src = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id
      const tgt = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id
      const matches = !q || src.toLowerCase().includes(q) || tgt.toLowerCase().includes(q) ||
        extractShortName(src).toLowerCase().includes(q) || extractShortName(tgt).toLowerCase().includes(q)
      d3.select(this).attr('stroke-opacity', matches ? 0.3 : 0.02)
    })
  }, [searchQuery])

  const handleClosePanel = () => {
    setSelected(null)
    setShowPanel(false)
  }

  return (
    <div className="mx-auto p-8" style={{ maxWidth: 'min(95vw, 1600px)' }}>
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-4">Dependency Graph</h2>

      {!depGraph || !depGraph.edges || depGraph.edges.length === 0 ? (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-subtext0 mb-4">No dependency graph available.</p>
          {onScan && (
            <button
              onClick={onScan}
              disabled={scanning}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {scanning ? 'Scanning...' : 'Run Scan'}
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Graph area */}
          <div className={`flex-1 min-w-0 ${showPanel ? 'w-3/5' : 'w-full'}`}>
            {error && (
              <div className="mb-3 p-3 bg-red-50 dark:bg-ctp-surface0 border border-red-200 dark:border-ctp-surface1 rounded text-sm text-red-700 dark:text-ctp-red">
                {error}
              </div>
            )}

            {/* Search + legend bar */}
            <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-t">
              <div className="px-4 py-2.5 border-b border-gray-200 dark:border-ctp-surface1 flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px] max-w-sm">
                  <svg
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-ctp-subtext1 pointer-events-none"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter dependencies..."
                    className="w-full pl-8 pr-7 py-1.5 text-xs rounded border border-gray-300 dark:border-ctp-surface1 bg-gray-50 dark:bg-ctp-base text-gray-700 dark:text-ctp-text focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-ctp-sky"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-ctp-subtext0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-ctp-subtext0 shrink-0">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" /> Root
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-400" /> Dep
                  </span>
                  {!searchQuery && (
                    <span className="text-gray-400 dark:text-ctp-subtext1 ml-1">
                      {edges.length} edges &middot; {allNodes.length} nodes
                    </span>
                  )}
                  {searchQuery && (
                    <span className="text-gray-400 dark:text-ctp-subtext1 ml-1">
                      filtered
                    </span>
                  )}
                </div>
              </div>
              <svg ref={svgRef} className="w-full" style={{ height: '78vh', minHeight: 500 }} />
            </div>

            {tooltip && (
              <div
                className="absolute z-10 px-3 py-1.5 text-xs bg-gray-900 text-white rounded shadow-lg pointer-events-none max-w-sm break-all"
                style={{ left: tooltip.x, top: tooltip.y }}
              />
            )}
          </div>

          {/* Info panel */}
          {showPanel && selectedInfo && (
            <div className="w-96 shrink-0 bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-lg shadow-lg self-start sticky top-20 max-h-[80vh] overflow-y-auto">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-ctp-surface1 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-ctp-text truncate">
                  {selectedInfo.shortName}
                </h3>
                <button
                  onClick={handleClosePanel}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-ctp-subtext0 shrink-0 ml-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-4 py-3 border-b border-gray-100 dark:border-ctp-surface1">
                <p className="text-xs font-mono text-gray-500 dark:text-ctp-subtext1 break-all leading-relaxed">{selectedInfo.id}</p>
              </div>

              {/* Dependencies (outgoing) */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-ctp-surface1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-ctp-subtext1 mb-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Dependencies ({selectedInfo.deps.length})
                </h4>
                {selectedInfo.deps.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-ctp-subtext0 italic">None</p>
                ) : (
                  <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                    {selectedInfo.deps.map((dep) => (
                      <li key={dep}>
                        <button
                          onClick={() => setSelected(dep)}
                          className="text-xs text-left w-full px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-ctp-surface1 text-gray-700 dark:text-ctp-subtext0 font-mono truncate"
                        >
                          <span className="text-green-500 mr-1.5">→</span>
                          {extractShortName(dep)}
                          <span className="text-gray-400 dark:text-ctp-subtext1 ml-1.5 text-[10px]">{dep}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Dependents (incoming) */}
              <div className="px-4 py-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-ctp-subtext1 mb-2 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                  </svg>
                  Used by ({selectedInfo.dependents.length})
                </h4>
                {selectedInfo.dependents.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-ctp-subtext0 italic">None (root module)</p>
                ) : (
                  <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                    {selectedInfo.dependents.map((dep) => (
                      <li key={dep}>
                        <button
                          onClick={() => setSelected(dep)}
                          className="text-xs text-left w-full px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-ctp-surface1 text-gray-700 dark:text-ctp-subtext0 font-mono truncate"
                        >
                          <span className="text-blue-500 mr-1.5">←</span>
                          {extractShortName(dep)}
                          <span className="text-gray-400 dark:text-ctp-subtext1 ml-1.5 text-[10px]">{dep}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
