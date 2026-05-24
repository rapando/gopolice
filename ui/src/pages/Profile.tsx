import { ProfileData, ProfileEntry } from '../api/client'

interface Props {
  profile: ProfileData | null
  onScan?: () => void
  scanning?: boolean
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

export default function Profile({ profile, onScan, scanning }: Props) {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <h2 className="text-lg font-bold text-gray-800 dark:text-ctp-text mb-5">Profile</h2>

      {!profile ? (
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
          <p className="text-gray-500 dark:text-ctp-overlay0 mb-4">No profile data available.</p>
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
        <>
          {!profile.cpu && !profile.mem ? (
            <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-10 text-center">
              <p className="text-gray-500 dark:text-ctp-overlay0">No profile data collected (benchmarks may have no test files).</p>
            </div>
          ) : (
            <>
              <ProfileTable title="CPU Profile" entries={profile.cpu} unit="s" />
              <ProfileTable title="Memory Profile" entries={profile.mem} unit="MB" />
            </>
          )}
        </>
      )}
    </div>
  )
}
