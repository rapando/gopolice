import { TestResult, Test } from '../api/client'

interface Props {
  testResult: TestResult | null
  onScan?: () => void
  scanning?: boolean
  onSelectTest?: (pkgName: string, testName: string) => void
}

const sortTests = (tests: Test[]) =>
  [...tests].sort((a, b) => {
    const order: Record<string, number> = { FAIL: 0, SKIP: 1, PASS: 2 }
    return (order[a.status] ?? 3) - (order[b.status] ?? 3)
  })

export default function Tests({ testResult, onScan, scanning, onSelectTest }: Props) {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 mb-5">Tests</h2>

      {!testResult ? (
        <div className="bg-white border border-gray-200 rounded p-10 text-center">
          <p className="text-gray-500 mb-4">No test results available.</p>
          {onScan && (
            <button
              onClick={onScan}
              disabled={scanning}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {scanning ? 'Scanning...' : 'Run Scan'}
            </button>
          )}
        </div>
      ) : (
        <>
          {!testResult.total ? (
            <div className="bg-white border border-gray-200 rounded p-10 text-center">
              <p className="text-red-500">Test result data is incomplete.</p>
              <pre className="mt-2 text-xs text-left bg-gray-100 p-3 rounded overflow-auto">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white border border-gray-200 rounded px-5 py-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-0.5">Total</p>
                  <p className="text-2xl font-bold">{testResult.total.total}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded px-5 py-4 border-l-4 border-l-green-500">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-0.5">Passed</p>
                  <p className="text-2xl font-bold text-green-600">{testResult.total.passed}</p>
                </div>
                <div className="bg-white border border-gray-200 rounded px-5 py-4 border-l-4 border-l-red-500">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-0.5">Failed</p>
                  <p className={`text-2xl font-bold ${testResult.total.failed > 0 ? 'text-red-600' : ''}`}>
                    {testResult.total.failed}
                  </p>
                </div>
                <div className="bg-white border border-gray-200 rounded px-5 py-4 border-l-4 border-l-blue-500">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-0.5">Pass Rate</p>
                  <p className="text-2xl font-bold">
                    {testResult.total.total > 0
                      ? ((testResult.total.passed / testResult.total.total) * 100).toFixed(1)
                      : '0'}%
                  </p>
                </div>
              </div>

              {!testResult.packages || testResult.packages.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded p-8 text-center">
                  <p className="text-gray-500">No test packages found.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {testResult.packages.map((pkg) => (
                    <div key={pkg.name} className="bg-white border border-gray-200 rounded">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                        <span className="text-sm font-medium font-mono text-gray-800">{pkg.name}</span>
                        <div className="flex items-center gap-4">
                          {pkg.coverage > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(pkg.coverage, 100)}%` }} />
                              </div>
                              <span className="text-xs font-mono text-gray-500 tabular-nums">{pkg.coverage.toFixed(1)}%</span>
                            </div>
                          )}
                          <span className={`text-xs font-medium ${pkg.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                            {pkg.status}
                          </span>
                        </div>
                      </div>
                          {pkg.tests && pkg.tests.length > 0 && (
                        <div className="divide-y divide-gray-100">
                          {sortTests(pkg.tests).map((t) => (
                            <div
                              key={t.name}
                              onClick={() => onSelectTest?.(pkg.name, t.name)}
                              className={`flex items-center gap-2.5 px-5 py-1.5 text-sm cursor-pointer transition-colors ${
                                t.status === 'FAIL' ? 'bg-red-50/50 hover:bg-red-100/50' : t.status === 'SKIP' ? 'bg-yellow-50/50 hover:bg-yellow-100/50' : 'hover:bg-gray-100/50'
                              }`}
                            >
                              <span className={`w-12 text-xs font-medium ${
                                t.status === 'PASS' ? 'text-green-600'
                                  : t.status === 'FAIL' ? 'text-red-600'
                                  : 'text-yellow-600'
                              }`}>{t.status}</span>
                              <span className="text-gray-700">{t.name}</span>
                              {t.duration > 0 && <span className="text-xs text-gray-400 ml-auto font-mono tabular-nums">{(t.duration / 1e9).toFixed(3)}s</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
