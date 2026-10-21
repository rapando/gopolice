import type { DepEdge, Dependency } from '../api/client'

export type ModuleKind = 'root' | 'direct' | 'indirect' | 'transitive'

export interface ModuleNode {
  /** Node id as go mod graph prints it: path@version. */
  id: string
  path: string
  version: string
  kind: ModuleKind
  /** Shortest label that is unique in this graph. */
  label: string
}

export function splitModule(id: string): { path: string; version: string } {
  const at = id.lastIndexOf('@')
  return at < 0 ? { path: id, version: '' } : { path: id.slice(0, at), version: id.slice(at + 1) }
}

/**
 * Classifies every module in the graph. Direct and indirect come from
 * go.mod (the deps list); anything else in the graph is transitive only.
 */
export function classifyModules(edges: DepEdge[], deps: Dependency[] | null | undefined): ModuleNode[] {
  const from = new Set(edges.map((e) => e.from))
  const to = new Set(edges.map((e) => e.to))
  const ids = Array.from(new Set([...from, ...to]))
  const direct = new Set((deps ?? []).filter((d) => !d.indirect).map((d) => d.path))
  const indirect = new Set((deps ?? []).filter((d) => d.indirect).map((d) => d.path))

  const parsed = ids.map((id) => ({ id, ...splitModule(id) }))
  const byPath = new Map<string, number>()
  for (const p of parsed) byPath.set(p.path, (byPath.get(p.path) ?? 0) + 1)

  const segsOf = (path: string) => path.split('/')
  const label = (p: { id: string; path: string; version: string }): string => {
    if (p.path === 'go') return `go ${p.version}`
    if (p.path === 'toolchain') return 'toolchain'
    const segs = segsOf(p.path)
    let out = p.path
    for (let k = 1; k <= segs.length; k++) {
      const suffix = segs.slice(-k).join('/')
      const clash = parsed.some((q) => q.path !== p.path && segsOf(q.path).slice(-k).join('/') === suffix)
      if (!clash) { out = suffix; break }
    }
    // Several versions of one module: only the version tells them apart.
    if ((byPath.get(p.path) ?? 0) > 1 && p.version) out += ` ${p.version}`
    return out
  }

  return parsed.map((p) => {
    const isRoot = from.has(p.id) && !to.has(p.id)
    const kind: ModuleKind = isRoot ? 'root' : direct.has(p.path) ? 'direct' : indirect.has(p.path) ? 'indirect' : 'transitive'
    return { id: p.id, path: p.path, version: p.version, kind, label: label(p) }
  })
}

/** Every module reachable from `id` by following requirements. */
export function reachableFrom(id: string, outgoing: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(outgoing.get(id) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    if (seen.has(n)) continue
    seen.add(n)
    for (const m of outgoing.get(n) ?? []) if (!seen.has(m)) stack.push(m)
  }
  return seen
}
