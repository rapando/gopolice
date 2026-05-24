# gopolice — Feature Roadmap

> **Status key:** ✅ Done  🔜 In Progress  ⬜ Not Started

---

## Core Infrastructure

- [x] CLI scaffold (cobra commands: scan, serve, history, config, version)
- [x] Config system (global `~/.config/gopolice/config.yaml`)
- [x] Scanner pipeline (interface, orchestrator, progress reporting)
- [x] Data model types (ScanResult, Issue, TestResult, GitInfo, etc.)
- [x] In-memory store + JSON file cache
- [x] HTTP server with REST API + SSE scan progress
- [x] Web UI scaffold (React + TypeScript + Vite + Tailwind)
- [x] Embedded UI via `//go:embed`
- [x] Auto-open browser on scan
- [x] History storage + diff tracking
- [x] Grade computation (A–F)
- [x] Dark mode (Catppuccin Mocha, localStorage, system preference)
- [x] Release workflow (semver, cross-compile, GitHub Releases)

---

## Scanner Pipeline

- [x] **Lint scanner** — `golangci-lint` with fallback to `go vet`
- [x] **Security scanner** — `gosec` + `govulncheck`
- [x] **Test scanner** — `go test -v` + coverage
- [x] **Complexity scanner** — AST-based cyclomatic complexity
- [x] **File stats scanner** — line/file/dep counts
- [x] **Git scanner** — blame, branch, commit stats
- [x] **Path normalization** — absolute → relative paths, dedup
- [x] **Benchmark runner** — `go test -bench=. -benchmem` → `BenchmarkResult`

  - `internal/scanner/bench.go` — new scanner running `go test -bench=. -benchmem -count=1 ./...`
  - Parse output with regex `^Benchmark(\S+)\s+(\d+)\s+([\d.]+)\s+ns/op\s*(?:(\d+)\s+B/op)?\s*(?:(\d+)\s+allocs/op)?`
  - Populate `model.BenchmarkResult{Name, Iterations, TimePerOp, BytesPerOp, AllocsPerOp}`
  - Pipeline: add `NewBenchmarkScanner()` to `NewDefaultPipeline()`
  - Model: `BenchmarkResult` struct (already exists in `types.go`), store in `ScanResult.Benchmarks`
  - API: `GET /api/results/benchmarks` endpoint
  - UI: separate "Benchmarks" page with sortable table, nav tab

- [x] **Profiling scanner** — CPU/mem `pprof` data

  - `internal/scanner/profile.go` — runs `go test -cpuprofile=<tmpfile> -memprofile=<tmpfile> ./...`
  - Parses `go tool pprof -top` text output for top-N functions
  - Profile data model: `model.ProfileData{CPU, Mem []ProfileEntry{Function, Flat, FlatPct, Cum, CumPct}}`
  - Store profile data in `ScanResult.Profile`, served via `GET /api/results/profile`
  - UI: separate "Profile" page with top-N tables for CPU and memory, bar sparklines

- [x] **Dead code scanner** — `staticcheck` unused code detection

  - Shell out to `staticcheck -checks "U1000" -f json ./...`
  - Parse JSON output, map to `model.Issue{Category: "deadcode"}`
  - Fallback: `unused` binary if staticcheck not available
  - UI: "Dead Code" nav tab with filtered issues table

- [x] **Dependency graph** — parse `go mod graph`

  - `internal/scanner/depgraph.go` — runs `go mod graph`, parses output into `model.DepGraph{Edges: []DepEdge{From, To}}`
  - Pipeline: `NewDepGraphScanner()` in default pipeline; type switch for `*model.DepGraph`
  - API: `GET /api/results/deps/graph` endpoint
  - UI: force-directed SVG graph with D3, zoom/pan, tooltips, amber/indigo node colors
  - Nav tab: "Deps Graph"

---

## Output & Integration

- [ ] **JSON export** — `gopolice scan --output json` (partial: exists but needs full coverage)
- [ ] **HTML export** — `gopolice scan --output html` (template-based report)

  - Internal `internal/exporter/` package with HTML templating
  - Self-contained HTML (CSS inlined)
  - Sections: summary, issues by severity/category, test results, git stats

- [ ] **SARIF export** — standard format for GitHub Code Scanning / GitLab SAST

  - Implement `internal/exporter/sarif.go`
  - Map `model.Issue` → SARIF `result` objects
  - Output as `.sarif` file, compatible with `github/codeql-action/upload-sarif`

