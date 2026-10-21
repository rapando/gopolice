import { useMemo, type ReactNode } from 'react'
import { ArrowRight, CircleCheck, CircleX, FlaskConical, GitBranch, ShieldAlert, ShieldCheck } from 'lucide-react'
import { ScanResult, type Issue, type TestPackage } from '../api/client'
import { useThemeColors } from '../hooks/useThemeColors'
import { SeverityIcon } from '../components/Severity'
import Trends from '../components/Trends'
import ScanProgress from '../components/ScanProgress'
import EmptyState from '../components/EmptyState'
import { routeToHash, type Page } from '../lib/router'
import type { ScanState } from '../lib/scan'
import { gradeDetails } from '../lib/grade'
import { compareBySeverityThenValue, issueMeasure, issueSubject } from '../lib/issues'

interface Props {
  result: ScanResult | null
  scan: ScanState
  scanning: boolean
  readingResults: boolean
  onScan: () => void
  onShowScan?: () => void
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

const GRADE_STYLE: Record<string, { text: string; bg: string; bar: string; note: string }> = {
  A: { text: 'text-success', bg: 'bg-success-soft', bar: 'bg-success', note: 'No issues' },
  B: { text: 'text-success', bg: 'bg-success-soft', bar: 'bg-success', note: 'A few minor issues' },
  C: { text: 'text-warning', bg: 'bg-warning-soft', bar: 'bg-warning', note: 'Worth a cleanup pass' },
  D: { text: 'text-orange', bg: 'bg-orange-soft', bar: 'bg-orange', note: 'Many issues' },
  F: { text: 'text-danger', bg: 'bg-danger-soft', bar: 'bg-danger', note: 'Errors need attention' },
}

/** Coverage target the bars are measured against. */
const COVERAGE_TARGET = 80

/** Coverage/pass-rate status: color plus a word, never color alone. */
export function rateStatus(pct: number | null): { color: (c: ReturnType<typeof useThemeColors>) => string; text: string; bar: string; label: string } {
  if (pct === null) return { color: (c) => c.muted, text: 'text-fg-muted', bar: 'bg-muted', label: 'n/a' }
  if (pct >= COVERAGE_TARGET) return { color: (c) => c.good, text: 'text-success', bar: 'bg-success', label: 'good' }
  if (pct >= 50) return { color: (c) => c.warn, text: 'text-warning', bar: 'bg-warning', label: 'fair' }
  return { color: (c) => c.bad, text: 'text-danger', bar: 'bg-danger', label: 'low' }
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

/** A bar with a tick at the target, so "how far from 80%" reads at a glance. */
export function TargetBar({ pct, className, target = COVERAGE_TARGET }: { pct: number; className: string; target?: number }) {
  return (
    <div className="relative w-full h-2 bg-muted rounded-full">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
      <span className="absolute top-[-2px] h-3 w-px bg-line-strong" style={{ left: `${target}%` }} aria-hidden="true" />
    </div>
  )
}

/** A card that links to the page with the full detail. */
function Card({ to, title, aside, children, className = '' }: { to?: Page; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const header = (
    <div className="flex items-center justify-between mb-3 gap-3">
      <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
      <span className="flex items-center gap-2 text-xs text-fg-subtle">
        {aside}
        {to && <ArrowRight className="w-4 h-4 text-fg-subtle group-hover:text-accent transition-colors" aria-hidden="true" />}
      </span>
    </div>
  )
  const cls = `card p-4 block min-w-0 ${className}`
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

/** A one-line summary card: title, then a sentence. */
function LineCard({ to, title, children }: { to: Page; title: string; children: ReactNode }) {
  return (
    <a href={routeToHash({ page: to })} className="card p-4 block min-w-0 group hover:border-accent/50 transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
        <ArrowRight className="w-4 h-4 text-fg-subtle group-hover:text-accent transition-colors" aria-hidden="true" />
      </div>
      <div className="text-sm min-w-0">{children}</div>
    </a>
  )
}

function shortPkg(name: string, project: string): string {
  return name.replace(project + '/', '') || name
}

export default function Dashboard({ result, scan, scanning, readingResults, onScan, onShowScan }: Props) {
  const colors = useThemeColors()
  const showProgress = scanning || readingResults

  const grade = useMemo(() => gradeDetails(result?.issues ?? []), [result])

  // Where to start: the heaviest issues, then the least-covered package.
  const startIssues = useMemo(() => [...(result?.issues ?? [])].sort(compareBySeverityThenValue).slice(0, 3), [result])

  if (!result) {
    return (
      <div className="page">
        {showProgress ? (
          <ScanProgress state={scan} readingResults={readingResults} onDetails={onShowScan} />
        ) : (
          <EmptyState message="No scan results yet" hint="Run a scan to analyze this project." onScan={onScan} scanning={scanning} />
        )}
      </div>
    )
  }

  const security = result.issues.filter((i) => i.category === 'security')
  const testResult = result.test_results
  const total = testResult?.total
  const passRate = total && total.total > 0 ? (total.passed / total.total) * 100 : null
  const withTests: TestPackage[] = testResult?.packages.filter((p) => (p.tests?.length ?? 0) > 0 || p.coverage > 0) ?? []
  const avgCoverage = withTests.length > 0 ? withTests.reduce((s, p) => s + p.coverage, 0) / withTests.length : null
  const gradeStyle = GRADE_STYLE[grade.grade] ?? GRADE_STYLE.C
  const totalComments = result.file_stats?.reduce((s, f) => s + f.comment_lines, 0) ?? 0
  const totalCode = result.file_stats?.reduce((s, f) => s + f.code_lines, 0) ?? 0
  const passStatus = rateStatus(passRate)
  const covStatus = rateStatus(avgCoverage)
  const benchmarks = result.benchmarks ?? []
  const zeroAlloc = benchmarks.filter((b) => b.allocs_per_op === 0).length
  const medianBench = benchmarks.length ? [...benchmarks].sort((a, b) => a.time_per_op - b.time_per_op)[Math.floor(benchmarks.length / 2)].time_per_op : null
  const git = result.git_info
  const lowestCoverage = withTests.length ? [...withTests].sort((a, b) => a.coverage - b.coverage)[0] : null
  const coverageSorted = [...withTests].sort((a, b) => a.coverage - b.coverage)
  const commentPct = totalCode > 0 ? ((totalComments / (totalCode + totalComments)) * 100).toFixed(0) : null

  return (
    <div className="page space-y-6">
      {showProgress && <ScanProgress state={scan} readingResults={readingResults} onDetails={onShowScan} />}

      {result.modules && result.modules.length > 1 && (
        <p className="text-sm text-fg-muted"><span className="text-violet font-medium">{result.modules.length} workspace modules</span> scanned together.</p>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <a href={routeToHash({ page: 'issues' })} className={`rounded-lg border border-line p-4 min-w-0 ${gradeStyle.bg} hover:border-accent/50 transition-colors`}>
          <div className="flex items-center gap-3">
            <span className={`text-5xl font-bold leading-none ${gradeStyle.text}`} aria-label={`Grade ${grade.grade}`}>{grade.grade}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">Code grade</span>
              <span className="block text-xs text-fg-muted">
                Score {grade.score}{grade.next ? ` · ${grade.next.grade} at ≤ ${grade.next.ceiling}` : ` · ${gradeStyle.note}`}
              </span>
            </span>
          </div>
          <div className="mt-3 h-1.5 bg-muted/60 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${gradeStyle.bar}`} style={{ width: `${Math.max(4, grade.bandFraction * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-fg-muted leading-snug">
            {grade.score === 0 ? 'No issues found.' : (
              <>
                {(['error', 'warning', 'info'] as const).filter((s) => grade.counts[s] > 0).map((s) => `${grade.counts[s]} ${s}${grade.counts[s] === 1 ? '' : 's'} × ${s === 'error' ? 10 : s === 'warning' ? 3 : 1} pt${s === 'info' ? '' : 's'}`).join(' + ')}
                {grade.next && <>. Fix <b className="text-fg">{grade.next.fix}</b> {grade.next.severity}{grade.next.fix === 1 ? '' : 's'} to reach {grade.next.grade}.</>}
              </>
            )}
          </p>
        </a>

        <Card to="issues" title="Issues">
          <p className="text-3xl font-semibold tabular-nums">{result.issues.length}</p>
          <p className="mt-2 text-sm text-fg-muted">
            {grade.counts.warning > 0 && <span className="text-warning font-medium">{grade.counts.warning} warnings</span>}
            {grade.counts.warning > 0 && ' · '}
            <span className={grade.counts.error > 0 ? 'text-danger font-medium' : ''}>{grade.counts.error} errors</span> · {grade.counts.info} info
          </p>
        </Card>

        <Card to="tests" title="Tests">
          <div className="flex items-center gap-3">
            <Ring pct={passRate ?? 0} color={passStatus.color(colors)} />
            <div className="min-w-0">
              <p className="text-3xl font-semibold tabular-nums">
                {total ? total.passed : '—'}{total && <span className="text-base text-fg-subtle font-normal">/{total.total}</span>}
              </p>
              {total && (
                <p className="text-sm">
                  {total.failed > 0 ? (
                    <span className="inline-flex items-center gap-1 text-danger"><CircleX className="w-3.5 h-3.5" /> {total.failed} failed</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-success"><CircleCheck className="w-3.5 h-3.5" /> 0 failed</span>
                  )}
                  {total.skipped > 0 && <span className="text-fg-muted"> · {total.skipped} skipped</span>}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card to="tests" title="Coverage">
          <div className="flex items-center gap-3">
            <Ring pct={avgCoverage ?? 0} color={covStatus.color(colors)} />
            <div className="min-w-0">
              <p className="text-3xl font-semibold tabular-nums">{avgCoverage !== null ? `${avgCoverage.toFixed(0)}%` : '—'}</p>
              <p className="text-sm text-fg-muted truncate">
                <span className={`font-medium ${covStatus.text}`}>{covStatus.label}</span> · average of {withTests.length} package{withTests.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </Card>

        <Card title="Code">
          <p className="text-3xl font-semibold tabular-nums">{fmtCount(result.total_lines)}</p>
          <p className="text-sm text-fg-muted">lines in {result.go_files} Go files{commentPct !== null ? ` · ${commentPct}% comments` : ''}</p>
        </Card>
      </div>

      {/* Coverage and where to start */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
        {coverageSorted.length > 0 && (
          <Card to="tests" title="Coverage by package" aside={<span>sorted lowest first · target {COVERAGE_TARGET}%</span>}>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              {coverageSorted.map((p) => {
                const st = rateStatus(p.coverage)
                return (
                  <li key={p.name} className="grid grid-cols-[minmax(0,1fr)_7rem_2.75rem] items-center gap-3 text-sm">
                    <span className="font-mono text-[13px] truncate" title={p.name}>{shortPkg(p.name, result.project_name)}</span>
                    <TargetBar pct={p.coverage} className={st.bar} />
                    <span className={`text-right tabular-nums font-medium ${st.text}`}>{p.coverage.toFixed(0)}%</span>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}

        <Card title="Where to start">
          {startIssues.length === 0 && !lowestCoverage ? (
            <p className="text-sm text-success inline-flex items-center gap-2"><CircleCheck className="w-4 h-4" /> Nothing to fix. Nice.</p>
          ) : (
            <ul className="space-y-3">
              {startIssues.map((iss) => <StartIssue key={iss.id} issue={iss} />)}
              {lowestCoverage && lowestCoverage.coverage < COVERAGE_TARGET && (
                <li>
                  <a href={routeToHash({ page: 'tests' })} className="group/item block min-w-0">
                    <span className="flex items-center gap-2 text-sm">
                      <FlaskConical className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />
                      <span className="font-mono font-medium truncate group-hover/item:text-accent">{shortPkg(lowestCoverage.name, result.project_name)}</span>
                      <span className="text-fg-muted shrink-0">{lowestCoverage.coverage.toFixed(0)}% coverage</span>
                    </span>
                    <span className="block ml-[1.375rem] text-xs text-fg-subtle">{lowestCoverage.tests?.length ?? 0} test{(lowestCoverage.tests?.length ?? 0) === 1 ? '' : 's'}</span>
                  </a>
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>

      {/* One-line summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LineCard to="security" title="Security">
          {security.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-success"><ShieldCheck className="w-4 h-4" /> No security findings</p>
          ) : (
            <p className="inline-flex items-center gap-2 text-danger font-medium"><ShieldAlert className="w-4 h-4" /> {security.length} finding{security.length === 1 ? '' : 's'}</p>
          )}
          {result.deps && (
            <p className="text-xs text-fg-subtle mt-1">{result.deps.length} dependencies · {result.deps.filter((d) => d.indirect).length} indirect</p>
          )}
        </LineCard>

        <LineCard to="performance" title="Benchmarks">
          {benchmarks.length === 0 ? (
            <p className="text-fg-muted">No benchmarks found.</p>
          ) : (
            <p><b className="tabular-nums">{benchmarks.length}</b> benchmarks · median {fmtDurationNS(medianBench!)} · {zeroAlloc} allocation-free</p>
          )}
        </LineCard>

        <LineCard to="git" title="Git">
          {git ? (
            <p className="truncate">
              <span className="font-mono">{git.commit.slice(0, 7)}</span> · {git.commits?.length ?? 0} commits · {git.author_count} author{git.author_count === 1 ? '' : 's'}
              {git.commits?.[0] && <> · {new Date(git.commits[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</>}
              <span className="inline-flex items-center gap-1 ml-2 text-xs text-fg-subtle"><GitBranch className="w-3 h-3" aria-hidden="true" />{git.branch}</span>
            </p>
          ) : (
            <p className="text-fg-muted">Not a git repository.</p>
          )}
        </LineCard>
      </div>

      <Trends onScan={onScan} />
    </div>
  )
}

function StartIssue({ issue }: { issue: Issue }) {
  const measure = issueMeasure(issue)
  return (
    <li>
      <a href={routeToHash({ page: 'issue', param: issue.id })} className="group/item block min-w-0">
        <span className="flex items-center gap-2 text-sm">
          <SeverityIcon severity={issue.severity} className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono font-medium truncate group-hover/item:text-accent">{issueSubject(issue)}</span>
          <span className="text-fg-muted shrink-0">{measure ? `${measure.unit} ${measure.value}` : issue.rule}</span>
        </span>
        <span className="block ml-[1.375rem] text-xs text-fg-subtle font-mono truncate">{issue.file}{issue.line ? `:${issue.line}` : ''}</span>
      </a>
    </li>
  )
}
