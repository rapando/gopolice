import { useRef, useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!depGraph || !depGraph.edges || depGraph.edges.length === 0 || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = svgRef.current.clientWidth
    const height = Math.max(600, window.innerHeight - 240)

    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const rootModules = new Set(depGraph.edges.map((e) => e.from))
    const depModules = new Set(depGraph.edges.map((e) => e.to))

    const nodeIds = new Set([...rootModules, ...depModules])
    const nodes: GraphNode[] = Array.from(nodeIds).map((id) => ({
      id,
      isRoot: rootModules.has(id) && !depModules.has(id),
    }))

    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const links: GraphLink[] = depGraph.edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }))

    if (nodes.length === 0 || links.length === 0) {
      setError('No graph data to render')
      return
    }

    try {
      const container = svg.append('g').attr('class', 'graph-container')

      const simulation = d3.forceSimulation<GraphNode>(nodes)
        .force('link', d3.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-400))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30))

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

      const group = container.append('g')
        .selectAll<SVGGElement, GraphNode>('g')
        .data(nodes)
        .join('g')
        .attr('cursor', 'pointer')

      group.append('circle')
        .attr('r', (d) => d.isRoot ? 10 : 7)
        .attr('fill', (d) => d.isRoot ? '#f59e0b' : '#6366f1')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)

      group.append('text')
        .text((d) => extractShortName(d.id))
        .attr('text-anchor', 'middle')
        .attr('dy', (d) => d.isRoot ? -16 : -12)
        .attr('font-size', '10px')
        .attr('fill', '#475569')
        .attr('class', 'dark:fill-ctp-subtext1')
        .style('pointer-events', 'none')

      group.on('mouseover', (event: MouseEvent, d) => {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({ x: event.clientX - rect.left + 10, y: event.clientY - rect.top - 10, text: d.id })
      })
        .on('mouseout', () => setTooltip(null))

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
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
    }
  }, [depGraph])

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Dependency Graph</h2>

      {!depGraph || !depGraph.edges || depGraph.edges.length === 0 ? (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0 mb-4">No dependency graph available.</p>
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
        <div className="relative">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-ctp-surface0 border border-red-200 dark:border-ctp-surface1 rounded text-sm text-red-700 dark:text-ctp-red">
              {error}
            </div>
          )}
          <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200 dark:border-ctp-surface1 text-xs text-gray-500 dark:text-ctp-overlay0 flex items-center gap-4">
              <span><span className="inline-block w-3 h-3 rounded-full bg-amber-400 mr-1 align-middle" /> Root module</span>
              <span><span className="inline-block w-3 h-3 rounded-full bg-indigo-400 mr-1 align-middle" /> Dependency</span>
              <span className="ml-auto">{depGraph.edges.length} edges, {new Set(depGraph.edges.flatMap((e) => [e.from, e.to])).size} nodes</span>
            </div>
            <svg ref={svgRef} className="w-full" style={{ height: '70vh', minHeight: 400 }} />
          </div>
          {tooltip && (
            <div
              className="absolute z-10 px-3 py-1.5 text-xs bg-gray-900 text-white rounded shadow-lg pointer-events-none max-w-sm break-all"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              {tooltip.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
