import { useState, useEffect, useMemo } from 'react'
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
import Spinner from './components/Spinner'
import { getResults, subscribeStatus, type ProgressEvent, type ScanResult, triggerScan } from './api/client'
import { navigate, useRoute } from './lib/router'

export default function App() {
  const route = useRoute()
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [readingResults, setReadingResults] = useState(false)
  const [scanEvents, setScanEvents] = useState<ProgressEvent[]>([])
  const [historicalLabel, setHistoricalLabel] = useState<string | null>(null)

  useEffect(() => {
    getResults()
      .then((r) => { setResult(r); setLoading(false) })
      .catch(() => { setLoading(false); triggerScan().catch(() => {}) })
  }, [])

  useEffect(() => {
    const unsub = subscribeStatus((e: ProgressEvent) => {
      setScanEvents((prev) => [...prev, e])
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
    setScanEvents([])
    setScanning(true)
    triggerScan().catch(() => {})
  }

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
      historicalLabel={historicalLabel}
      onClearHistorical={handleClearHistorical}
      projectName={result?.project_name}
      scanTime={result?.scan_time}
      branch={result?.git_info?.branch}
    >
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Spinner />
        </div>
      ) : page === 'dashboard' ? (
        <Dashboard result={result} scanEvents={scanEvents} scanning={scanning} readingResults={readingResults} onScan={handleScan} />
      ) : page === 'issues' ? (
        <Issues issues={result?.issues ?? []} onSelectIssue={goIssue} onSelectFile={goFile} projectName={result?.project_name} />
      ) : page === 'issue' && param ? (
        <IssueDetail issueId={param} onBack={back} />
      ) : page === 'file' && param ? (
        <FileView filePath={param} issues={result?.issues ?? []} onBack={back} />
      ) : page === 'tests' ? (
        <Tests testResult={result?.test_results ?? null} onScan={handleScan} scanning={scanning} onSelectTest={goTest} />
      ) : page === 'testdetail' ? (
        <TestDetail testResult={result?.test_results ?? null} issues={result?.issues ?? []} pkgName={param ?? ''} testName={param2 ?? ''} onBack={back} />
      ) : page === 'performance' ? (
        <Performance benchmarks={result?.benchmarks ?? null} profile={result?.profile ?? null} onScan={handleScan} scanning={scanning} projectName={result?.project_name} />
      ) : page === 'deadcode' ? (
        <DeadCode issues={result?.issues ?? []} onSelectIssue={goIssue} onSelectFile={goFile} onScan={handleScan} scanning={scanning} />
      ) : page === 'depgraph' ? (
        <DepGraph depGraph={result?.dep_graph ?? null} onScan={handleScan} scanning={scanning} />
      ) : page === 'security' ? (
        <Security issues={result?.issues ?? []} onSelectIssue={goIssue} onScan={handleScan} scanning={scanning} />
      ) : page === 'git' ? (
        <GitStats gitInfo={result?.git_info ?? null} onScan={handleScan} scanning={scanning} />
      ) : page === 'history' ? (
        <History onLoadResult={handleLoadResult} />
      ) : page === 'config' ? (
        <ConfigPage />
      ) : null}
    </Layout>
  )
}
