const BASE = ''

export interface Issue {
  id: string
  scanner: string
  rule: string
  severity: string
  file: string
  line: number
  column: number
  message: string
  category: string
  solution: string
  git_blame: BlameInfo | null
}

export interface BlameInfo {
  author: string
  email: string
  commit: string
  date: string
  line: number
}

export interface ScanResult {
  project_name: string
  scan_time: string
  duration: number
  issues: Issue[]
  test_results: TestResult | null
  deps: Dependency[] | null
  git_info: GitInfo | null
  file_stats: FileStat[] | null
  total_files: number
  go_files: number
  total_lines: number
}

export interface TestResult {
  packages: TestPackage[]
  total: TestSummary
}

export interface TestPackage {
  name: string
  status: string
  duration: number
  coverage: number
  tests: Test[]
}

export interface Test {
  name: string
  status: string
  duration: number
  output: string
  file?: string
  line?: number
}

export interface TestSummary {
  total: number
  passed: number
  failed: number
  skipped: number
}

export interface Dependency {
  path: string
  version: string
  indirect: boolean
}

export interface GitInfo {
  branch: string
  commit: string
  commit_time: string
  author_count: number
}

export interface FileStat {
  path: string
  lines: number
  code_lines: number
  comment_lines: number
  blank_lines: number
}

export interface ProgressEvent {
  scanner: string
  status: string
  message: string
  error: string | null
  elapsed: number
}

export interface FixResult {
  applied: boolean
  message: string
  backup: string | null
}

export interface SnippetLine {
  number: number
  content: string
  is_issue: boolean
}

export interface Snippet {
  file: string
  line: number
  total_lines: number
  lines: SnippetLine[]
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json()
}

export function getResults(): Promise<ScanResult> {
  return request<ScanResult>('/api/results')
}

export function listIssues(filters?: Record<string, string>): Promise<Issue[]> {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : ''
  return request<Issue[]>(`/api/results/issues${params}`)
}

export function getIssue(id: string): Promise<Issue> {
  return request<Issue>(`/api/results/issues/${encodeURIComponent(id)}`)
}

export function getTests(): Promise<TestResult> {
  return request<TestResult>('/api/results/tests')
}

export function getGitInfo(): Promise<GitInfo> {
  return request<GitInfo>('/api/results/git')
}

export function getDeps(): Promise<Dependency[]> {
  return request<Dependency[]>('/api/results/deps')
}

export function getVersion(): Promise<{ version: string }> {
  return request('/api/version')
}

export function healthCheck(): Promise<{ status: string }> {
  return request('/api/health')
}

export function triggerScan(): Promise<{ status: string }> {
  return request('/api/scan', { method: 'POST' })
}

export function getConfig(): Promise<any> {
  return request('/api/config')
}

export function getGlobalConfig(): Promise<any> {
  return request('/api/config/global')
}

export function getProjectConfig(): Promise<any> {
  return request('/api/config/project')
}

export function updateGlobalConfig(cfg: any): Promise<{ status: string }> {
  return request('/api/config/global', { method: 'PUT', body: JSON.stringify(cfg) })
}

export function updateProjectConfig(cfg: any): Promise<{ status: string }> {
  return request('/api/config/project', { method: 'PUT', body: JSON.stringify(cfg) })
}

export function applyFix(id: string): Promise<FixResult> {
  return request<FixResult>(`/api/fix/${encodeURIComponent(id)}`, { method: 'POST' })
}

export function undoFix(id: string): Promise<{ status: string }> {
  return request(`/api/fix/${encodeURIComponent(id)}/undo`, { method: 'POST' })
}

export function getSnippet(file: string, line: number): Promise<Snippet> {
  return request<Snippet>(`/api/snippet?file=${encodeURIComponent(file)}&line=${line}`)
}

export function subscribeStatus(onEvent: (e: ProgressEvent) => void): () => void {
  const es = new EventSource('/api/scan/status')
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onEvent(data)
    } catch {}
  }
  es.onerror = () => {}
  return () => es.close()
}

export function severityColor(s: string): string {
  switch (s) {
    case 'error': return 'text-red-600 bg-red-50 border-red-200'
    case 'warning': return 'text-yellow-700 bg-yellow-50 border-yellow-200'
    default: return 'text-blue-600 bg-blue-50 border-blue-200'
  }
}

export function severityBadge(s: string): string {
  switch (s) {
    case 'error': return 'bg-red-100 text-red-800'
    case 'warning': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-blue-100 text-blue-800'
  }
}

export function categoryColor(c: string): string {
  switch (c) {
    case 'bug': return 'text-red-700'
    case 'security': return 'text-orange-700'
    case 'style': return 'text-gray-600'
    case 'complexity': return 'text-purple-700'
    case 'test': return 'text-green-700'
    default: return 'text-gray-600'
  }
}
