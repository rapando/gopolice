import { useMemo } from 'react'
import { ScanResult, computeGrade, ProgressEvent } from '../api/client'
import Trends from '../components/Trends'
import ScanProgress from '../components/ScanProgress'

interface Props {
  result: ScanResult | null
  scanEvents: ProgressEvent[]
  scanning: boolean
  readingResults: boolean
  onScan: () => void
}

function fmtBytes(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function fmtDurationNS(ns: number): string {
  if (ns >= 1e9) return (ns / 1e9).toFixed(1) + 's'
  if (ns >= 1e6) return (ns / 1e6).toFixed(1) + 'ms'
  return (ns / 1e3).toFixed(0) + 'µs'
}

function Donut({ pct, size = 60, strokeWidth = 6, color }: { pct: number; size?: number; strokeWidth?: number; color: string }) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * Math.min(pct / 100, 1)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-gray-200 dark:text-ctp-surface1" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full h-1.5 bg-gray-200 dark:bg-ctp-surface1 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function Dashboard({ result, scanEvents, scanning, readingResults, onScan }: Props) {
  const showProgress = scanning || readingResults

  const errCount = result?.issues.filter((i) => i.severity === 'error').length ?? 0
  const warnCount = result?.issues.filter((i) => i.severity === 'warning').length ?? 0
  const infoCount = result?.issues.filter((i) => i.severity === 'info').length ?? 0
  const totalIssues = (result?.issues.length ?? 0)
  const secCount = result?.issues.filter((i) => i.category === 'security').length ?? 0
  const testResult = result?.test_results ?? null
  const passRate = testResult && testResult.total.total > 0 ? (testResult.total.passed / testResult.total.total) * 100 : null
  const grade = result ? computeGrade(result.issues) : null
  const avgCoverage = testResult && testResult.packages.length > 0
    ? testResult.packages.reduce((s, p) => s + p.coverage, 0) / testResult.packages.length
    : null
  const totalCode = result?.file_stats?.reduce((s, f) => s + f.code_lines, 0) ?? 0
  const totalComments = result?.file_stats?.reduce((s, f) => s + f.comment_lines, 0) ?? 0
  const totalBlank = result?.file_stats?.reduce((s, f) => s + f.blank_lines, 0) ?? 0
  const issueByScanner = useMemo(() => {
    if (!result) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const i of result.issues) {
      m.set(i.scanner, (m.get(i.scanner) ?? 0) + 1)
    }
    return m
  }, [result])

  const gradeColor = grade === 'A' ? 'text-green-600 dark:text-ctp-green'
    : grade === 'B' ? 'text-teal-600 dark:text-ctp-teal'
    : grade === 'C' ? 'text-yellow-600 dark:text-ctp-yellow'
    : grade === 'D' ? 'text-orange-600 dark:text-ctp-peach'
    : grade === 'F' ? 'text-red-600 dark:text-ctp-red'
    : 'text-gray-400'

  const gradeBg = grade === 'A' ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900'
    : grade === 'B' ? 'bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-900'
    : grade === 'C' ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-900'
    : grade === 'D' ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900'
    : grade === 'F' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900'
    : 'bg-gray-50 dark:bg-ctp-surface0 border-gray-200 dark:border-ctp-surface1'

  if (!result) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        {showProgress ? (
          <ScanProgress events={scanEvents} readingResults={readingResults} />
        ) : (
          <div className="card p-10 text-center">
            <p className="text-gray-500 dark:text-ctp-subtext0 mb-4">No scan results yet.</p>
            <button onClick={onScan} className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 transition-colors">Run Scan</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto p-8" style={{ maxWidth: 'min(95vw, 1600px)' }}>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text">{result.project_name}</h2>
        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-ctp-subtext1 font-mono">
          <span>{result.go_files} Go files</span>
          <span className="text-gray-300 dark:text-ctp-surface1">|</span>
          <span>{fmtBytes(result.total_lines)} lines</span>
          <span className="text-gray-300 dark:text-ctp-surface1">|</span>
          <span>{(result.duration / 1e9).toFixed(1)}s</span>
          {result.modules && result.modules.length > 1 && (
            <>
              <span className="text-gray-300 dark:text-ctp-surface1">|</span>
              <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-ctp-mauve/20 dark:text-ctp-mauve font-semibold">{result.modules.length} modules</span>
            </>
          )}
        </div>
      </div>

      {/* Top row: grade + key metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        {/* Grade — prominent */}
        <div className={`flex flex-col items-center justify-center rounded-xl border ${gradeBg} p-4`}>
          <span className={`text-5xl font-black tracking-tight ${gradeColor}`}>{grade}</span>
          <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-ctp-subtext1 mt-1 font-medium">Code Grade</span>
        </div>

        {/* Issues summary */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4 flex items-center gap-3">
          <Donut pct={totalIssues > 0 ? (errCount / totalIssues) * 100 : 0} color="#ef4444" />
          <div>
            <div className="text-2xl font-bold text-gray-800 dark:text-ctp-text">{totalIssues}</div>
            <div className="text-[10px] text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">Issues</div>
            <div className="flex gap-2 mt-1 text-[11px]">
              <span className="text-red-500 font-medium">{errCount} err</span>
              <span className="text-yellow-500 font-medium">{warnCount} warn</span>
              <span className="text-blue-500 font-medium">{infoCount} info</span>
            </div>
          </div>
        </div>

        {/* Tests summary */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4 flex items-center gap-3">
          <Donut pct={passRate ?? 0} color={passRate !== null && passRate >= 80 ? '#22c55e' : passRate !== null && passRate >= 50 ? '#eab308' : '#ef4444'} />
          <div>
            <div className="text-2xl font-bold text-gray-800 dark:text-ctp-text">{testResult?.total.total ?? '-'}</div>
            <div className="text-[10px] text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">Tests</div>
            {testResult && (
              <div className="flex gap-2 mt-1 text-[11px]">
                <span className="text-green-500 font-medium">{testResult.total.passed} pass</span>
                {testResult.total.failed > 0 && <span className="text-red-500 font-medium">{testResult.total.failed} fail</span>}
                {testResult.total.skipped > 0 && <span className="text-gray-400 font-medium">{testResult.total.skipped} skip</span>}
              </div>
            )}
          </div>
        </div>

        {/* Coverage summary */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4 flex items-center gap-3">
          <Donut pct={avgCoverage ?? 0} color={avgCoverage !== null && avgCoverage >= 80 ? '#22c55e' : avgCoverage !== null && avgCoverage >= 50 ? '#eab308' : '#ef4444'} />
          <div>
            <div className="text-2xl font-bold text-gray-800 dark:text-ctp-text">{avgCoverage !== null ? `${avgCoverage.toFixed(0)}%` : '-'}</div>
            <div className="text-[10px] text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">Coverage</div>
            <div className="flex gap-2 mt-1 text-[11px]">
              <span className="text-gray-500 font-medium">{testResult?.packages.filter((p) => p.coverage > 0).length ?? 0} packages</span>
            </div>
          </div>
        </div>

        {/* File stats */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-gray-800 dark:text-ctp-text">{result.total_files}</span>
            <span className="text-[10px] text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">Files</span>
          </div>
          <div className="mt-2 space-y-1">
            {[
              { label: 'Code', value: totalCode, max: totalCode + totalComments + totalBlank, color: 'bg-blue-500 dark:bg-ctp-blue' },
              { label: 'Comments', value: totalComments, max: totalCode + totalComments + totalBlank, color: 'bg-emerald-500 dark:bg-ctp-green' },
              { label: 'Blank', value: totalBlank, max: totalCode + totalComments + totalBlank, color: 'bg-gray-300 dark:bg-ctp-surface1' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 dark:text-ctp-subtext1 w-12 shrink-0">{s.label}</span>
                <MiniBar value={s.value} max={s.max} color={s.color} />
                <span className="text-[10px] font-mono text-gray-500 dark:text-ctp-subtext0 w-12 text-right">{fmtBytes(s.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second row: security, deps, benchmarks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Security summary */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide">Security</span>
            {secCount > 0 && <span className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">{secCount}</span>}
          </div>
          <div className="space-y-1.5">
            {secCount === 0 ? (
              <p className="text-xs text-gray-400 dark:text-ctp-subtext1 italic">No security issues found</p>
            ) : (
              result.issues.filter((i) => i.category === 'security').slice(0, 5).map((iss) => (
                <div key={iss.id} className="flex items-center gap-2 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  <span className="text-gray-700 dark:text-ctp-subtext0 truncate">{iss.message}</span>
                  <span className="text-gray-400 dark:text-ctp-subtext1 font-mono ml-auto shrink-0 text-[10px]">{iss.scanner}</span>
                </div>
              ))
            )}
          </div>
          {result.deps && (
            <>
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-ctp-surface1">
                <div className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-2">Dependencies</div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-700 dark:text-ctp-subtext0"><strong className="text-gray-900 dark:text-ctp-text">{result.deps.length}</strong> total</span>
                  <span className="text-gray-700 dark:text-ctp-subtext0"><strong className="text-gray-900 dark:text-ctp-text">{result.deps.filter((d) => d.indirect).length}</strong> indirect</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Benchmarks summary */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-3">Benchmarks</div>
          {result.benchmarks && result.benchmarks.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div>
                  <div className="text-lg font-bold text-gray-800 dark:text-ctp-text">{result.benchmarks.length}</div>
                  <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1">total</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-800 dark:text-ctp-text">{fmtDurationNS(result.benchmarks.reduce((s, b) => s + b.time_per_op, 0) / result.benchmarks.length)}</div>
                  <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1">avg/op</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-800 dark:text-ctp-text">
                    {result.benchmarks.reduce((s, b) => s + b.allocs_per_op, 0) > 0
                      ? fmtDurationNS(result.benchmarks.reduce((s, b) => s + b.bytes_per_op, 0) / result.benchmarks.reduce((s, b) => s + b.allocs_per_op, 0))
                      : '—'}
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1">B/alloc</div>
                </div>
              </div>
              <MiniBar
                value={result.benchmarks.filter((b) => b.allocs_per_op === 0).length}
                max={result.benchmarks.length}
                color="bg-green-500"
              />
              <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1 mt-0.5">
                {result.benchmarks.filter((b) => b.allocs_per_op === 0).length}/{result.benchmarks.length} zero-alloc
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 dark:text-ctp-subtext1 italic">No benchmarks</p>
          )}
        </div>

        {/* Git summary */}
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-3">Git</div>
          {result.git_info ? (
            <>
              <div className="flex items-center gap-2 text-xs mb-2">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
                <span className="font-mono text-gray-700 dark:text-ctp-subtext0 truncate">{result.git_info.branch}</span>
                <span className="font-mono text-gray-400 dark:text-ctp-subtext1 text-[10px]">{result.git_info.commit.slice(0, 8)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-lg font-bold text-gray-800 dark:text-ctp-text">{result.git_info.author_count}</div>
                  <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1">authors</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-800 dark:text-ctp-text">{result.git_info.commits?.length ?? 0}</div>
                  <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1">commits</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-800 dark:text-ctp-text">
                    {result.git_info.commits && result.git_info.commits.length > 0
                      ? new Date(result.git_info.commits[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : '—'}
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-ctp-subtext1">latest</div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 dark:text-ctp-subtext1 italic">No git data</p>
          )}
        </div>
      </div>

      {/* Coverage bars */}
      {testResult && testResult.packages.filter((p) => p.coverage > 0).length > 0 && (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4 mb-6">
          <div className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-3">Coverage by Package</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {testResult.packages.filter((p) => p.coverage > 0).map((p) => (
              <div key={p.name} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-gray-600 dark:text-ctp-subtext0 truncate flex-1 min-w-0">{p.name.replace(result.project_name + '/', '')}</span>
                <div className="w-32 h-2 bg-gray-200 dark:bg-ctp-surface1 rounded-full overflow-hidden shrink-0">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(p.coverage, 100)}%`,
                    backgroundColor: p.coverage >= 80 ? '#22c55e' : p.coverage >= 50 ? '#eab308' : '#ef4444',
                  }} />
                </div>
                <span className="font-mono text-gray-500 dark:text-ctp-subtext0 w-10 text-right tabular-nums">{p.coverage.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues by scanner */}
      {issueByScanner.size > 0 && (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded-xl p-4 mb-6">
          <div className="text-xs font-semibold text-gray-500 dark:text-ctp-subtext0 uppercase tracking-wide mb-3">Issues by Scanner</div>
          <div className="space-y-1.5">
            {Array.from(issueByScanner.entries()).sort((a, b) => b[1] - a[1]).map(([scanner, count]) => {
              const maxCount = Math.max(...Array.from(issueByScanner.values()))
              return (
                <div key={scanner} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600 dark:text-ctp-subtext0 w-20 shrink-0 font-medium">{scanner}</span>
                  <MiniBar value={count} max={maxCount} color={
                    scanner === 'gosec' || scanner === 'security' ? 'bg-red-500'
                    : scanner === 'golint' || scanner === 'staticcheck' ? 'bg-yellow-500'
                    : scanner === 'errcheck' ? 'bg-orange-500'
                    : 'bg-blue-500'
                  } />
                  <span className="font-mono text-gray-500 dark:text-ctp-subtext0 w-8 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Trends />

      {showProgress && (
        <div className="mb-6">
          <ScanProgress events={scanEvents} readingResults={readingResults} />
        </div>
      )}
    </div>
  )
}
