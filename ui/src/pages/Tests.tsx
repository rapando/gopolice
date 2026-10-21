import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { TestResult, TestPackage } from '../api/client'
import TestStatus from '../components/TestStatus'
import StatTile from '../components/StatTile'
import CoverageBar from '../components/CoverageBar'
import { sortTests } from '../lib/tests'
import { averageCoverage, packagesWithTests, rateStatus, shortPackage } from '../lib/coverage'
import EmptyState from '../components/EmptyState'

interface Props {
  testResult: TestResult | null
  projectName?: string
  onScan?: () => void
  scanning?: boolean
  onSelectTest?: (pkgName: string, testName: string) => void
}

export default function Tests({ testResult, projectName, onScan, scanning, onSelectTest }: Props) {
  if (!testResult) {
    return (
      <div className="page">
        <EmptyState message="No test results available." onScan={onScan} scanning={scanning} />
      </div>
    )
  }
  if (!testResult.total) {
    return (
      <div className="page">
        <div className="card p-10 text-center">
          <p className="text-fg-muted mb-3">Test result data is incomplete: the scan may not have produced full output for this run.</p>
          <details className="text-left max-w-lg mx-auto">
            <summary className="text-xs text-fg-subtle cursor-pointer select-none hover:text-fg-muted">Technical details</summary>
            <pre className="mt-2 text-xs text-left bg-subtle p-3 rounded overflow-auto">{JSON.stringify(testResult, null, 2)}</pre>
          </details>
        </div>
      </div>
    )
  }

  const total = testResult.total
  const packages = testResult.packages ?? []
  const tested = packagesWithTests(packages)
  const coverage = averageCoverage(packages)
  const covStatus = rateStatus(coverage)

  return (
    <div className="page">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatTile label="Tests" value={total.total} sub={`in ${tested.length} package${tested.length === 1 ? '' : 's'}`} />
        <StatTile label="Passed" value={total.passed} tone={total.passed > 0 ? 'success' : 'default'} />
        <StatTile label="Failed" value={total.failed} tone={total.failed > 0 ? 'danger' : 'default'} />
        <StatTile label="Skipped" value={total.skipped} tone={total.skipped > 0 ? 'warning' : 'muted'} sub={total.skipped > 0 ? 'called t.Skip' : undefined} />
        <StatTile
          label="Coverage"
          value={coverage === null ? '—' : `${coverage.toFixed(0)}%`}
          tone={covStatus.key === 'good' ? 'success' : covStatus.key === 'warn' ? 'warning' : covStatus.key === 'bad' ? 'danger' : 'muted'}
          sub={coverage === null ? 'no coverage reported' : `${covStatus.label} · average of ${tested.length} package${tested.length === 1 ? '' : 's'}`}
        />
      </div>

      {packages.length === 0 ? (
        <div className="card p-8 text-center text-fg-muted">No test packages found.</div>
      ) : (
        <PackageList packages={packages} projectName={projectName} onSelectTest={onSelectTest} />
      )}
    </div>
  )
}

type SortKey = 'name' | 'coverage' | 'tests'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'coverage', label: 'Coverage, lowest first' },
  { id: 'tests', label: 'Test count' },
]

