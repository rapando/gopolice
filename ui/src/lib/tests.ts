import type { Test } from '../api/client'

const ORDER: Record<string, number> = { FAIL: 0, SKIP: 1, PASS: 2 }

export const sortTests = (tests: Test[]) => [...tests].sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3))

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The go test command that re-runs exactly this test (subtests included). */
export function rerunCommand(pkg: string, test: string): string {
  const pattern = test.split('/').map((p) => `^${escapeRegex(p)}$`).join('/')
  return `go test -count=1 -v -run '${pattern}' ${pkg}`
}
