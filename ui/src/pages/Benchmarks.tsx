import { BenchmarkResult } from '../api/client'

interface Props {
  benchmarks: BenchmarkResult[] | null
  onScan?: () => void
  scanning?: boolean
}

function fmtDuration(ns: number): string {
  if (ns >= 1_000_000_000) return (ns / 1_000_000_000).toFixed(2) + ' s'
  if (ns >= 1_000_000) return (ns / 1_000_000).toFixed(2) + ' ms'
  if (ns >= 1_000) return (ns / 1_000).toFixed(2) + ' µs'
  return ns.toFixed(0) + ' ns'
}

function fmtBytes(b: number): string {
  if (b === 0) return '0'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}

export default function Benchmarks({ benchmarks, onScan, scanning }: Props) {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Benchmarks</h2>

      {!benchmarks || benchmarks.length === 0 ? (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0 mb-4">No benchmark results available.</p>
          {onScan && (
            <button
              onClick={onScan}
              disabled={scanning}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white dark:bg-ctp-green dark:text-ctp-base rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {scanning ? 'Scanning...' : 'Run Scan'}
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-ctp-surface1 text-left text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">
                <th className="pb-3 pr-4 font-medium">Benchmark</th>
                <th className="pb-3 pr-4 font-medium text-right">Iterations</th>
                <th className="pb-3 pr-4 font-medium text-right">Time/Op</th>
                <th className="pb-3 pr-4 font-medium text-right">Bytes/Op</th>
                <th className="pb-3 pr-4 font-medium text-right">Allocs/Op</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                  <td className="py-3 pr-4 font-mono text-sm text-gray-800 dark:text-ctp-text">{b.name}</td>
                  <td className="py-3 pr-4 text-right text-gray-600 dark:text-ctp-subtext1">{b.iterations.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{fmtDuration(b.time_per_op)}</td>
                  <td className="py-3 pr-4 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{fmtBytes(b.bytes_per_op)}</td>
                  <td className="py-3 pr-4 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{b.allocs_per_op}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
