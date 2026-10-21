import { useMemo, useState } from 'react'
import type { BenchmarkResult, ProfileData } from '../api/client'
import { analyzeBenchmarks, benchShortName, type BenchAnalysis, type Callee } from '../lib/perf'

interface Props {
  benchmarks: BenchmarkResult[]
  profile: ProfileData | null
  projectName?: string
}

type SortKey = 'time' | 'allocs' | 'bytes' | 'name'

function fmtNS(ns: number): string {
  if (ns >= 1e9) return (ns / 1e9).toFixed(2) + ' s'
  if (ns >= 1e6) return (ns / 1e6).toFixed(2) + ' ms'
  if (ns >= 1e3) return (ns / 1e3).toFixed(1) + ' µs'
  return ns.toFixed(0) + ' ns'
}

function fmtBytes(b: number): string {
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}

const TONE_CHIP = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-accent-soft text-accent',
  muted: 'bg-subtle text-fg-muted',
  success: 'bg-success-soft text-success',
}

function allocBand(allocs: number): string {
  if (allocs === 0) return 'bg-success'
  if (allocs < 20) return 'bg-status-warn'
  return 'bg-danger'
}

/**
 * One row per benchmark: how long, how much memory, where it goes according
 * to the package profile, and what that points to.
 */
export default function Bottlenecks({ benchmarks, profile, projectName }: Props) {
  const [sort, setSort] = useState<SortKey>('time')
  const hasProfiles = (profile?.packages?.length ?? 0) > 0

  const rows = useMemo(() => {
    const list = analyzeBenchmarks(benchmarks, profile, projectName)
    const cmp = {
      time: (x: BenchAnalysis, y: BenchAnalysis) => y.b.time_per_op - x.b.time_per_op,
      allocs: (x: BenchAnalysis, y: BenchAnalysis) => y.b.allocs_per_op - x.b.allocs_per_op,
      bytes: (x: BenchAnalysis, y: BenchAnalysis) => y.b.bytes_per_op - x.b.bytes_per_op,
      name: (x: BenchAnalysis, y: BenchAnalysis) => x.b.name.localeCompare(y.b.name),
    }[sort]
    return list.sort(cmp)
  }, [benchmarks, profile, projectName, sort])

  // Log scale so a 7 ns and a 2.7 ms benchmark both get a visible bar.
  const maxLog = Math.log10(Math.max(10, ...benchmarks.map((b) => b.time_per_op)))
  const widthOf = (ns: number) => `${Math.max(2, (Math.log10(Math.max(1, ns)) / maxLog) * 100)}%`

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">Bottlenecks</h3>
        <p className="text-xs text-fg-subtle flex-1 min-w-[16rem]">
          Each benchmark, where its time and memory go, and what that points to.
          {!hasProfiles && ' Run a scan with profiling enabled to see where the time goes.'}
        </p>
        <label className="text-xs text-fg-muted inline-flex items-center gap-2">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input py-0.5 text-xs">
            <option value="time">time/op</option>
            <option value="allocs">allocs/op</option>
            <option value="bytes">bytes/op</option>
            <option value="name">name</option>
          </select>
        </label>
        <span className="text-xs text-fg-muted inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-series-1 inline-block" /> CPU</span>
          <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-violet inline-block" /> allocations</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <colgroup><col className="w-[17%]" /><col className="w-[17%]" /><col className="w-[13%]" /><col className="w-[28%]" /><col /></colgroup>
          <thead>
            <tr className="border-b border-line bg-subtle">
              <th className="th">Benchmark</th>
              <th className="th">Time/op <span className="font-normal">(log scale)</span></th>
              <th className="th">Memory</th>
              <th className="th">Where it goes <span className="font-normal">· share of the package profile</span></th>
              <th className="th">What it points to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ b, pkg, callees, diagnosis, share, siblings }) => (
              <tr key={b.name} className="align-middle hover:bg-subtle/40">
                <td className="px-4 py-2 min-w-0">
                  <p className="font-mono text-[13px] font-medium truncate" title={b.name}>{benchShortName(b.name)}</p>
                  {(b.package || pkg) && <p className="text-xs text-fg-subtle truncate" title={b.package || pkg?.package}>{shortPkg(b.package || pkg!.package, projectName)}</p>}
                </td>
                <td className="px-4 py-2">
                  <div className="h-2 bg-subtle rounded-full overflow-hidden w-28">
                    <div className={`h-full rounded-full ${allocBand(b.allocs_per_op)}`} style={{ width: widthOf(b.time_per_op) }} />
                  </div>
                  <p className="font-mono text-xs tabular-nums mt-1">{fmtNS(b.time_per_op)}</p>
                </td>
                <td className="px-4 py-2 font-mono text-xs tabular-nums whitespace-nowrap">
                  {b.allocs_per_op} <span className="text-fg-subtle">alloc{b.allocs_per_op === 1 ? '' : 's'}</span>
                  {b.bytes_per_op > 0 && <> · {fmtBytes(b.bytes_per_op)}</>}
                </td>
                <td className="px-4 py-2">
                  {callees.length === 0 ? (
                    <span className="text-xs text-fg-subtle">
                      {!pkg ? 'no profile for this package' : share.cpu === 0 && share.mem === 0 ? 'no samples: the benchmark spent its time off the CPU' : 'nothing outside the runtime'}
                    </span>
                  ) : (
                    <ul className="space-y-0.5">
                      {callees.map((c) => <CalleeRow key={c.kind + c.fn} c={c} />)}
                      {siblings > 0 && (share.cpu > 0 || share.mem > 0) && (
                        <li className="text-[11px] text-fg-subtle">
                          this benchmark is {share.cpu.toFixed(0)}% of the package's CPU and {share.mem.toFixed(0)}% of its memory profile ({siblings + 1} benchmarks share it)
                        </li>
                      )}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${TONE_CHIP[diagnosis.tone]}`}>{diagnosis.label}</span>
                  <p className="text-xs text-fg-subtle mt-1 leading-snug">{diagnosis.hint}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CalleeRow({ c }: { c: Callee }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_2.75rem_3.5rem] items-center gap-2 text-xs">
      <span className={`font-mono truncate ${c.project ? 'text-fg' : 'text-fg-muted'}`} title={c.attributed ? `${c.fn} (attributed: this benchmark dominates the package profile)` : c.fn}>{c.short}{c.attributed ? '*' : ''}</span>
      <span className="font-mono tabular-nums text-right text-fg-muted">{c.pct.toFixed(1)}%</span>
      <span className="h-1.5 bg-subtle rounded-full overflow-hidden">
        <span className={`block h-full rounded-full ${c.kind === 'cpu' ? 'bg-series-1' : 'bg-violet'}`} style={{ width: `${Math.min(100, c.pct)}%` }} />
      </span>
    </li>
  )
}

function shortPkg(pkg: string, project?: string): string {
  if (project && pkg.startsWith(project + '/')) return pkg.slice(project.length + 1)
  return pkg
}
