import { useMemo, type ReactNode } from 'react'
import { ArrowRight, CircleCheck, CircleX, GitBranch, ShieldAlert, ShieldCheck } from 'lucide-react'
import { ScanResult, computeGrade, ProgressEvent } from '../api/client'
import { useThemeColors } from '../hooks/useThemeColors'
import { SeverityIcon } from '../components/Severity'
import Trends from '../components/Trends'
import ScanProgress from '../components/ScanProgress'
import EmptyState from '../components/EmptyState'
import { routeToHash, type Page } from '../lib/router'

interface Props {
  result: ScanResult | null
  scanEvents: ProgressEvent[]
  scanning: boolean
  readingResults: boolean
  onScan: () => void
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1000).toFixed(0) + 'k'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function fmtDurationNS(ns: number): string {
  if (ns >= 1e9) return (ns / 1e9).toFixed(2) + ' s'
  if (ns >= 1e6) return (ns / 1e6).toFixed(2) + ' ms'
  if (ns >= 1e3) return (ns / 1e3).toFixed(1) + ' µs'
  return ns.toFixed(0) + ' ns'
}

const GRADE_STYLE: Record<string, { text: string; bg: string; note: string }> = {
  A: { text: 'text-success', bg: 'bg-success-soft', note: 'No issues' },
  B: { text: 'text-success', bg: 'bg-success-soft', note: 'A few minor issues' },
  C: { text: 'text-warning', bg: 'bg-warning-soft', note: 'Worth a cleanup pass' },
  D: { text: 'text-orange', bg: 'bg-orange-soft', note: 'Many issues' },
  F: { text: 'text-danger', bg: 'bg-danger-soft', note: 'Errors need attention' },
}

/** Coverage/pass-rate status: color plus a word, never color alone. */
function rateStatus(pct: number | null): { color: (c: ReturnType<typeof useThemeColors>) => string; text: string; label: string } {
  if (pct === null) return { color: (c) => c.muted, text: 'text-fg-muted', label: 'n/a' }
  if (pct >= 80) return { color: (c) => c.good, text: 'text-success', label: 'good' }
  if (pct >= 50) return { color: (c) => c.warn, text: 'text-warning', label: 'fair' }
  return { color: (c) => c.bad, text: 'text-danger', label: 'low' }
}