- [ ] **JUnit XML export** — test result format for CI

  - Implement `internal/exporter/junit.go`
  - Parse `model.TestResult` → JUnit XML schema
  - Output as `.xml` file, ingestible by Jenkins, CircleCI, etc.

- [ ] **GitHub PR annotations**

  - `gopolice ci` command (run in GitHub Actions)
  - Scan project, format issues as GitHub check-run annotations
  - Use `gh api` to post annotations on the PR
  - Exit with non-zero if issues above configurable threshold

- [ ] **Docker image**

  - Multi-stage `Dockerfile`:
    - Stage 1: build UI (node:20)
    - Stage 2: build Go binary (golang:1.26)
    - Stage 3: scratch or distroless, copy binary
  - `docker run -v $(pwd):/project ghcr.io/rapando/gopolice scan`
  - CI: publish to ghcr.io on release

- [ ] **VS Code extension**

  - `gopolice-ls` language server or extension activating on Go files
  - Commands: "Scan Project", "Show Issues"
  - Diagnostics provider: issues show as editor squiggles
  - Webview panel: embedded gopolice UI
  - Packaging: `.vsix` published to marketplace

---

## UI & UX Enhancements

- [x] **Benchmarks page** — display benchmark results in a sortable table

  - New top-nav item "Benchmarks"
  - Columns: name, iterations, ns/op, B/op, allocs/op
  - Highlight fast/slow with color coding
  - Compare mode: select two history entries, diff benchmarks (future)

- [x] **Profile page** — top-N hot functions tables

  - New top-nav item "Profile"
  - Top-N tables for CPU and memory: function, flat, flat%, cum, cum%
  - Bar sparklines next to flat values for visual comparison
  - Toggle between CPU and memory profile views

- [ ] **Trend charts** — plot metrics over time from scan history

  - Dashboard section: "Trends"
  - Recharts line charts:
    - Issue count over time (separate lines for error/warning/info)
    - Grade over time
    - Test coverage over time
    - Benchmark ns/op over time
  - Time range selector: 7d, 30d, 90d, all

- [ ] **File watching (`--watch` flag)**

  - Use `fsnotify` to watch `**/*.go` in project dir
  - On file change: debounce 500ms, re-run pipeline
  - Push updated results via existing SSE endpoint
  - UI auto-refreshes dashboard/issues without page reload

- [ ] **Issue grouping & bulk fixes**

  - Group toggle in Issues page: by rule, by file, by category
  - Select-all within group, apply fix in batch
  - API: `POST /api/fix/batch` with `[]issueID` body

- [x] **Code snippets** — inline issue context (server-side file read)
- [x] **Dark mode toggle** — sun/moon in header
- [x] **Top nav bar** — light background, blue active tab
- [x] **Historical scan banner** — yellow strip with "Back to current"

---

## Quality of Life

- [ ] **`gopolice fix --all`** — apply all auto-fixable issues

  - CLI flag: `--all` or `fix` subcommand
  - Iterate `ScanResult.Issues`, skip non-editable, apply each
  - Report summary: `Applied 12/15 fixes (3 skipped)`

- [ ] **`.gitignore` awareness** — auto-skip ignored dirs

  - Use `git check-ignore` or parse `.gitignore`
  - Skip ignored directories in `filepath.Walk` scanners
  - No hardcoded `vendor`/`node_modules` exclusion needed

- [ ] **Configurable issue filters** — CLI flags to include/exclude

  - `--include-rule`, `--exclude-rule`, `--include-file`, `--exclude-file`
  - Filtering applied post-scan (results still stored unfiltered)
  - Useful for CI: ignore known non-blockers

- [ ] **Multi-module workspace support** (`go.work`)

  - Detect `go.work` file, parse `use` directives
  - Run scanners in each listed module
  - Aggregate all results into a single report
  - UI: filter by module

- [ ] **Configurable severity thresholds for CI exit codes**

  - `gopolice scan --exit-on-error` — exit 1 if any errors
  - `gopolice scan --grade-threshold B` — exit 1 if grade below B
  - `gopolice scan --max-issues 10` — exit 1 if more than 10 issues

---

## Maintenance & Polish

- [ ] **End-to-end tests** — Playwright or Cypress for UI flow
- [ ] **Load test** — scan a large project (e.g. k8s, 2M+ lines)
- [ ] **Benchmark regression tests** — compare current vs previous benchmark results
- [ ] **Documentation site** — GitHub Pages or similar with usage guides
- [ ] **i18n** — string externalization, initial English + Japanese
- [ ] **Telemetry (opt-in)** — anonymous usage stats to guide development
