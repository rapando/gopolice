# gopolice JSON report

Output of `gopolice scan --output json`. Also cached at
`.gopolice/cache/result.json`. Durations are Go `time.Duration` values in
nanoseconds. Timestamps are RFC 3339.

## Top level

| Field | Type | Meaning |
|-------|------|---------|
| `project_name` | string | Module name or directory name |
| `scan_time` | timestamp | When the scan started |
| `duration` | int (ns) | Wall time of the whole scan |
| `issues` | Issue[] | Every finding from every scanner |
| `test_results` | TestResult | Absent when the tests scanner is disabled |
| `benchmarks` | Benchmark[] | One per benchmark function |
| `profile` | Profile | CPU and memory hot spots from benchmarks |
| `dep_graph` | `{edges: [{from, to}]}` | Package import graph |
| `deps` | `[{path, version, indirect}]` | Module dependencies from go.mod |
| `git_info` | GitInfo | Branch, commit, authors, recent commits |
| `file_stats` | `[{path, lines, code_lines, comment_lines, blank_lines}]` | Per file |
| `total_files`, `go_files`, `total_lines` | int | Inventory |
| `modules` | string[] | Module names in a go.work workspace |
| `tools` | ToolStatus[] | Whether each external tool ran |

## Issue

| Field | Values |
|-------|--------|
| `id` | stable hash, same across scans for the same finding |
| `scanner` | the tool that produced it: `golangci-lint`, `go vet`, `gosec`, `govulncheck`, `go test`, `deadcode`, `complexity` |
| `rule` | `vet`, a golangci-lint linter name, `G###` (gosec), `GO-YYYY-NNNN` (govulncheck), `U1000` (staticcheck unused), `high-complexity`, `test-failure` |
| `severity` | `error`, `warning`, `info`. govulncheck is always `error`; gosec maps HIGH/MEDIUM/LOW; `go vet` and `complexity` are always `warning` |
| `category` | `bug`, `security`, `style`, `complexity`, `test`, `performance`, `deadcode` |
| `file`, `line`, `column` | location, path relative to the module root. For govulncheck, `file` is the vulnerable module path and there is no line |
| `message` | the tool's message |
| `solution` | recommended fix, when the scanner knows one |
| `module` | module name in a workspace |
| `git_blame` | `{author, email, commit, date, line}` for the offending line |
| `value`, `threshold` | measured number and limit (complexity only) |

## TestResult

```
test_results:
  total: {total, passed, failed, skipped}
  packages[]:
    name, status ("pass" | "fail" | "skip"), duration, coverage (percent), output
    tests[]: name, status, duration, output, file, line
```

## ToolStatus

```
tools[]:
  scanner   pipeline scanner name: lint, security, deadcode, ... (not the issue scanner name)
  tool      "golangci-lint", "gosec", "govulncheck", "staticcheck", "go vet", ...
  status    "ran" | "missing" | "failed"
  findings  how many issues it produced
  error     stderr summary when failed
  install   command that would install a missing tool
```

A scanner with status `missing` contributed zero issues. Treat its area as
unchecked, not clean.

## Benchmark and Profile

```
benchmarks[]: name, package, iterations, time_per_op (ns), bytes_per_op, allocs_per_op
profile:
  cpu[]:  function, flat, flat_pct, cum, cum_pct      (merged across packages)
  mem[]:  same shape, bytes
  packages[]: {package, cpu[], mem[]}                 (per package)
```

`flat` is time or memory spent in the function itself, `cum` includes callees.
Sort by `flat_pct` to find hot spots worth optimising.

## Grade

Computed from `issues` only. Points: error 10, warning 3, info 1.

| Points | Grade |
|--------|-------|
| 0 | A |
| 1 to 15 | B |
| 16 to 40 | C |
| 41 to 80 | D |
| over 80 | F |

## SARIF output

`gopolice scan --output sarif` emits SARIF 2.1.0. Rule ids are
`<scanner>/<rule>`. Severity maps to `error`, `warning`, `note`. Run
properties carry test totals, average coverage and dependency edge count.
Upload with `github/codeql-action/upload-sarif` or any SARIF viewer.
