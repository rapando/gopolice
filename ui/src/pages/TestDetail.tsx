import { useState, useEffect } from 'react'
import { TestResult, Issue, getSnippet, Snippet } from '../api/client'

interface Props {
  testResult: TestResult | null
  issues: Issue[]
  pkgName: string
  testName: string
  onBack: () => void
}

const statusBadge: Record<string, string> = {
  PASS: 'bg-green-50 text-green-700',
  FAIL: 'bg-red-50 text-red-700',
  SKIP: 'bg-yellow-50 text-yellow-700',
}

export default function TestDetail({ testResult, issues, pkgName, testName, onBack }: Props) {
  const pkg = testResult?.packages?.find((p) => p.name === pkgName)
  const test = pkg?.tests?.find((t) => t.name === testName)

  const [snippet, setSnippet] = useState<Snippet | null>(null)

  const relatedIssue = issues.find((i) => i.id === `test-fail-${pkgName}-${testName}`)

  const outputLines = test?.output ? test.output.trim().split('\n').filter(Boolean) : []

  const fileLineMatch = outputLines.length > 0
    ? outputLines[0].match(/^(.+?\.go):(\d+):/)
    : null
  const filePath = fileLineMatch?.[1]
  const fileLine = fileLineMatch ? parseInt(fileLineMatch[2]) : 0

  useEffect(() => {
    if (filePath && fileLine) {
      getSnippet(filePath, fileLine).then(setSnippet).catch(() => {})
    }
  }, [filePath, fileLine])

  if (!test || !pkg) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline mb-4">&larr; Back to tests</button>
        <div className="bg-white border border-gray-200 rounded p-8 text-center">
          <p className="text-red-500">Test not found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline mb-5">&larr; Back to tests</button>

      <div className="bg-white border border-gray-200 rounded overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded text-xs font-medium ${statusBadge[test.status] || 'bg-gray-50 text-gray-700'}`}>
            {test.status}
          </span>
          <span className="text-sm font-mono text-gray-800">{pkgName}</span>
          <span className="text-xs text-gray-500">/</span>
          <span className="text-sm font-medium text-gray-800">{test.name}</span>
          {test.duration > 0 && (
            <span className="text-xs text-gray-400 ml-auto font-mono">{(test.duration / 1e9).toFixed(3)}s</span>
          )}
        </div>

        <div className="px-6 py-4 grid grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Status</p>
            <p className={`font-medium ${test.status === 'FAIL' ? 'text-red-600' : test.status === 'SKIP' ? 'text-yellow-600' : 'text-green-600'}`}>
              {test.status}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Duration</p>
            <p className="font-mono text-gray-700">{(test.duration / 1e9).toFixed(3)}s</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Package</p>
            <p className="font-mono text-gray-700 truncate">{pkgName}</p>
          </div>
        </div>
      </div>

      {relatedIssue && (
        <div className="bg-red-50 border border-red-200 rounded overflow-hidden mb-6">
          <div className="px-6 py-3 border-b border-red-200 flex items-center gap-2">
            <span className="text-red-500 text-base">●</span>
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Failure</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-sm text-red-800 mb-2">{relatedIssue.message}</p>
            {relatedIssue.solution && (
              <div className="bg-white border border-red-100 rounded p-3 text-sm leading-relaxed text-gray-700">
                {relatedIssue.solution}
              </div>
            )}
          </div>
        </div>
      )}

      {outputLines.length > 0 && (
        <div className="bg-white border border-gray-200 rounded overflow-hidden mb-6">
          <div className="px-6 py-3 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Logged output ({outputLines.length} lines)</p>
          </div>
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {outputLines.map((line, i) => {
              const isAssertion = /\.go:\d+:/.test(line)
              const isError = /Error|Fail|unexpected|expected|got/i.test(line)
              return (
                <div
                  key={i}
                  className={`px-6 py-1.5 text-xs font-mono leading-relaxed ${
                    isAssertion && isError ? 'bg-red-50/50 text-red-800' : isAssertion ? 'bg-yellow-50/50 text-gray-700' : 'text-gray-600'
                  }`}
                >
                  {line}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {snippet && (
        <div className="bg-white border border-gray-200 rounded overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Code <span className="font-normal text-gray-400 normal-case">{filePath}:{fileLine}</span>
            </p>
          </div>
          <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
            {snippet.lines.map((l) => (
              <div
                key={l.number}
                className={`flex ${l.is_issue ? 'bg-red-50 border-l-2 border-red-500' : ''}`}
              >
                <span className="text-gray-400 text-right w-12 shrink-0 select-none py-0.5 pr-3 border-r border-gray-200 mr-3">
                  {l.number}
                </span>
                <span className={`py-0.5 ${l.is_issue ? 'text-red-800 font-medium' : 'text-gray-700'}`}>
                  {l.content || ' '}
                </span>
              </div>
            ))}
          </pre>
        </div>
      )}

      {!outputLines.length && !snippet && !relatedIssue && (
        <div className="bg-white border border-gray-200 rounded p-8 text-center">
          <p className="text-gray-400 text-sm">No details captured for this test.</p>
        </div>
      )}
    </div>
  )
}
