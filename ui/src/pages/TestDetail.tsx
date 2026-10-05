import { Terminal } from 'lucide-react'
import { TestResult, Issue } from '../api/client'
import BackLink from '../components/BackLink'
import CopyButton from '../components/CopyButton'
import FileLink from '../components/FileLink'
import TestStatus from '../components/TestStatus'
import { rerunCommand } from '../lib/tests'

interface Props {
  testResult: TestResult | null
  issues: Issue[]
  pkgName: string
  testName: string
  onBack: () => void
}

export default function TestDetail({ testResult, issues, pkgName, testName, onBack }: Props) {
  const pkg = testResult?.packages?.find((p) => p.name === pkgName)
  const test = pkg?.tests?.find((t) => t.name === testName)

  const relatedIssue = issues.find((i) => i.id === `test-fail-${pkgName}-${testName}`)
  const outputLines = test?.output ? test.output.trim().split('\n').filter(Boolean) : []

  if (!test || !pkg) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <BackLink onClick={onBack} />
        <div className="card p-8 text-center text-fg-muted">This test is not in the current results.</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <BackLink onClick={onBack} />

      <section className="card overflow-hidden mb-6">
        <header className="px-6 py-4 border-b border-line">
          <div className="flex items-center gap-3 mb-1">
            <TestStatus status={test.status} />
            {test.duration > 0 && <span className="text-sm text-fg-muted font-mono tabular-nums">{(test.duration / 1e9).toFixed(3)}s</span>}
          </div>
          <h2 className="text-lg font-semibold font-mono break-all">{test.name}</h2>
          <p className="text-sm font-mono text-fg-muted break-all">{pkgName}</p>
          {test.file && <FileLink file={test.file} line={test.line} className="mt-2 text-sm" />}
        </header>
        <div className="px-6 py-3 flex items-center gap-3 bg-subtle/50">
          <Terminal className="w-4 h-4 text-fg-muted shrink-0" aria-hidden="true" />
          <code className="flex-1 min-w-0 truncate font-mono text-[13px]" title={rerunCommand(pkgName, test.name)}>{rerunCommand(pkgName, test.name)}</code>
          <CopyButton text={rerunCommand(pkgName, test.name)} label="Copy command" />
        </div>
      </section>

      {relatedIssue && (
        <div className="bg-danger-soft border border-danger/30 rounded-lg overflow-hidden mb-6">
          <div className="px-6 py-3 border-b border-danger/30 flex items-center gap-2">
            <p className="text-sm font-semibold text-danger">Failure</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-sm text-fg mb-2">{relatedIssue.message}</p>
            {relatedIssue.solution && (
              <div className="bg-surface border border-danger/30 rounded p-3 text-sm leading-relaxed text-fg">
                {relatedIssue.solution}
              </div>
            )}
          </div>
        </div>
      )}

      {outputLines.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="px-6 py-3 border-b border-line flex items-center justify-between">
            <p className="text-sm font-medium">Output <span className="text-fg-muted font-normal">({outputLines.length} lines)</span></p>
            <CopyButton text={outputLines.join('\n')} label="Copy output" />
          </div>
          <div className="max-h-[32rem] overflow-y-auto bg-canvas py-2">
            {outputLines.map((line, i) => {
              const isAssertion = /\.go:\d+:/.test(line)
              const isError = /Error|Fail|unexpected|expected|got/i.test(line)
              return (
                <div
                  key={i}
                  className={`px-6 py-0.5 text-[13px] font-mono leading-6 whitespace-pre-wrap break-all ${
                    isAssertion && isError ? 'bg-danger-soft text-danger' : 'text-fg'
                  }`}
                >
                  {line}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-sm text-fg-muted">No output recorded for this test.</div>
      )}
    </div>
  )
}
