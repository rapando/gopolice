import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { TestResult, TestPackage } from '../api/client'
import TestStatus from '../components/TestStatus'
import { sortTests } from '../lib/tests'
import EmptyState from '../components/EmptyState'

interface Props {
  testResult: TestResult | null
  onScan?: () => void
  scanning?: boolean
  onSelectTest?: (pkgName: string, testName: string) => void
}


export default function Tests({ testResult, onScan, scanning, onSelectTest }: Props) {
  return (
    <div className="max-w-6xl mx-auto p-8">
      {!testResult ? (
        <EmptyState message="No test results available." onScan={onScan} scanning={scanning} />
      ) : (
        <>
          {!testResult.total ? (
            <div className="bg-surface border border-line rounded p-10 text-center">
              <p className="text-fg-muted mb-3">Test result data is incomplete — the scan may not have produced full output for this run.</p>
              <details className="text-left max-w-lg mx-auto">
                <summary className="text-xs text-fg-subtle cursor-pointer select-none hover:text-fg-muted">Technical details</summary>
                <pre className="mt-2 text-xs text-left bg-subtle p-3 rounded overflow-auto">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="card px-5 py-4">
                  <p className="text-sm text-fg-muted mb-0.5">Total</p>
                  <p className="text-2xl font-semibold tabular-nums">{testResult.total.total}</p>
                </div>
                <div className="card px-5 py-4">
                  <p className="text-sm text-fg-muted mb-0.5">Passed</p>
                  <p className="text-2xl font-semibold tabular-nums text-success">{testResult.total.passed}</p>
                </div>
                <div className="card px-5 py-4">
                  <p className="text-sm text-fg-muted mb-0.5">Failed</p>
                  <p className={`text-2xl font-semibold tabular-nums ${testResult.total.failed > 0 ? 'text-danger' : ''}`}>
                    {testResult.total.failed}
                  </p>
                </div>
                <div className="card px-5 py-4">
                  <p className="text-sm text-fg-muted mb-0.5">Pass rate</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {testResult.total.total > 0
                      ? ((testResult.total.passed / testResult.total.total) * 100).toFixed(1)
                      : '0'}%
                  </p>
                </div>
              </div>

              {!testResult.packages || testResult.packages.length === 0 ? (
                <div className="card p-8 text-center text-fg-muted">No test packages found.</div>
              ) : (
                <PackageList packages={testResult.packages} onSelectTest={onSelectTest} />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function PackageList({ packages, onSelectTest }: { packages: TestPackage[]; onSelectTest?: (pkg: string, test: string) => void }) {
  const [query, setQuery] = useState('')
  const [failingOnly, setFailingOnly] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set(packages.filter((p) => p.status !== 'ok').map((p) => p.name)))

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    return packages
      .map((p) => ({
        ...p,
        tests: (p.tests ?? []).filter((t) => (!failingOnly || t.status === 'FAIL') && (!q || t.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))),
      }))
      .filter((p) => p.tests.length > 0 || (!failingOnly && !q))
      .sort((a, b) => Number(a.status === 'ok') - Number(b.status === 'ok') || a.name.localeCompare(b.name))
  }, [packages, q, failingOnly])

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
        <div className="relative w-80">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter tests or packages…" aria-label="Filter tests" className="input w-full pl-8" />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={failingOnly} onChange={(e) => setFailingOnly(e.target.checked)} className="w-4 h-4" />
          Failing only
        </label>
        <div className="flex-1" />
        <button onClick={() => setOpen(new Set(packages.map((p) => p.name)))} className="btn-ghost">Expand all</button>
        <button onClick={() => setOpen(new Set())} className="btn-ghost">Collapse all</button>
      </div>

      {visible.length === 0 ? (
        <div className="card p-8 text-center text-fg-muted">No tests match.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((pkg) => {
            const isOpen = filtering || open.has(pkg.name)
            const failed = pkg.tests.filter((t) => t.status === 'FAIL').length
            const Chevron = isOpen ? ChevronDown : ChevronRight
            return (
              <section key={pkg.name} className="card overflow-hidden">
                <button
                  onClick={() => toggle(pkg.name)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle/60"
                >
                  <Chevron className="w-4 h-4 text-fg-muted shrink-0" aria-hidden="true" />
                  <TestStatus status={pkg.status === 'ok' ? 'PASS' : pkg.status === '?' ? 'SKIP' : 'FAIL'} withLabel={false} />
                  <span className="font-mono text-[13px] font-medium truncate flex-1">{pkg.name}</span>
                  <span className="text-sm text-fg-muted tabular-nums shrink-0">
                    {pkg.tests.length} test{pkg.tests.length === 1 ? '' : 's'}
                    {failed > 0 && <span className="text-danger font-medium"> · {failed} failing</span>}
                  </span>
                  {pkg.coverage > 0 && (
                    <span className="flex items-center gap-2 shrink-0 w-32">
                      <span className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <span className="block h-full bg-success rounded-full" style={{ width: `${Math.min(pkg.coverage, 100)}%` }} />
                      </span>
                      <span className="text-sm tabular-nums text-fg-muted w-10 text-right">{pkg.coverage.toFixed(0)}%</span>
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