function PackageList({ packages, projectName, onSelectTest }: { packages: TestPackage[]; projectName?: string; onSelectTest?: (pkg: string, test: string) => void }) {
  const [query, setQuery] = useState('')
  const [failingOnly, setFailingOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [open, setOpen] = useState<Set<string>>(() => new Set(packages.filter((p) => p.status !== 'ok' && p.status !== '?').map((p) => p.name)))

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const hasTests = (p: TestPackage) => (p.tests?.length ?? 0) > 0 || p.coverage > 0
    const rank = (p: TestPackage) => (p.status === 'FAIL' ? 0 : hasTests(p) ? 1 : 2) // failing, tested, no tests
    const cmp = (a: TestPackage, b: TestPackage) => {
      const r = rank(a) - rank(b)
      if (r !== 0) return r
      switch (sort) {
        case 'coverage': return a.coverage - b.coverage || a.name.localeCompare(b.name)
        case 'tests': return (b.tests?.length ?? 0) - (a.tests?.length ?? 0) || a.name.localeCompare(b.name)
        default: return a.name.localeCompare(b.name)
      }
    }
    return packages
      .map((p) => ({
        ...p,
        tests: (p.tests ?? []).filter((t) => (!failingOnly || t.status === 'FAIL') && (!q || t.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))),
      }))
      .filter((p) => p.tests.length > 0 || (!failingOnly && !q))
      .sort(cmp)
  }, [packages, q, failingOnly, sort])

  const filtering = failingOnly || q !== ''
  const toggle = (name: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative w-80 max-w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter tests or packages…" aria-label="Filter tests" className="input w-full pl-8" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={failingOnly} onChange={(e) => setFailingOnly(e.target.checked)} className="w-4 h-4" />
          Failing only
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input py-1">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        <button onClick={() => setOpen(new Set(packages.map((p) => p.name)))} className="btn-ghost">Expand all</button>
        <button onClick={() => setOpen(new Set())} className="btn-ghost">Collapse all</button>
      </div>

      {projectName && (
        <p className="mb-2 text-xs text-fg-subtle">Packages under <span className="font-mono">{projectName}</span></p>
      )}

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-fg-muted">No tests match.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((pkg) => {
            const noTests = pkg.status === '?' || ((pkg.tests?.length ?? 0) === 0 && pkg.coverage === 0 && !filtering)
            const isOpen = !noTests && (filtering || open.has(pkg.name))
            const failed = pkg.tests.filter((t) => t.status === 'FAIL').length
            const skipped = pkg.tests.filter((t) => t.status === 'SKIP').length
            const Chevron = isOpen ? ChevronDown : ChevronRight
            return (
              <section key={pkg.name} className={`card overflow-hidden ${noTests ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => !noTests && toggle(pkg.name)}
                  aria-expanded={noTests ? undefined : isOpen}
                  disabled={noTests}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <Chevron className={`w-4 h-4 text-fg-muted shrink-0 ${noTests ? 'invisible' : ''}`} aria-hidden="true" />
                  {noTests ? (
                    <span className="w-4 h-4 shrink-0 rounded-full border border-line-strong" aria-hidden="true" />
                  ) : (
                    <TestStatus status={pkg.status === 'ok' ? 'PASS' : pkg.status === '?' ? 'SKIP' : 'FAIL'} withLabel={false} />
                  )}
                  <span className="font-mono text-[13px] font-medium truncate flex-1" title={pkg.name}>{shortPackage(pkg.name, projectName)}</span>
                  <span className="text-sm text-fg-muted tabular-nums shrink-0">
                    {noTests ? 'no test files' : (
                      <>
                        {pkg.tests.length} test{pkg.tests.length === 1 ? '' : 's'}
                        {failed > 0 && <span className="text-danger font-medium"> · {failed} failing</span>}
                        {skipped > 0 && <span className="text-warning"> · {skipped} skipped</span>}
                      </>
                    )}
                  </span>
                  {!noTests && (
                    <span className="flex items-center gap-2 shrink-0 w-36">
                      <CoverageBar pct={pkg.coverage} className="flex-1" />
                      <span className={`text-sm tabular-nums w-10 text-right font-medium ${rateStatus(pkg.coverage).text}`}>{pkg.coverage.toFixed(0)}%</span>
                    </span>
                  )}
                </button>
                {isOpen && pkg.tests.length > 0 && (
                  <ul className="border-t border-line divide-y divide-line">
                    {sortTests(pkg.tests).map((t) => (
                      <li key={t.name}>
                        <button
                          onClick={() => onSelectTest?.(pkg.name, t.name)}
                          className={`w-full flex items-center gap-3 pl-11 pr-4 py-1.5 text-left text-sm ${t.status === 'FAIL' ? 'bg-danger-soft/60 hover:bg-danger-soft' : 'hover:bg-subtle/60'}`}
                        >
                          <span className="w-16 shrink-0"><TestStatus status={t.status} /></span>
                          <span className="font-mono text-[13px] truncate">{t.name}</span>
                          {t.duration > 0 && <span className="ml-auto text-xs text-fg-muted font-mono tabular-nums">{(t.duration / 1e9).toFixed(3)}s</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
