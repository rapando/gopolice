import { BenchmarkResult, ProfileData, ProfileEntry } from '../api/client'

interface Props {
  benchmarks: BenchmarkResult[] | null
  profile: ProfileData | null
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

function ProfileTable({ title, entries, unit }: { title: string; entries: ProfileEntry[] | null; unit: string }) {
  if (!entries || entries.length === 0) return null

  const maxFlat = entries.reduce((m, e) => Math.max(m, e.flat), 0)

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-ctp-surface1 text-left text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">
              <th className="pb-3 pr-4 font-medium">Function</th>
              <th className="pb-3 pr-4 font-medium text-right">Flat ({unit})</th>
              <th className="pb-3 pr-4 font-medium text-right">Flat%</th>
              <th className="pb-3 pr-4 font-medium text-right">Cum ({unit})</th>
              <th className="pb-3 pr-4 font-medium text-right">Cum%</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                <td className="py-2.5 pr-4 font-mono text-xs text-gray-800 dark:text-ctp-text max-w-md truncate">{e.function}</td>
                <td className="py-2.5 pr-4 text-right font-mono text-xs text-gray-700 dark:text-ctp-subtext1">
                  <div className="flex items-center justify-end gap-2">
                    <span>{e.flat.toFixed(2)}</span>
                    <div className="w-16 h-1.5 bg-gray-200 dark:bg-ctp-surface1 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 dark:bg-ctp-blue rounded-full"
                        style={{ width: `${maxFlat > 0 ? (e.flat / maxFlat) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-right font-mono text-xs text-gray-700 dark:text-ctp-subtext1">{e.flat_pct.toFixed(2)}%</td>
                <td className="py-2.5 pr-4 text-right font-mono text-xs text-gray-700 dark:text-ctp-subtext1">{e.cum.toFixed(2)}</td>
                <td className="py-2.5 pr-4 text-right font-mono text-xs text-gray-700 dark:text-ctp-subtext1">{e.cum_pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Performance({ benchmarks, profile, onScan, scanning }: Props) {
  const hasBenchmarks = benchmarks && benchmarks.length > 0
  const hasProfile = profile && ((profile.cpu && profile.cpu.length > 0) || (profile.mem && profile.mem.length > 0))

  if (!hasBenchmarks && !hasProfile) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Performance</h2>
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0 mb-4">No performance data available.</p>
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
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Performance</h2>

      {hasBenchmarks && (
        <section className="mb-10">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide mb-3">Benchmarks</h3>
          <div className="overflow-x-auto bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-ctp-surface1 text-left text-xs text-gray-500 dark:text-ctp-overlay0 uppercase tracking-wide">
                  <th className="py-3 px-4 font-medium">Benchmark</th>
                  <th className="py-3 px-4 font-medium text-right">Iterations</th>
                  <th className="py-3 px-4 font-medium text-right">Time/Op</th>
                  <th className="py-3 px-4 font-medium text-right">Bytes/Op</th>
                  <th className="py-3 px-4 font-medium text-right">Allocs/Op</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-ctp-surface1 hover:bg-gray-50 dark:hover:bg-ctp-surface0 transition-colors">
                    <td className="py-3 px-4 font-mono text-sm text-gray-800 dark:text-ctp-text">{b.name}</td>
                    <td className="py-3 px-4 text-right text-gray-600 dark:text-ctp-subtext1">{b.iterations.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{fmtDuration(b.time_per_op)}</td>
                    <td className="py-3 px-4 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{fmtBytes(b.bytes_per_op)}</td>
                    <td className="py-3 px-4 text-right font-mono text-gray-700 dark:text-ctp-subtext1">{b.allocs_per_op}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasProfile && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide mb-3">CPU &amp; Memory Profile</h3>
          <ProfileTable title="CPU" entries={profile!.cpu} unit="s" />
          <ProfileTable title="Memory" entries={profile!.mem} unit="MB" />
        </section>
      )}
    </div>
  )
}