function Ring({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const sw = 6
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * Math.max(0, Math.min(pct / 100, 1))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={sw} className="stroke-muted" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

function Bar({ pct, className }: { pct: number; className?: string; }) {
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${className ?? 'bg-accent'}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
    </div>
  )
}

/** A card that links to the page with the full detail. */
function Card({ to, title, children, className = '' }: { to?: Page; title: string; children: ReactNode; className?: string }) {
  const header = (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
      {to && <ArrowRight className="w-4 h-4 text-fg-subtle group-hover:text-accent transition-colors" aria-hidden="true" />}
    </div>
  )
  const cls = `card p-4 block ${className}`
  return to ? (
    <a href={routeToHash({ page: to })} className={`${cls} group hover:border-accent/50 transition-colors`}>
      {header}
      {children}
    </a>
  ) : (
    <section className={cls}>
      {header}
      {children}
    </section>
  )
}

export default function Dashboard({ result, scanEvents, scanning, readingResults, onScan }: Props) {
  const colors = useThemeColors()
  const showProgress = scanning || readingResults

  const issueByScanner = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of result?.issues ?? []) m.set(i.scanner, (m.get(i.scanner) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [result])

  if (!result) {
    return (
      <div className="max-w-7xl mx-auto p-8">
        {showProgress ? (
          <ScanProgress events={scanEvents} readingResults={readingResults} />
        ) : (
          <EmptyState message="No scan results yet" hint="Run a scan to analyze this project." onScan={onScan} scanning={scanning} />
        )}
      </div>
    )
  }

  const count = (sev: string) => result.issues.filter((i) => i.severity === sev).length
  const errCount = count('error')
  const warnCount = count('warning')
  const infoCount = count('info')
  const security = result.issues.filter((i) => i.category === 'security')
  const testResult = result.test_results
  const passRate = testResult && testResult.total.total > 0 ? (testResult.total.passed / testResult.total.total) * 100 : null
  const testedPkgs = testResult?.packages.filter((p) => p.coverage > 0) ?? []
  const avgCoverage = testedPkgs.length > 0 ? testedPkgs.reduce((s, p) => s + p.coverage, 0) / testedPkgs.length : null
  const grade = computeGrade(result.issues)
  const gradeStyle = GRADE_STYLE[grade] ?? GRADE_STYLE.C
  const totalCode = result.file_stats?.reduce((s, f) => s + f.code_lines, 0) ?? 0
  const totalComments = result.file_stats?.reduce((s, f) => s + f.comment_lines, 0) ?? 0
  const passStatus = rateStatus(passRate)
  const covStatus = rateStatus(avgCoverage)
  const benchmarks = result.benchmarks ?? []
  const zeroAlloc = benchmarks.filter((b) => b.allocs_per_op === 0).length
  const git = result.git_info
  const maxScanner = issueByScanner[0]?.[1] ?? 1

  return (
    <div className="max-w-7xl mx-auto p-8 space-y-6">
      {showProgress && <ScanProgress events={scanEvents} readingResults={readingResults} />}

      <p className="text-sm text-fg-muted">
        <span className="tabular-nums">{result.go_files}</span> Go files · <span className="tabular-nums">{fmtCount(result.total_lines)}</span> lines ·
        scanned in <span className="tabular-nums">{(result.duration / 1e9).toFixed(1)}s</span>
        {result.modules && result.modules.length > 1 && <> · <span className="text-violet font-medium">{result.modules.length} workspace modules</span></>}
      </p>

      {/* Headline metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <a href={routeToHash({ page: 'issues' })} className={`rounded-lg border border-line p-4 flex items-center gap-4 ${gradeStyle.bg} hover:border-accent/50 transition-colors`}>
          <span className={`text-5xl font-bold leading-none ${gradeStyle.text}`} aria-label={`Grade ${grade}`}>{grade}</span>
          <span>
            <span className="block text-sm font-medium">Code grade</span>
            <span className="block text-sm text-fg-muted">{gradeStyle.note}</span>
          </span>
        </a>

        <Card to="issues" title="Issues">
          <p className="text-3xl font-semibold tabular-nums">{result.issues.length}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1"><SeverityIcon severity="error" className="w-3.5 h-3.5" /><span className="tabular-nums">{errCount}</span> errors</span>
            <span className="inline-flex items-center gap-1"><SeverityIcon severity="warning" className="w-3.5 h-3.5" /><span className="tabular-nums">{warnCount}</span> warnings</span>
            <span className="inline-flex items-center gap-1"><SeverityIcon severity="info" className="w-3.5 h-3.5" /><span className="tabular-nums">{infoCount}</span> info</span>
          </div>
        </Card>

        <Card to="tests" title="Tests">
          <div className="flex items-center gap-3">
            <Ring pct={passRate ?? 0} color={passStatus.color(colors)} />
            <div>
              <p className="text-3xl font-semibold tabular-nums">{testResult?.total.total ?? '—'}</p>
              {testResult && (
                <p className="text-sm">
                  {testResult.total.failed > 0 ? (
                    <span className="inline-flex items-center gap-1 text-danger"><CircleX className="w-3.5 h-3.5" /> {testResult.total.failed} failing</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-success"><CircleCheck className="w-3.5 h-3.5" /> all passing</span>
                  )}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card to="tests" title="Coverage">
          <div className="flex items-center gap-3">
            <Ring pct={avgCoverage ?? 0} color={covStatus.color(colors)} />
            <div>
              <p className="text-3xl font-semibold tabular-nums">{avgCoverage !== null ? `${avgCoverage.toFixed(0)}%` : '—'}</p>
              <p className="text-sm text-fg-muted">
                <span className={`font-medium ${covStatus.text}`}>{covStatus.label}</span> · avg of {testedPkgs.length} pkg{testedPkgs.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </Card>

        <Card title="Code">
          <p className="text-3xl font-semibold tabular-nums">{fmtCount(totalCode)}</p>
          <p className="text-sm text-fg-muted">lines of code in {result.total_files} files</p>
          <p className="mt-1 text-sm text-fg-muted">
            {totalCode > 0 ? `${((totalComments / (totalCode + totalComments)) * 100).toFixed(0)}% comments` : ''}
          </p>
        </Card>
      </div>

      {/* Secondary panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card to="security" title="Security">
          {security.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success"><ShieldCheck className="w-4 h-4" /> No security findings</p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-danger mb-2">
                <ShieldAlert className="w-4 h-4" /> {security.length} finding{security.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-1.5">
                {security.slice(0, 4).map((iss) => (
                  <li key={iss.id} className="flex items-start gap-2 text-sm">
                    <SeverityIcon severity={iss.severity} className="w-3.5 h-3.5 mt-1" />
                    <span className="truncate">{iss.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.deps && (
            <p className="mt-3 pt-3 border-t border-line text-sm text-fg-muted">
              <span className="text-fg font-medium tabular-nums">{result.deps.length}</span> dependencies,{' '}
              <span className="text-fg font-medium tabular-nums">{result.deps.filter((d) => d.indirect).length}</span> indirect
            </p>
          )}
        </Card>

        <Card to="performance" title="Benchmarks">
          {benchmarks.length === 0 ? (
            <p className="text-sm text-fg-muted">No benchmarks found. Add <code className="font-mono">func BenchmarkX(b *testing.B)</code> to measure hot paths.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <dt className="text-sm text-fg-muted">Benchmarks</dt>
                  <dd className="text-xl font-semibold tabular-nums">{benchmarks.length}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-muted">Median time/op</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {fmtDurationNS([...benchmarks].sort((a, b) => a.time_per_op - b.time_per_op)[Math.floor(benchmarks.length / 2)].time_per_op)}
                  </dd>
                </div>
              </dl>
              <Bar pct={(zeroAlloc / benchmarks.length) * 100} className="bg-success" />
              <p className="mt-1 text-sm text-fg-muted"><span className="tabular-nums">{zeroAlloc}/{benchmarks.length}</span> allocation-free</p>
            </>
          )}
        </Card>

        <Card to="git" title="Git">
          {git ? (
            <>
              <p className="flex items-center gap-2 text-sm mb-3 min-w-0">
                <GitBranch className="w-4 h-4 text-fg-muted shrink-0" aria-hidden="true" />
                <span className="font-mono truncate">{git.branch}</span>
                <span className="font-mono text-fg-muted">{git.commit.slice(0, 8)}</span>
              </p>
              <dl className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-sm text-fg-muted">Authors</dt>
                  <dd className="text-xl font-semibold tabular-nums">{git.author_count}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-muted">Commits</dt>
                  <dd className="text-xl font-semibold tabular-nums">{git.commits?.length ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-muted">Latest</dt>
                  <dd className="text-xl font-semibold">
                    {git.commits?.[0] ? new Date(git.commits[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-sm text-fg-muted">Not a git repository.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {testedPkgs.length > 0 && (
          <Card to="tests" title="Coverage by package">
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {[...testedPkgs].sort((a, b) => a.coverage - b.coverage).map((p) => {
                const st = rateStatus(p.coverage)
                return (
                  <li key={p.name} className="grid grid-cols-[1fr_8rem_3rem] items-center gap-3 text-sm">
                    <span className="font-mono text-[13px] truncate" title={p.name}>{p.name.replace(result.project_name + '/', '') || p.name}</span>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(p.coverage, 100)}%`, backgroundColor: st.color(colors) }} />
                    </div>
                    <span className={`text-right tabular-nums font-medium ${st.text}`}>{p.coverage.toFixed(0)}%</span>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}

        {issueByScanner.length > 0 && (
          <Card to="issues" title="Issues by scanner">
            <ul className="space-y-2">
              {issueByScanner.map(([scanner, n]) => (
                <li key={scanner} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <span className="font-mono text-[13px] truncate">{scanner}</span>
                  <Bar pct={(n / maxScanner) * 100} className="bg-series-1" />
                  <span className="text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Trends />
    </div>
  )
}
