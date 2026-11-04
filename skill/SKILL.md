---
name: gopolice
description: Audit a Go project with gopolice and turn the findings into fixes. Runs lint, security, vulnerability, test, coverage, dead code, complexity, benchmark and profile scans in one command, then triages the JSON report in priority order and guides the fix-and-rescan loop. Use when asked to review, audit, harden, or raise the quality grade of a Go codebase.
summary: One-command Go code audit (lint, security, tests, dead code, complexity, benchmarks) with a prioritised fix loop.
version: 1.0.0
tags: [go, golang, code-quality, security, testing, linting, static-analysis, sarif]
keywords: [gopolice, golangci-lint, gosec, govulncheck, staticcheck, go vet, coverage, cyclomatic complexity, dead code, benchmarks, pprof, SARIF]
use_cases:
  - Audit a Go repository before a release and fix what matters first
  - Produce a SARIF report for GitHub code scanning from a Go project
  - Find failing tests, low coverage and dead code in a Go monorepo or go.work workspace
  - Explain why a project's quality grade dropped and bring it back up
docs_url: https://github.com/rapando/gopolice/blob/main/docs/agensi-skill.md
---

# gopolice

gopolice is an open-source CLI (MIT, github.com/rapando/gopolice) that runs every
standard Go quality tool against a project and merges the output into one
report. This skill teaches you to run it headless, read the report, decide what
to fix first, and verify the fix with a rescan.

## When to use

- The user asks to audit, review, lint, harden, or "clean up" a Go project.
- The user wants a quality grade, test coverage, or security findings for Go code.
- The user needs a SARIF file from a Go project for CI or GitHub code scanning.
- You are about to make broad changes to a Go repo and want a baseline first.

Do not use it for non-Go projects. For a single file, `go vet` alone is faster.

## Step 1: make sure gopolice is installed

```bash
gopolice version || go install github.com/rapando/gopolice@latest
```

gopolice needs Go 1.26 or newer on PATH. If `gopolice` is still not found after
`go install`, add `$(go env GOPATH)/bin` to PATH for this session.

Optional tools add scanners. Check which are present and tell the user what is
missing rather than installing them silently:

| Tool | Adds | Install |
|------|------|---------|
| golangci-lint | full lint suite (go vet always runs) | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
| gosec | security rules | `go install github.com/securego/gosec/v2/cmd/gosec@latest` |
| govulncheck | known CVEs in dependencies | `go install golang.org/x/vuln/cmd/govulncheck@latest` |
| staticcheck | dead code (U1000) | `go install honnef.co/go/tools/cmd/staticcheck@latest` |

Everything degrades gracefully. The report's `tools` array says which ran.

## Step 2: run a headless scan

Run from the module root (the directory with `go.mod`, or `go.work` for a
workspace). Always use `--output` when an agent drives it, so no browser opens
and no server stays up:

```bash
gopolice scan --output json > gopolice.json
```

Progress goes to stderr, the report to stdout. A scan runs `go vet`,
`go test -cover ./...`, and every benchmark with CPU and memory profiling, so:

- Only scan repositories the user trusts. Tests and benchmarks execute code.
- Expect minutes, not seconds, on large projects with heavy benchmarks.
- To skip benchmarks and profiling, add to `~/.config/gopolice/config.yaml`:

```yaml
disabled_scanners:
  - benchmarks
  - profile
```

Scanner names: `lint`, `security`, `tests`, `benchmarks`, `profile`,
`deadcode`, `depgraph`, `complexity`, `filestats`, `git`.

For CI or GitHub code scanning use SARIF instead:

```bash
gopolice scan --output sarif > gopolice.sarif
```

The report is also cached at `.gopolice/cache/result.json` in the project, and
every scan is appended to `.gopolice/history/`. Add `.gopolice/` to
`.gitignore` if it is not already there.

## Step 3: triage the report

Run the bundled triage script on the JSON. It prints the grade, tool status,
test summary and the issues grouped in fix order:

```bash
python3 triage.py gopolice.json
python3 triage.py gopolice.json --max 40     # longer list
python3 triage.py gopolice.json --scanner gosec
```

If you cannot run the script, read `references/report-schema.md` and apply
this order by hand:

1. **Tool status first.** Any entry in `tools` with status `missing` or
   `failed` means that whole scanner produced nothing. "No security issues"
   with gosec missing is not a clean bill of health. Report it as a gap.
2. **Failing tests** (`test_results.total.failed > 0`). Each failed test is
   also an issue from scanner `go test`, rule `test-failure`, with the test
   output attached.
3. **Security errors**: scanner `govulncheck` (rule is the `GO-YYYY-NNNN`
   id, file is the vulnerable module path) and scanner `gosec` (rule `G###`).
   gosec HIGH is `error`, MEDIUM is `warning`, LOW is `info`.
4. **Vet and lint errors**: scanner `go vet` (rule `vet`, always `warning`)
   and scanner `golangci-lint` (rule is the linter name).
5. **Warnings** in the same scanner order, then **dead code** (scanner
   `deadcode`, rule `U1000`) and **complexity** (scanner `complexity`, rule
   `high-complexity`, always `warning`, `value` over `threshold`, default
   threshold 10).
6. **Info** last. Style findings are optional unless the user asked for them.

Note the two naming schemes: `tools[].scanner` and `disabled_scanners` use
the pipeline names (`lint`, `security`, `tests`, ...). `issues[].scanner`
names the tool that produced the finding (`gosec`, `govulncheck`,
`golangci-lint`, `go vet`, `go test`, `deadcode`, `complexity`).

Every issue has `file`, `line`, `column`, `message`, and often `solution`
with the recommended fix. Use `git_blame` to know who touched the line, not to
assign blame in your write-up.

## Step 4: fix, rescan, compare

Fix in the order above. Keep each change small and preserve behaviour: a lint
fix must not change what the code does. Then rescan and diff the counts:

```bash
gopolice scan --output json > gopolice-after.json
python3 triage.py gopolice-after.json --compare gopolice.json
```

The compare mode lists issues that disappeared, issues that are new, and the
grade before and after. Report both to the user.

The grade is computed from issue severities: error 10 points, warning 3,
info 1. A is 0 points, B up to 15, C up to 40, D up to 80, F above that.
Removing one error is worth more than removing three warnings.

## Step 5: hand the dashboard to a human

If the user wants to browse the results, start the web UI on the cached report
without rescanning:

```bash
gopolice serve            # http://localhost:9393, or the next free port
gopolice serve --watch    # rescan on file changes
```

It listens on localhost only. Tell the user the URL and that Ctrl-C stops it.

## Multi-module workspaces

With a `go.work` file every scanner runs per module and issues carry a
`module` field. Group by module in your summary so fixes land in the right
place.

## Limits

- Go only. Go 1.26+ required.
- Scans execute the project's tests and benchmarks.
- govulncheck needs network access to fetch the vulnerability database.
- gopolice reports; it does not auto-fix. You make the edits.
- The `service` subcommand (multi-repo server with login) is for humans and is
  out of scope for this skill.
