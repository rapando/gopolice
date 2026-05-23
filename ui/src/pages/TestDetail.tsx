import { TestResult, Issue } from '../api/client'

interface Props {
  testResult: TestResult | null
  issues: Issue[]
  pkgName: string
  testName: string
  onBack: () => void
}

const statusBadge: Record<string, string> = {
  PASS: 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-ctp-green',
  FAIL: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-ctp-red',
  SKIP: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-ctp-yellow',
}

export default function TestDetail({ testResult, issues, pkgName, testName, onBack }: Props) {
  const pkg = testResult?.packages?.find((p) => p.name === pkgName)
  const test = pkg?.tests?.find((t) => t.name === testName)

  const relatedIssue = issues.find((i) => i.id === `test-fail-${pkgName}-${testName}`)
  const outputLines = test?.output ? test.output.trim().split('\n').filter(Boolean) : []

  if (!test || !pkg) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <button onClick={onBack} className="text-sm text-blue-600 dark:text-ctp-blue hover:underline mb-4">&larr; Back to tests</button>
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-8 text-center">
          <p className="text-red-500 dark:text-ctp-red">Test not found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <button onClick={onBack} className="text-sm text-blue-600 dark:text-ctp-blue hover:underline mb-5">&larr; Back to tests</button>

      <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-ctp-surface1 flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded text-xs font-medium ${statusBadge[test.status] || 'bg-gray-50 text-gray-700 dark:bg-ctp-mantle dark:text-ctp-subtext0'}`}>
            {test.status}
          </span>
          <span className="text-sm font-mono text-gray-500 dark:text-ctp-overlay0">{pkgName}</span>
          <span className="text-xs text-gray-400 dark:text-ctp-overlay1">/</span>
          <span className="text-sm font-medium text-gray-900 dark:text-ctp-text">{test.name}</span>
          {test.duration > 0 && (
            <span className="text-xs text-gray-400 dark:text-ctp-overlay1 ml-auto font-mono">{(test.duration / 1e9).toFixed(3)}s</span>
          )}
        </div>

        <div className="px-6 py-4 grid grid-cols-4 gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-1">Status</p>
            <p className={`font-medium ${test.status === 'FAIL' ? 'text-red-600 dark:text-ctp-red' : test.status === 'SKIP' ? 'text-yellow-600 dark:text-ctp-yellow' : 'text-green-600 dark:text-ctp-green'}`}>
              {test.status}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-1">Duration</p>
            <p className="font-mono text-gray-700 dark:text-ctp-subtext0">{(test.duration / 1e9).toFixed(3)}s</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-1">Package</p>
            <p className="font-mono text-gray-700 dark:text-ctp-subtext0 truncate">{pkgName}</p>
          </div>
          {test.file && (
            <div>
              <p className="text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide font-medium mb-1">File</p>
              <p className="font-mono text-blue-600 dark:text-ctp-blue truncate text-xs">{test.file}{test.line ? `:${test.line}` : ''}</p>
            </div>
          )}
        </div>
      </div>

      {relatedIssue && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-ctp-red/30 rounded overflow-hidden mb-6">
          <div className="px-6 py-3 border-b border-red-200 dark:border-ctp-red/30 flex items-center gap-2">
            <span className="text-red-500 dark:text-ctp-red text-base">●</span>
            <p className="text-xs font-semibold text-red-700 dark:text-ctp-red uppercase tracking-wide">Failure</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-sm text-red-800 dark:text-ctp-red mb-2">{relatedIssue.message}</p>
            {relatedIssue.solution && (
              <div className="bg-white dark:bg-ctp-surface0 border border-red-100 dark:border-ctp-red/20 rounded p-3 text-sm leading-relaxed text-gray-700 dark:text-ctp-subtext0">
                {relatedIssue.solution}
              </div>
            )}
          </div>
        </div>
      )}

      {outputLines.length > 0 ? (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-200 dark:border-ctp-surface1">
            <p className="text-xs font-semibold text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">Verbose output ({outputLines.length} lines)</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-ctp-surface1 max-h-96 overflow-y-auto">
            {outputLines.map((line, i) => {
              const isAssertion = /\.go:\d+:/.test(line)
              const isError = /Error|Fail|unexpected|expected|got/i.test(line)
              return (
                <div
                  key={i}
                  className={`px-6 py-1.5 text-xs font-mono leading-relaxed ${
                    isAssertion && isError ? 'bg-red-50/50 dark:bg-red-950/20 text-red-800 dark:text-ctp-red' : isAssertion ? 'bg-yellow-50/50 dark:bg-yellow-950/20 text-gray-700 dark:text-ctp-subtext0' : 'text-gray-600 dark:text-ctp-subtext0'
                  }`}
                >
                  {line}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-8 text-center">
          <p className="text-gray-400 dark:text-ctp-overlay1 text-sm">Test passed with no output.</p>
        </div>
      )}
    </div>
  )
}
