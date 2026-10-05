import { useEffect, useState } from 'react'

// Hash-based routing so every view has a URL: refresh keeps your place, the
// browser back button works, and links can be shared. The Go server only
// serves index.html at "/", so routes live after the "#".

export type Page =
  | 'dashboard' | 'issues' | 'issue' | 'file' | 'security' | 'deadcode'
  | 'tests' | 'testdetail' | 'performance' | 'depgraph' | 'git' | 'history' | 'config'

export interface Route {
  page: Page
  /** issue id, file path, or test package */
  param?: string
  /** test name */
  param2?: string
}

const SEGMENT: Record<Page, string> = {
  dashboard: '',
  issues: 'issues',
  issue: 'issues',
  file: 'files',
  security: 'security',
  deadcode: 'dead-code',
  tests: 'tests',
  testdetail: 'tests',
  performance: 'performance',
  depgraph: 'dependencies',
  git: 'git',
  history: 'history',
  config: 'settings',
}

export function routeToHash(r: Route): string {
  const parts = [SEGMENT[r.page]]
  if (r.param !== undefined) parts.push(encodeURIComponent(r.param))
  if (r.param2 !== undefined) parts.push(encodeURIComponent(r.param2))
  return '#/' + parts.filter((p, i) => i === 0 || p !== '').join('/')
}

export function parseHash(hash: string): Route {
  const [seg = '', a, b] = hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p))
  switch (seg) {
    case 'issues': return a ? { page: 'issue', param: a } : { page: 'issues' }
    case 'files': return a ? { page: 'file', param: a } : { page: 'issues' }
    case 'tests': return a && b ? { page: 'testdetail', param: a, param2: b } : { page: 'tests' }
    case 'security': return { page: 'security' }
    case 'dead-code': return { page: 'deadcode' }
    case 'performance': return { page: 'performance' }
    case 'dependencies': return { page: 'depgraph' }
    case 'git': return { page: 'git' }
    case 'history': return { page: 'history' }
    case 'settings': return { page: 'config' }
    default: return { page: 'dashboard' }
  }
}

export function navigate(r: Route) {
  const hash = routeToHash(r)
  if (window.location.hash !== hash) window.location.hash = hash
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash))
      document.querySelector('main')?.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
