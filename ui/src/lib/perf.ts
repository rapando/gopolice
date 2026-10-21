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
  /** Share of the package profile, cumulative for CPU, flat for memory. */
  pct: number
  kind: 'cpu' | 'mem'
  project: boolean
}

/** Frames that are the benchmark harness for this (or any) benchmark. */
function isBenchFrame(fn: string): boolean {
  return /\.Benchmark[A-Z_]/.test(fn)
}

/**
 * Where a benchmark's time and memory go: the project function it exercises
 * (if its name matches) and the heaviest non-runtime callee by share.
 * Profiles are per package, so for packages with several benchmarks the
 * callees are the package's heaviest, which the UI labels as such.
 */
export function calleesFor(b: BenchmarkResult, pkg: PackageProfile | null, project?: string): Callee[] {
  if (!pkg) return []
  const short = benchShortName(b.name).toLowerCase()
  const out: Callee[] = []
  const pick = (entries: ProfileEntry[] | null | undefined, kind: 'cpu' | 'mem', pctOf: (e: ProfileEntry) => number) => {
    const usable = (entries ?? []).filter((e) => !isRuntimeFrame(e.function) && !isBenchFrame(e.function) && pctOf(e) > 0)
    const own = usable
      .filter((e) => isProjectFrame(e.function, project) && fnShort(e.function).toLowerCase().includes(short))
      .sort((x, y) => pctOf(y) - pctOf(x))[0]
    const top = usable
      .filter((e) => e !== own)
      .sort((x, y) => pctOf(y) - pctOf(x))[0]
    for (const e of [top, own]) {
      if (e) out.push({ fn: e.function, short: fnShort(e.function), pct: pctOf(e), kind, project: isProjectFrame(e.function, project) })
    }
  }
  pick(pkg.cpu, 'cpu', (e) => e.cum_pct)
  pick(pkg.mem, 'mem', (e) => e.flat_pct)
  // Most informative first: the heaviest external callee, then the function under test.
  return out.sort((x, y) => y.pct - x.pct).slice(0, 3)
}

export type DiagnosisKind = 'io' | 'alloc-heavy' | 'error-allocs' | 'buffer' | 'overhead' | 'library' | 'moderate' | 'fine'

export interface Diagnosis {
  kind: DiagnosisKind
  label: string
  hint: string
  tone: 'danger' | 'warning' | 'info' | 'muted' | 'success'
}

/** A first reading of the numbers. Thresholds are deliberately simple and stated in the hint. */
export function diagnose(b: BenchmarkResult, callees: Callee[], median: number): Diagnosis {
  const topCpu = callees.find((c) => c.kind === 'cpu')
  const topMem = callees.find((c) => c.kind === 'mem')
  const mem = topMem?.fn ?? ''
  const cpu = topCpu?.fn ?? ''
  if (/os\.(RemoveAll|removeAll|MkdirTemp|CreateTemp)|testing\.\(\*B\)\.TempDir/.test(cpu) || /os\.(RemoveAll|MkdirTemp)/.test(mem)) {
    return { kind: 'overhead', label: 'Benchmark overhead', hint: `${fnShort(cpu || mem)} is the test's own setup or cleanup, not the product.`, tone: 'muted' }
  }
  if (b.allocs_per_op === 0) {
    return { kind: 'fine', label: 'Allocation-free', hint: topCpu ? `Time goes to ${topCpu.short}.` : 'No heap allocations per op.', tone: 'success' }
  }
  if (/newParseError|errors\.New|fmt\.Errorf|\.Error\b/.test(mem)) {
    return { kind: 'error-allocs', label: 'Error-path allocs', hint: `${topMem!.pct.toFixed(0)}% of its memory is building ${fnShort(mem)}; an error is created on the normal path.`, tone: 'warning' }
  }
  if (/bufio\.|bytes\.\(\*Buffer\)|strings\.\(\*Builder\)|makeslice|growslice/.test(mem)) {
    return { kind: 'buffer', label: 'Buffer per call', hint: `${fnShort(mem)} allocates a fresh buffer each op; size or reuse it.`, tone: 'info' }
  }
  if (b.allocs_per_op >= 100) {
    return { kind: 'alloc-heavy', label: 'Allocation-heavy', hint: `${b.allocs_per_op} allocs/op${topMem ? `, ${topMem.pct.toFixed(0)}% from ${topMem.short}` : ''}.`, tone: 'warning' }
  }
  if (median > 0 && b.time_per_op > Math.max(1e6, median * 50) && b.allocs_per_op < 10) {
    return { kind: 'io', label: 'Slow, few allocs', hint: `${b.allocs_per_op} allocs for ${(b.time_per_op / 1e6).toFixed(2)} ms: the time is waiting on I/O or syscalls, not the CPU.`, tone: 'danger' }
  }
  if (topMem && !topMem.project && topMem.pct >= 50) {
    return { kind: 'library', label: 'Library', hint: `${topMem.pct.toFixed(0)}% of its memory is inside ${topMem.short}; little to change here.`, tone: 'muted' }
  }
  if (b.allocs_per_op >= 20) {
    return { kind: 'moderate', label: 'Some allocations', hint: `${b.allocs_per_op} allocs/op${topMem ? `, mostly ${topMem.short}` : ''}.`, tone: 'info' }
  }
  return { kind: 'fine', label: 'Fine', hint: topCpu ? `Time goes to ${topCpu.short}.` : 'Nothing stands out.', tone: 'success' }
}

/** Project functions ranked by how much of their package's memory profile they allocate themselves. */
export function allocationSources(profile: ProfileData | null, project?: string): { fn: string; short: string; pct: number; pkg: string }[] {
  const out: { fn: string; short: string; pct: number; pkg: string }[] = []
  for (const p of profile?.packages ?? []) {
    for (const e of p.mem ?? []) {
      if (isProjectFrame(e.function, project) && !isBenchFrame(e.function) && e.flat_pct > 0) {
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
