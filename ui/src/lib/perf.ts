import type { BenchmarkResult, PackageProfile, ProfileData, ProfileEntry } from '../api/client'

/**
 * Frames that belong to the Go runtime, the test harness or the profiler
 * itself. They dominate every profile and say nothing about the code under
 * test, so the page hides them unless asked.
 */
const RUNTIME_RE = /^(runtime[./]|testing\.|syscall\.|internal\/(runtime|poll|cpu|bytealg|abi|stringslite|chacha8rand)|runtime\/pprof|compress\/(flate|gzip)|aeshash|gcWrite|os\.ignoringEINTR|os\.\(\*File\)\.(Write|Read)|sync\.|os\.removefileat)/

export function isRuntimeFrame(fn: string): boolean {
  return RUNTIME_RE.test(fn)
}

/** Whether a profile frame is in the project's own code. */
export function isProjectFrame(fn: string, project?: string): boolean {
  if (!project) return false
  return fn.startsWith(project + '/') || fn.startsWith(project + '.')
}

/** "BenchmarkParseBenchOutput-8" → "ParseBenchOutput". */
export function benchShortName(name: string): string {
  return name.replace(/^Benchmark/, '').replace(/-\d+$/, '')
}

/** "github.com/x/y/internal/scanner.parseBenchOutput" → "scanner.parseBenchOutput". */
export function fnShort(fn: string): string {
  const slash = fn.lastIndexOf('/')
  return slash >= 0 ? fn.slice(slash + 1) : fn
}

/** The profile of the package a benchmark ran in, if the scan recorded one. */
export function profileFor(b: BenchmarkResult, profile: ProfileData | null): PackageProfile | null {
  const pkgs = profile?.packages ?? []
  if (b.package) {
    const hit = pkgs.find((p) => p.package === b.package)
    if (hit) return hit
  }
  // Older results: find the package whose profile contains this benchmark function.
  const short = benchShortName(b.name)
  return pkgs.find((p) => [...(p.cpu ?? []), ...(p.mem ?? [])].some((e) => e.function.includes('.Benchmark' + short))) ?? null
}

export interface Callee {
  fn: string
  short: string
  /** Share of the package profile: cumulative for CPU, flat for memory. */
  pct: number
  kind: 'cpu' | 'mem'
  project: boolean
  /** True when the frame was attributed to this benchmark because it dominates the package profile. */
  attributed: boolean
}

export type DiagnosisKind = 'io' | 'alloc-heavy' | 'error-allocs' | 'buffer' | 'overhead' | 'library' | 'moderate' | 'fine'

export interface Diagnosis {
  kind: DiagnosisKind
  label: string
  hint: string
  tone: 'danger' | 'warning' | 'info' | 'muted' | 'success'
}

export interface BenchAnalysis {
  b: BenchmarkResult
  pkg: PackageProfile | null
  /** This benchmark's share of its package profile, from its own Benchmark frame. */
  share: { cpu: number; mem: number }
  callees: Callee[]
  diagnosis: Diagnosis
  /** Other benchmarks that ran in the same package. */
  siblings: number
}

function isBenchFrame(fn: string): boolean {
  return /\.Benchmark[A-Z_]/.test(fn)
}

function benchFrame(entries: ProfileEntry[] | null | undefined, short: string): ProfileEntry | undefined {
  return (entries ?? []).find((e) => isBenchFrame(e.function) && fnShort(e.function).split('.Benchmark')[1]?.replace(/-\d+$/, '') === short)
}

/**
 * Attributes profile frames to benchmarks. go test profiles a package, not a
 * benchmark, so for packages with several benchmarks only three things are
 * safe to say: each benchmark's own share (its Benchmark frame's cumulative
 * share), the project function it exercises (matched by name or by share),
 * and, when one benchmark accounts for most of a profile, that the package's
 * heaviest callee belongs to it.
 */
export function analyzeBenchmarks(benchmarks: BenchmarkResult[], profile: ProfileData | null, project?: string): BenchAnalysis[] {
  const med = median(benchmarks.map((b) => b.time_per_op))
  const pkgOf = new Map<BenchmarkResult, PackageProfile | null>(benchmarks.map((b) => [b, profileFor(b, profile)]))
  const perPkg = new Map<string, BenchmarkResult[]>()
  for (const [b, p] of pkgOf) if (p) perPkg.set(p.package, [...(perPkg.get(p.package) ?? []), b])

  const shares = new Map<BenchmarkResult, { cpu: number; mem: number }>()
  for (const [b, p] of pkgOf) {
    const short = benchShortName(b.name)
    shares.set(b, { cpu: benchFrame(p?.cpu, short)?.cum_pct ?? 0, mem: benchFrame(p?.mem, short)?.cum_pct ?? 0 })
  }

  const usable = (entries: ProfileEntry[] | null | undefined, pctOf: (e: ProfileEntry) => number) =>
    (entries ?? []).filter((e) => !isRuntimeFrame(e.function) && !isBenchFrame(e.function) && pctOf(e) > 0)

  return benchmarks.map((b) => {
    const pkg = pkgOf.get(b) ?? null
    const share = shares.get(b)!
    const siblings = pkg ? (perPkg.get(pkg.package)?.length ?? 1) - 1 : 0
    const short = benchShortName(b.name).toLowerCase()
    const callees: Callee[] = []

    for (const kind of ['cpu', 'mem'] as const) {
      const pctOf = kind === 'cpu' ? (e: ProfileEntry) => e.cum_pct : (e: ProfileEntry) => e.flat_pct
      const entries = usable(kind === 'cpu' ? pkg?.cpu : pkg?.mem, pctOf)
      const own = entries
        .filter((e) => isProjectFrame(e.function, project) && fnShort(e.function).toLowerCase().includes(short))
        .sort((x, y) => pctOf(y) - pctOf(x))[0]
      if (own) callees.push({ fn: own.function, short: fnShort(own.function), pct: pctOf(own), kind, project: true, attributed: false })

      // The heaviest frame outside the project. With one benchmark in the
      // package it is this benchmark's; with several, only if this benchmark
      // dominates that profile.
      const external = entries.filter((e) => !isProjectFrame(e.function, project)).sort((x, y) => pctOf(y) - pctOf(x))[0]
      if (external) {
        const mine = siblings === 0 || dominates(b, kind, perPkg.get(pkg!.package) ?? [], shares)
        if (mine) callees.push({ fn: external.function, short: fnShort(external.function), pct: pctOf(external), kind, project: false, attributed: siblings > 0 })
      }
    }
    callees.sort((x, y) => y.pct - x.pct)

    return { b, pkg, share, callees: callees.slice(0, 3), diagnosis: diagnose(b, share, callees, med, !!pkg), siblings }
  })
}

