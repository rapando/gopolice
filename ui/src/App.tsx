import { useCallback, useState, useEffect, useMemo } from 'react'
import Dashboard from './pages/Dashboard'
import Issues from './pages/Issues'
import IssueDetail from './pages/IssueDetail'
import FileView from './pages/FileView'
import Tests from './pages/Tests'
import TestDetail from './pages/TestDetail'
import Performance from './pages/Performance'
import DeadCode from './pages/DeadCode'
import DepGraph from './pages/DepGraph'
import Security from './pages/Security'
import GitStats from './pages/GitStats'
import ConfigPage from './pages/Config'
import History from './pages/History'
import Layout, { type NavCounts } from './components/Layout'
import ScanModal from './components/ScanModal'
import Spinner from './components/Spinner'
import Login from './pages/Login'
import Projects from './pages/Projects'
import Account from './pages/Account'
import ServiceShell from './components/ServiceShell'
import {
  getResults, getSession, logout, openProject, setCurrentProject, subscribeStatus, triggerScan,
  UNAUTHORIZED_EVENT, type ProgressEvent, type ScanResult, type SessionInfo,
} from './api/client'
import { setProjectDir } from './lib/editor'
import { navigate, setRouteProject, useRoute } from './lib/router'
import { applyEvent, emptyScanState, startingScanState } from './lib/scan'

export default function App() {
  const route = useRoute()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  const refreshSession = useCallback(() => {
    getSession().then((s) => { setSession(s); setUnreachable(false) }).catch(() => setUnreachable(true))
  }, [])

  useEffect(() => {
    refreshSession()
    // Any API call that comes back 401 means the login lapsed.
    window.addEventListener(UNAUTHORIZED_EVENT, refreshSession)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, refreshSession)
  }, [refreshSession])

  const signOut = useCallback(async () => {
    try { await logout() } catch { /* the session check below is authoritative */ }
    window.location.hash = ''
    refreshSession()
  }, [refreshSession])

  if (unreachable && !session) {
    return (
      <div className="min-h-screen bg-canvas text-fg flex items-center justify-center p-6 text-center">
        <p className="text-sm text-fg-muted">Can't reach the gopolice server. Is it still running?</p>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center"><Spinner /></div>
    )
  }
  if (!session.authenticated) {
    return <Login session={session} onAuthenticated={setSession} />
  }

  if (session.mode === 'single') {
    setCurrentProject(null)
    setRouteProject(undefined)
    return <ProjectApp />
  }

  // Service mode: every repository lives under #/p/{id}/...
  setCurrentProject(route.project ?? null)
  setRouteProject(route.project)
  const shell = (page: typeof route.page, body: JSX.Element) => (
    <ServiceShell page={page} username={session.username} onLogout={signOut}>{body}</ServiceShell>
  )
  if (route.page === 'account') return shell('account', <Account osUsername={session.os_mode ? session.os_username : undefined} />)
  if (!route.project || route.page === 'projects') return shell('projects', <Projects osMode={!!session.os_mode} />)
  return <ProjectApp key={route.project} projectId={route.project} service={{ username: session.username, onLogout: signOut }} />
}

