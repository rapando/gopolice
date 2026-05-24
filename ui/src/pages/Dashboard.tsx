import { ScanResult, computeGrade } from '../api/client'
import Trends from '../components/Trends'

interface Props {
  result: ScanResult | null
  scanLog: string[]
  scanning: boolean
  onScan: () => void
}

function Metric({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className={`card sq-metric ${color}`}>
      <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-0.5">{label}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-ctp-overlay1 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function Dashboard({ result, scanLog, scanning, onScan }: Props) {
  if (!result) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="card p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0 mb-4">No scan results yet.</p>
          <button
            onClick={onScan}
            disabled={scanning}
            className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {scanning ? 'Scanning...' : 'Run Scan'}
          </button>
          {scanLog.length > 0 && (
            <div className="mt-5 text-left">
              <p className="text-xs font-medium text-gray-500 dark:text-ctp-overlay0 mb-2 uppercase tracking-wide">Log</p>
              <div className="bg-gray-100 dark:bg-ctp-surface0 rounded p-3 text-xs font-mono max-h-32 overflow-auto leading-relaxed">
                {scanLog.map((l, i) => <div key={i} className="text-gray-600 dark:text-ctp-subtext0">{l}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const errCount = result.issues.filter((i) => i.severity === 'error').length
  const warnCount = result.issues.filter((i) => i.severity === 'warning').length
  const infoCount = result.issues.filter((i) => i.severity === 'info').length
  const testResult = result.test_results
  const passRate = testResult && testResult.total.total > 0
    ? ((testResult.total.passed / testResult.total.total) * 100).toFixed(1)
    : null
  const grade = computeGrade(result.issues)
  const gradeColor = grade === 'A' ? 'border-l-green-500'
    : grade === 'B' ? 'border-l-teal-500'
    : grade === 'C' ? 'border-l-yellow-500'
    : grade === 'D' ? 'border-l-orange-500'
    : 'border-l-red-500'

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text">{result.project_name}</h2>
          <span className="text-xs text-gray-400 dark:text-ctp-overlay1 font-mono">
            {result.go_files} files &middot; {result.total_lines.toLocaleString()} lines
            {result.modules && <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-ctp-mauve/20 dark:text-ctp-mauve">{result.modules.length} modules</span>}
          </span>
        </div>
        <p className="text-xs text-gray-400 dark:text-ctp-overlay1">
          Duration: {(result.duration / 1e9).toFixed(1)}s &middot; Dependencies: {result.deps?.length ?? 0}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <Metric label="Grade" value={grade} color={gradeColor} />
        <Metric label="Bugs" value={errCount} color="border-l-red-500" sub="Errors" />
        <Metric label="Vulnerabilities" value={result.issues.filter(i => i.category === 'security').length} color="border-l-orange-500" sub="Security" />
        <Metric label="Code Smells" value={warnCount + infoCount} color="border-l-yellow-500" sub="Warnings + Info" />
        <Metric label="Tests" value={testResult ? testResult.total.total : '-'} color="border-l-green-500" sub={passRate ? `${passRate}% pass rate` : undefined} />
      </div>

      {testResult && testResult.packages.filter((p) => p.coverage > 0).length > 0 && (
        <div className="card p-5 mb-6">
          <p className="text-xs font-medium text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide mb-3">Coverage</p>
          {testResult.packages.filter((p) => p.coverage > 0).map((p) => (
            <div key={p.name} className="flex items-center gap-3 mb-2 last:mb-0">
              <span className="text-sm font-mono text-gray-700 dark:text-ctp-subtext0 truncate flex-1">{p.name}</span>
              <div className="w-40 h-2 bg-gray-200 dark:bg-ctp-surface1 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(p.coverage, 100)}%` }} />
              </div>
              <span className="text-xs font-mono text-gray-500 dark:text-ctp-overlay0 w-14 text-right tabular-nums">{p.coverage.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      <Trends />

      {result.issues.length > 0 && (
        <div className="card mb-6">
          <div className="px-5 py-3 border-b border-gray-200 dark:border-ctp-surface1">
            <p className="text-xs font-medium text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">Recent Issues</p>
          </div>
          <div className="divide-y divide-gray-200 max-h-72 overflow-auto">
            {result.issues.slice(0, 20).map((issue) => {
              const sevClass = issue.severity === 'error' ? 'text-red-500'
                : issue.severity === 'warning' ? 'text-yellow-500'
                : 'text-blue-500'
              return (
                <div key={issue.id} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                  <span className={`text-base shrink-0 ${sevClass}`}>
                    {issue.severity === 'error' ? '●' : issue.severity === 'warning' ? '◆' : '○'}
                  </span>
                  <span className="text-xs font-medium uppercase text-gray-400 dark:text-ctp-overlay1 shrink-0 w-16">{issue.severity}</span>
                  <span className="text-gray-500 dark:text-ctp-overlay0 text-xs font-mono shrink-0">{issue.scanner}</span>
                  <span className="text-gray-700 dark:text-ctp-subtext0 truncate">{issue.message}</span>
                  <span className="text-xs text-gray-400 dark:text-ctp-overlay1 font-mono ml-auto shrink-0">{issue.file}:{issue.line}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {scanLog.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide mb-2">Scan Log</p>
          <div className="bg-gray-100 dark:bg-ctp-surface0 rounded p-2.5 text-xs font-mono max-h-32 overflow-auto leading-relaxed">
            {scanLog.map((l, i) => <div key={i} className="text-gray-600 dark:text-ctp-subtext0">{l}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}