/** Whether this benchmark accounts for at least half of its package's profile of that kind. */
function dominates(b: BenchmarkResult, kind: 'cpu' | 'mem', group: BenchmarkResult[], shares: Map<BenchmarkResult, { cpu: number; mem: number }>): boolean {
  const mine = shares.get(b)?.[kind] ?? 0
  const total = group.reduce((s, x) => s + (shares.get(x)?.[kind] ?? 0), 0)
  return mine > 0 && total > 0 && mine / total >= 0.5
}

/** A first reading of the numbers. The thresholds are simple and stated in the hints. */
export function diagnose(b: BenchmarkResult, share: { cpu: number; mem: number }, callees: Callee[], med: number, profiled: boolean): Diagnosis {
  const topCpu = callees.find((c) => c.kind === 'cpu' && !c.project)
  const topMem = callees.find((c) => c.kind === 'mem' && !c.project)
  const own = callees.find((c) => c.project)
  const cpu = topCpu?.fn ?? ''
  const mem = topMem?.fn ?? ''

  // Slow with nothing to show for it on the CPU: the time is spent waiting.
  if (b.time_per_op >= 1e5 && b.allocs_per_op < 10 && (!profiled || share.cpu < 1) && b.time_per_op > med * 10) {
    return { kind: 'io', label: 'Waiting, not computing', hint: `${(b.time_per_op / 1e6).toFixed(2)} ms with ${b.allocs_per_op} allocs and ${profiled ? 'no CPU samples' : 'no profile'}: the time goes to I/O or syscalls. Cache or batch the work.`, tone: 'danger' }
  }
  if (/os\.(RemoveAll|removeAll|MkdirTemp|CreateTemp)|testing\.\(\*B\)\.TempDir/.test(cpu)) {
    return { kind: 'overhead', label: 'Benchmark overhead', hint: `${topCpu!.pct.toFixed(0)}% of CPU is ${fnShort(cpu)}, the test's own setup or cleanup, not the product.`, tone: 'muted' }
  }
  if (b.allocs_per_op === 0) {
    return { kind: 'fine', label: 'Allocation-free', hint: own ? `Time goes to ${own.short}${topCpu ? ` and ${topCpu.short}` : ''}.` : 'No heap allocations per op.', tone: 'success' }
  }
  if (/newParseError|errors\.New|fmt\.Errorf/.test(mem)) {
    return { kind: 'error-allocs', label: 'Error-path allocs', hint: `${topMem!.pct.toFixed(0)}% of its package's memory is ${fnShort(mem)}: an error is built on the normal path, probably a failing parse attempt before the one that succeeds.`, tone: 'warning' }
  }
  if (/bufio\.|bytes\.\(\*Buffer\)|strings\.\(\*Builder\)|makeslice|growslice/.test(mem)) {
    return { kind: 'buffer', label: 'Buffer per call', hint: `${topMem!.pct.toFixed(0)}% of its package's memory is ${fnShort(mem)}: a fresh buffer each op. Size it up front or reuse it.`, tone: 'info' }
  }
  if (b.allocs_per_op >= 100) {
    return { kind: 'alloc-heavy', label: 'Allocation-heavy', hint: `${b.allocs_per_op} allocs/op${own ? `, ${own.pct.toFixed(0)}% of its package's memory in ${own.short}` : ''}.`, tone: 'warning' }
  }
  if (topMem && topMem.pct >= 50) {
    return { kind: 'library', label: 'Library', hint: `${topMem.pct.toFixed(0)}% of its package's memory is inside ${topMem.short}; little to change in your code.`, tone: 'muted' }
  }
  if (b.allocs_per_op >= 20) {
    return { kind: 'moderate', label: 'Some allocations', hint: `${b.allocs_per_op} allocs/op${own ? `, in ${own.short}` : ''}.`, tone: 'info' }
  }
  return { kind: 'fine', label: 'Fine', hint: own ? `Time goes to ${own.short}.` : 'Nothing stands out.', tone: 'success' }
}

/** Project functions ranked by how much of their package's memory profile they allocate themselves. */
export function allocationSources(profile: ProfileData | null, project?: string): { fn: string; short: string; pct: number; pkg: string }[] {
  const out: { fn: string; short: string; pct: number; pkg: string }[] = []
  for (const p of profile?.packages ?? []) {
    for (const e of p.mem ?? []) {
      if (isProjectFrame(e.function, project) && !isBenchFrame(e.function) && e.flat_pct >= 0.1) {
        out.push({ fn: e.function, short: fnShort(e.function), pct: e.flat_pct, pkg: p.package })
      }
    }
  }
  return out.sort((a, b) => b.pct - a.pct)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