function ProjectApp({ projectId, service }: { projectId?: string; service?: { username?: string; onLogout: () => void } }) {
  const route = useRoute()
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [readingResults, setReadingResults] = useState(false)
  const [scan, setScan] = useState(emptyScanState)
  const [scanOpen, setScanOpen] = useState(false)
  const [historicalLabel, setHistoricalLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    // Records the open, and tells us where the repository lives so
    // open-in-editor links can be built.
    openProject(projectId)
      .then((p) => setProjectDir(p.path))
      .catch(() => navigate({ page: 'projects' }))
  }, [projectId])

  useEffect(() => {
    getResults()
      .then((r) => { setResult(r); setLoading(false) })
      .catch(() => { setLoading(false); triggerScan().catch(() => {}) })
  }, [])

  useEffect(() => {
    const unsub = subscribeStatus((e: ProgressEvent) => {
      setScan((prev) => applyEvent(prev, e))
      if (e.status === 'started' && e.scanner === 'pipeline') {
        // A scan began (from here, another tab, the repository list or the
        // file watcher): show its progress.
        setScanOpen(true)
      }
      if (e.status === 'completed' && e.scanner === 'pipeline') {
        setScanning(true)
        setReadingResults(true)
        setTimeout(() => {
          getResults().then(setResult).catch(() => {})
          setScanning(false)
          setReadingResults(false)
          setHistoricalLabel(null)
        }, 2000)
      }
      if (e.status === 'failed') {
        setScanning(false)
      }
      if (e.status === 'started') {
        setScanning(true)
      }
    })
    return unsub
  }, [])

  const counts = useMemo<NavCounts | null>(() => {
    if (!result) return null
    return {
      issues: result.issues.length,
      errors: result.issues.filter((i) => i.severity === 'error').length,
      security: result.issues.filter((i) => i.category === 'security').length,
      deadcode: result.issues.filter((i) => i.category === 'deadcode').length,
      failedTests: result.test_results?.total.failed ?? 0,
    }
  }, [result])

  const handleScan = () => {
    setScan(startingScanState())
    setScanning(true)
    setScanOpen(true)
    triggerScan().catch(() => {})
  }
  const closeScan = useCallback(() => setScanOpen(false), [])

  const handleLoadResult = (r: ScanResult, label: string) => {
    setResult(r)
    setHistoricalLabel(label)
    navigate({ page: 'dashboard' })
  }

  const handleClearHistorical = () => {
    setHistoricalLabel(null)
    getResults().then(setResult).catch(() => {})
  }

  const goIssue = (id: string) => navigate({ page: 'issue', param: id })
  const goFile = (f: string) => navigate({ page: 'file', param: f })
  const goTest = (pkg: string, test: string) => navigate({ page: 'testdetail', param: pkg, param2: test })
  const back = () => window.history.back()

  const { page, param, param2 } = route

  return (
    <Layout
      page={page}
      counts={counts}
      scanning={scanning}
      onScan={handleScan}
      onShowScan={() => setScanOpen(true)}
      historicalLabel={historicalLabel}
      onClearHistorical={handleClearHistorical}
      projectName={result?.project_name}
      scanTime={result?.scan_time}
      scanDuration={result?.duration}
      branch={result?.git_info?.branch}
      service={service}
    >
      {scanOpen && (
        <ScanModal
          state={scan}
          projectName={result?.project_name}
          readingResults={readingResults}
          onClose={closeScan}
          onViewResults={() => { setScanOpen(false); navigate({ page: 'dashboard' }) }}
        />
      )}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      ) : page === 'dashboard' ? (
        <Dashboard result={result} scan={scan} scanning={scanning} readingResults={readingResults} onScan={handleScan} onShowScan={() => setScanOpen(true)} />
      ) : page === 'issues' ? (
        <Issues issues={result?.issues ?? []} onSelectIssue={goIssue} onSelectFile={goFile} projectName={result?.project_name} />
      ) : page === 'issue' && param ? (
        <IssueDetail issueId={param} onBack={back} />
      ) : page === 'file' && param ? (
        <FileView filePath={param} issues={result?.issues ?? []} onBack={back} />
      ) : page === 'tests' ? (
        <Tests testResult={result?.test_results ?? null} projectName={result?.project_name} onScan={handleScan} scanning={scanning} onSelectTest={goTest} />
      ) : page === 'testdetail' ? (
        <TestDetail testResult={result?.test_results ?? null} issues={result?.issues ?? []} pkgName={param ?? ''} testName={param2 ?? ''} onBack={back} />
      ) : page === 'performance' ? (
        <Performance benchmarks={result?.benchmarks ?? null} profile={result?.profile ?? null} onScan={handleScan} scanning={scanning} projectName={result?.project_name} />
      ) : page === 'deadcode' ? (
        <DeadCode issues={result?.issues ?? []} onSelectIssue={goIssue} onSelectFile={goFile} onScan={handleScan} scanning={scanning} />
      ) : page === 'depgraph' ? (
        <DepGraph depGraph={result?.dep_graph ?? null} deps={result?.deps} onScan={handleScan} scanning={scanning} />
      ) : page === 'security' ? (
        <Security issues={result?.issues ?? []} tools={result?.tools} onSelectIssue={goIssue} onScan={handleScan} scanning={scanning} />
      ) : page === 'git' ? (
        <GitStats gitInfo={result?.git_info ?? null} onScan={handleScan} scanning={scanning} />
      ) : page === 'history' ? (
        <History onLoadResult={handleLoadResult} onScan={handleScan} />
      ) : page === 'config' ? (
        <ConfigPage />
      ) : null}
    </Layout>
  )
}
