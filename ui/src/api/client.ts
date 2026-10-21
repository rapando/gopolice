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
  module: string
  git_blame: BlameInfo | null
  /** The measured number behind the issue (cyclomatic complexity), when there is one. */
  value?: number
  threshold?: number
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
  benchmarks: BenchmarkResult[] | null
  profile: ProfileData | null
  dep_graph: DepGraph | null
  deps: Dependency[] | null
  git_info: GitInfo | null
  file_stats: FileStat[] | null
  total_files: number
  go_files: number
  total_lines: number
  modules: string[] | null
}

export interface BenchmarkResult {
  name: string
  iterations: number
  time_per_op: number
  bytes_per_op: number
  allocs_per_op: number
}

export interface ProfileData {
  cpu: ProfileEntry[] | null
  mem: ProfileEntry[] | null
}

export interface ProfileEntry {
  function: string
  flat: number
  flat_pct: number
  cum: number
  cum_pct: number
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

export interface DepEdge {
  from: string
  to: string
}

export interface DepGraph {
  edges: DepEdge[]
}

export interface AuthorInfo {
  name: string
  email: string
  count: number
}

export interface CommitInfo {
  hash: string
  date: string
  author: string
  email: string
  message: string
  verified: string
}

export interface GitInfo {
  branch: string
  commit: string
  commit_time: string
  author_count: number
  authors?: AuthorInfo[]
  commits?: CommitInfo[]
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
  message?: string
  error?: string | null
  /** Nanoseconds (Go time.Duration). */
  elapsed?: number
  /** Item-level progress: `done` of `total` `unit`, currently on `detail`. */
  done?: number
  total?: number
  unit?: string
  detail?: string
  /** Every scanner the pipeline will run (on pipeline events). */
  steps?: string[]
  /** Position in the scan's event log; lets a replayed stream be de-duplicated. */
  seq?: number
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

// In service mode every repository has its own API under
// /api/projects/{id}/..., so the per-repository calls below are written
// against /api/... and rewritten here for the selected repository.
let currentProject: string | null = null

export function setCurrentProject(id: string | null) {
  currentProject = id
}

const UNSCOPED = ['/api/auth', '/api/projects', '/api/fs', '/api/session', '/api/health', '/api/version', '/api/config/global']

function scoped(path: string, project: string | null = currentProject): string {
  if (!project || !path.startsWith('/api/') || UNSCOPED.some((p) => path.startsWith(p))) return path
  return `/api/projects/${encodeURIComponent(project)}${path.slice('/api'.length)}`
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fired when the server says the session is no longer valid. */
export const UNAUTHORIZED_EVENT = 'gopolice:unauthorized'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${scoped(path)}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    let message = `HTTP ${res.status}: ${text}`
    try {
      const body = JSON.parse(text)
      if (typeof body?.error === 'string') message = body.error
    } catch {
      // not JSON; keep the raw text
    }
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, message)
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
  return request<Issue>(`/api/results/issues?id=${encodeURIComponent(id)}`)
}

export function getTests(): Promise<TestResult> {
  return request('/api/results/tests')
}

export function getBenchmarks(): Promise<BenchmarkResult[]> {
  return request('/api/results/benchmarks')
}

export function getProfile(): Promise<ProfileData> {
  return request('/api/results/profile')
}

export function getGitInfo(): Promise<GitInfo> {
  return request<GitInfo>('/api/results/git')
}

export function getDeps(): Promise<Dependency[]> {
  return request<Dependency[]>('/api/results/deps')
}

export function getDepGraph(): Promise<DepGraph> {
  return request<DepGraph>('/api/results/deps/graph')
}

export interface HistoryEntry {
  id: string
  timestamp: string
  project_id: string
  project_name: string
  total_issues: number
  total_tests: number
  duration: number
  grade?: string
}

export interface DiffResult {
  from: string
  to: string
  resolved: Issue[]
  new: Issue[]
  unchanged: Issue[]
}

export function getHistoryList(): Promise<HistoryEntry[]> {
  return request('/api/history')
}

export function getHistoryEntry(id: string): Promise<ScanResult> {
  return request(`/api/history/entry/${encodeURIComponent(id)}`)
}

export function getHistoryDiff(from: string, to: string): Promise<DiffResult> {
  return request(`/api/history/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
}

export interface TrendPoint {
  timestamp: string
  errors: number
  warnings: number
  infos: number
  grade: string
  coverage: number
  bench_ns_op: number
}

export interface TrendsData {
  points: TrendPoint[]
}

export function getTrends(): Promise<TrendsData> {
  return request('/api/history/trends')
}

export function deleteHistoryEntry(id: string): Promise<{ status: string }> {
  return request(`/api/history/entry/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getVersion(): Promise<{ version: string; project_dir?: string }> {
  return request('/api/version')
}

export function healthCheck(): Promise<{ status: string }> {
  return request('/api/health')
}

export interface ScanProgressSnapshot {
  scanning: boolean
  events: ProgressEvent[]
}

export function getScanProgress(): Promise<ScanProgressSnapshot> {
  return request('/api/scan/progress')
}

export function triggerScan(): Promise<{ status: string }> {
  return request('/api/scan', { method: 'POST' })
}

/** Starts a scan of a specific saved repository, whichever one is selected. */
export function triggerScanFor(projectId: string): Promise<{ status: string }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/scan`, { method: 'POST' })
}

// ---- Session & accounts (service mode) ----

export interface SessionInfo {
  /** "service": login + many repositories. "single": one repository, no login. */
  mode: 'service' | 'single'
  auth_required: boolean
  authenticated: boolean
  setup_required: boolean
  setup_token_required?: boolean
  username?: string
  version: string
  /** The operating system verifies logins (macOS password / Touch ID). */
  os_mode?: boolean
  os_username?: string
  /** Touch ID can be offered: this browser is on the machine running the service. */
  touch_id?: boolean
}

export function getSession(): Promise<SessionInfo> {
  return request('/api/session')
}

export function setupAccount(username: string, password: string, setupToken?: string): Promise<SessionInfo> {
  return request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ username, password, setup_token: setupToken ?? '' }),
  })
}

export function loginWithPassword(username: string, password: string): Promise<SessionInfo> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function loginWithTouchId(): Promise<SessionInfo> {
  return request('/api/auth/os/biometric', { method: 'POST' })
}

export function logout(): Promise<{ status: string }> {
  return request('/api/auth/logout', { method: 'POST' })
}

export function changePassword(current: string, next: string): Promise<{ status: string }> {
  return request('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, new: next }) })
}

export interface Passkey {
  id: string
  name: string
  added_at: string
  last_used_at?: string
}

export function listPasskeys(): Promise<Passkey[]> {
  return request('/api/auth/passkeys')
}

export function deletePasskey(id: string): Promise<Passkey[]> {
  return request(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Raw JSON bodies for the two-step WebAuthn ceremonies. */
export function passkeyBegin(kind: 'login' | 'register'): Promise<{ ceremony: string; options: any }> {
  return request(`/api/auth/passkey/${kind}/begin`, { method: 'POST' })
}

export function passkeyFinishLogin(ceremony: string, credential: unknown): Promise<SessionInfo> {
  return request(`/api/auth/passkey/login/finish?ceremony=${encodeURIComponent(ceremony)}`, {
    method: 'POST',
    body: JSON.stringify(credential),
  })
}

export function passkeyFinishRegister(ceremony: string, name: string, credential: unknown): Promise<Passkey[]> {
  return request(
    `/api/auth/passkey/register/finish?ceremony=${encodeURIComponent(ceremony)}&name=${encodeURIComponent(name)}`,
    { method: 'POST', body: JSON.stringify(credential) },
  )
}

// ---- Saved repositories (service mode) ----

export interface ProjectView {
  id: string
  name: string
  path: string
  added_at: string
  opened_at?: string
  missing?: boolean
  scanning: boolean
  has_result: boolean
  issues: number
  errors: number
  grade?: string
  scan_time?: string
  branch?: string
}

export function listProjects(): Promise<ProjectView[]> {
  return request('/api/projects')
}

export function addProject(path: string): Promise<ProjectView> {
  return request('/api/projects', { method: 'POST', body: JSON.stringify({ path }) })
}

export function openProject(id: string): Promise<ProjectView> {
  return request(`/api/projects/${encodeURIComponent(id)}/open`, { method: 'POST' })
}

export function removeProject(id: string): Promise<{ status: string }> {
  return request(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface BrowseEntry {
  name: string
  path: string
  go_project: boolean
}

export interface BrowseResult {
  path: string
  parent: string
  go_project: boolean
  entries: BrowseEntry[]
}

export function browse(path?: string, hidden = false): Promise<BrowseResult> {
  const q = new URLSearchParams()
  if (path) q.set('path', path)
  if (hidden) q.set('hidden', '1')
  const qs = q.toString()
  return request(`/api/fs/browse${qs ? `?${qs}` : ''}`)
}

export function getConfig(): Promise<any> {
  return request('/api/config')
}

export function getGlobalConfig(): Promise<any> {
  return request('/api/config/global')
}

export function updateGlobalConfig(cfg: any): Promise<{ status: string }> {
  return request('/api/config/global', { method: 'PUT', body: JSON.stringify(cfg) })
}

export function applyFix(id: string): Promise<FixResult> {
  return request<FixResult>(`/api/fix/${encodeURIComponent(id)}`, { method: 'POST' })
}

export interface BatchFixItem {
  id: string
  applied: boolean
  message: string
}

export function batchFix(ids: string[]): Promise<{ results: BatchFixItem[] }> {
  return request('/api/fix/batch', { method: 'POST', body: JSON.stringify({ issue_ids: ids }) })
}

export function undoFix(id: string): Promise<{ status: string }> {
  return request(`/api/fix/${encodeURIComponent(id)}/undo`, { method: 'POST' })
}

export function getSnippet(file: string, line: number): Promise<Snippet> {
  return request<Snippet>(`/api/snippet?file=${encodeURIComponent(file)}&line=${line}`)
}

export function subscribeStatus(onEvent: (e: ProgressEvent) => void): () => void {
  const es = new EventSource(scoped('/api/scan/status'))
  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onEvent(data)
    } catch {}
  }
  es.onerror = () => {}
  return () => es.close()
}

export function computeGrade(issues: { severity: string }[]): string {
  let score = 0
  for (const iss of issues) {
    if (iss.severity === 'error') score += 10
    else if (iss.severity === 'warning') score += 3
    else score += 1
  }
  if (score === 0) return 'A'
  if (score <= 15) return 'B'
  if (score <= 40) return 'C'
  if (score <= 80) return 'D'
  return 'F'
}

export function durationStr(d: number): string {
  if (d < 1_000_000_000) return (d / 1_000_000).toFixed(0) + 'ms'
  return (d / 1_000_000_000).toFixed(2) + 's'
}

