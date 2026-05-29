import { useState, useEffect } from 'react'
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
import Layout from './components/Layout'
import { getResults, subscribeStatus, type ProgressEvent, type ScanResult, triggerScan } from './api/client'

type Page = 'dashboard' | 'issues' | 'issue' | 'file' | 'tests' | 'testdetail' | 'performance' | 'deadcode' | 'depgraph' | 'history' | 'security' | 'git' | 'config'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [readingResults, setReadingResults] = useState(false)
  const [scanEvents, setScanEvents] = useState<ProgressEvent[]>([])
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedPkg, setSelectedPkg] = useState<string>('')
  const [selectedTest, setSelectedTest] = useState<string>('')
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

  const handleScan = () => {
    setScanEvents([])
    setScanning(true)
    triggerScan().catch(() => {})
  }

  const handleLoadResult = (result: ScanResult, label: string) => {
    setResult(result)
    setHistoricalLabel(label)
    setPage('dashboard')
  }

  const handleClearHistorical = () => {
    setHistoricalLabel(null)
    getResults()
      .then((r) => setResult(r))
      .catch(() => {})
  }

  const navigate = (p: string, param?: string) => {
    setPage(p as Page)
    if (p === 'issue' && param) setSelectedIssue(param)
    else if (p === 'file' && param) setSelectedFile(param)
  }

  const navigateTest = (pkg: string, test: string) => {
    setSelectedPkg(pkg)
    setSelectedTest(test)
    setPage('testdetail')
  }

  return (
    <Layout page={page} onNavigate={navigate} scanning={scanning} onScan={handleScan} historicalLabel={historicalLabel} onClearHistorical={handleClearHistorical} projectName={result?.project_name ?? ''}>
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : page === 'dashboard' ? (
        <Dashboard result={result} scanEvents={scanEvents} scanning={scanning} readingResults={readingResults} onScan={handleScan} />
      ) : page === 'issues' ? (
        <Issues
          issues={result?.issues ?? []}
          onSelectIssue={(id) => navigate('issue', id)}
          onSelectFile={(f) => navigate('file', f)}
          projectName={result?.project_name}
        />
      ) : page === 'issue' && selectedIssue ? (
        <IssueDetail issueId={selectedIssue} onBack={() => navigate('issues')} />
      ) : page === 'file' && selectedFile ? (
        <FileView filePath={selectedFile} issues={result?.issues ?? []} onBack={() => navigate('issues')} />
      ) : page === 'tests' ? (
        <Tests testResult={result?.test_results ?? null} onScan={handleScan} scanning={scanning} onSelectTest={navigateTest} />
      ) : page === 'testdetail' ? (
        <TestDetail testResult={result?.test_results ?? null} issues={result?.issues ?? []} pkgName={selectedPkg} testName={selectedTest} onBack={() => navigate('tests')} />
      ) : page === 'performance' ? (
        <Performance benchmarks={result?.benchmarks ?? null} profile={result?.profile ?? null} onScan={handleScan} scanning={scanning} projectName={result?.project_name} />
      ) : page === 'deadcode' ? (
        <DeadCode issues={result?.issues ?? []} onSelectIssue={(id) => navigate('issue', id)} onSelectFile={(f) => navigate('file', f)} />
      ) : page === 'depgraph' ? (
        <DepGraph depGraph={result?.dep_graph ?? null} onScan={handleScan} scanning={scanning} />
      ) : page === 'security' ? (
        <Security issues={result?.issues ?? []} onSelectIssue={(id) => navigate('issue', id)} />
      ) : page === 'git' ? (
        <GitStats gitInfo={result?.git_info ?? null} />
      ) : page === 'history' ? (
        <History onLoadResult={handleLoadResult} />
      ) : page === 'config' ? (
        <ConfigPage />
      ) : null}
    </Layout>
  )
}
