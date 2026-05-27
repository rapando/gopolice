import { useState, useEffect } from 'react'
import { getTrends, TrendPoint, TrendsData } from '../api/client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

type Range = '7d' | '30d' | '90d' | 'all'

const ranges: { key: Range; label: string; days: number | null }[] = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

function filterPoints(points: TrendPoint[], range: Range): TrendPoint[] {
  if (range === 'all') return points
  const cutoff = Date.now() - (ranges.find((r) => r.key === range)?.days ?? 30) * 86400000
  return points.filter((p) => new Date(p.timestamp).getTime() >= cutoff)
}

function gradeToNum(g: string): number {
  return { A: 5, B: 4, C: 3, D: 2, F: 1 }[g] ?? 0
}

function formatTS(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Trends() {
  const [data, setData] = useState<TrendsData | null>(null)
  const [range, setRange] = useState<Range>('30d')
  const [loading, setLoading] = useState(true)
  const [activeChart, setActiveChart] = useState<'issues' | 'grade' | 'coverage' | 'bench'>('issues')

  useEffect(() => {
    setLoading(true)
    getTrends()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide mb-4">Trends</h3>
        <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded p-8 text-center">
          <p className="text-gray-400 dark:text-ctp-subtext0 text-sm">Loading trends...</p>
        </div>
      </div>
    )
  }

  if (!data || !data.points || data.points.length < 2) {
    return null
  }

  const filtered = filterPoints(data.points, range)
  if (filtered.length < 2) return null

  const issueData = filtered.map((p) => ({
    ts: formatTS(p.timestamp),
    Errors: p.errors,
    Warnings: p.warnings,
    Infos: p.infos,
  }))

  const gradeData = filtered.map((p) => ({
    ts: formatTS(p.timestamp),
    Grade: gradeToNum(p.grade),
    gradeLabel: p.grade,
  }))

  const coverageData = filtered.map((p) => ({
    ts: formatTS(p.timestamp),
    Coverage: Math.round(p.coverage * 10) / 10,
  }))

  const benchData = filtered.map((p) => ({
    ts: formatTS(p.timestamp),
    'ns/op': Math.round(p.bench_ns_op),
  }))

  const tabs = [
    { key: 'issues' as const, label: 'Issues' },
    { key: 'grade' as const, label: 'Grade' },
    { key: 'coverage' as const, label: 'Coverage' },
    { key: 'bench' as const, label: 'Benchmarks' },
  ]

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-ctp-subtext1 uppercase tracking-wide">Trends</h3>
        <div className="flex items-center gap-1">
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                range === r.key
                  ? 'bg-blue-100 text-blue-700 dark:bg-ctp-surface1 dark:text-ctp-lavender'
                  : 'text-gray-500 hover:text-gray-700 dark:text-ctp-subtext0 dark:hover:text-ctp-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-ctp-surface0 border border-gray-200 dark:border-ctp-surface1 rounded overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-ctp-surface1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveChart(t.key)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                activeChart === t.key
                  ? 'text-blue-600 border-b-2 border-blue-500 dark:text-ctp-lavender dark:border-ctp-lavender'
                  : 'text-gray-500 hover:text-gray-700 dark:text-ctp-subtext0 dark:hover:text-ctp-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeChart === 'issues' && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={issueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Errors" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Warnings" stroke="#eab308" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Infos" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {activeChart === 'grade' && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={gradeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0.5, 5.5]} ticks={[1, 2, 3, 4, 5]} tickFormatter={(v: any) => ['', 'F', 'D', 'C', 'B', 'A'][v] ?? ''} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Line type="stepAfter" dataKey="Grade" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {activeChart === 'coverage' && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={coverageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" unit="%" />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Coverage']} />
                <Line type="monotone" dataKey="Coverage" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {activeChart === 'bench' && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={benchData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit=" ns" />
                <Tooltip formatter={(v: any) => [`${(v ?? 0).toLocaleString()} ns/op`, 'Avg']} />
                <Line type="monotone" dataKey="ns/op" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
