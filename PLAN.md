# gopolice — Go Project Reporting Tool

## Overview
`gopolice` is a CLI tool that introspects a Go project, runs multiple analysis passes, aggregates the results, and serves an interactive web UI for browsing and fixing issues.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────┐
│                     gopolice                          │
│                                                       │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │   CLI     │─▶│  Scanner   │─▶│   Aggregator /    │  │
│  │  (cobra)  │  │  Pipeline  │  │   Normalizer      │  │
│  └──────────┘  └────────────┘  └────────┬─────────┘  │
│                                          │            │
│  ┌───────────────────────────────────────▼─────────┐  │
│  │              Data Store / API                    │  │
│  │  (in-memory map + file cache in ~/.config/gopolice)│  │
│  └───────────────────────────────────────▲─────────┘  │
│                                          │            │
│  ┌───────────────────────────────────────▼─────────┐  │
│  │            HTTP Server (net/http, embed)         │  │
│  │   REST endpoints + SSE/WebSocket live updates    │  │
│  └───────────────────────────────────────┬─────────┘  │
│                                          │            │
│  ┌───────────────────────────────────────▼─────────┐  │
│  │              Static Web UI (embed)               │  │
│  │   React SPA — bundled into Go binary via //go:embed│ │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 2. CLI Commands

| Command | Description |
|---------|-------------|
| `gopolice scan` | Run all scanners, aggregate, launch UI |
| `gopolice scan --quick` | Skip expensive passes (pprof, full lint suite) |
| `gopolice scan --output json` | Write results to stdout/JSON file, no UI |
| `gopolice scan --only lint,test,security` | Restrict which scanners run |
| `gopolice serve [path-to-cache]` | Re-serve a previous scan result |
| `gopolice --config` | Open the config editor in the web UI (no scan, works from any directory). Edits both global (`~/.config/gopolice/`) and project-level (`.gopolice/`) configs via the UI. |
| `gopolice config init` | Create default config at `~/.config/gopolice/config.yaml` |
| `gopolice config show` | Print current merged config |
| `gopolice version` | Print version |

---

## 3. Scanner Pipeline

Each scanner is an interface:

```go
type Scanner interface {
    Name() string
    Run(ctx context.Context, cfg *Config) (*ScannerResult, error)
}
```

### 3.1 Code Quality Scanner
- **Tool**: `golangci-lint` (aggregates `staticcheck`, `govet`, `errcheck`, `ineffassign`, `unused`, `gocyclo` etc.)
- **Data**: Linter name, severity, file:line, message, category
- **Fallback**: If `golangci-lint` not installed, run `go vet` + `staticcheck` individually

### 3.2 Security Scanner
- **Tool**: `gosec`
- **Data**: Rule ID, severity, file:line, description, CWE reference
- **Secondary**: `govulncheck` for known CVE dependencies

### 3.3 Logical Issues / Bug Finder
- **Tool**: `staticcheck` (SA category) + `go vet` + custom detectors (nil deref, race conditions)
- **Data**: Category, severity, file:line, message

### 3.4 Test Scanner
- **Data**: 
  - `go test ./...` — pass/fail counts, duration
  - `go test -coverprofile=...` — per-package coverage percentages
  - `go test -bench=. -benchmem` — benchmark results (optional, `--bench` flag)
- Display: coverage heatmap, slowest tests, flaky test detection

### 3.5 Performance Profiling Scanner
- **Tool**: `pprof` via `go test -bench` or `go test -cpuprofile`/`-memprofile`
- **Data**: CPU hotspots, memory allocations, goroutine leaks
- Display: flamegraph (SVG) embedded in UI, allocation heatmap
- **Note**: Expensive — only runs if `--profile` flag is set

### 3.6 Git Blame Scanner
- **Integration**: Annotate every finding with `git blame` info (author, date, commit hash)
- **Standalone**: Show per-author issue counts, hot files by churn
- **Data**: file → line → {author, commit, date, timestamp}

### 3.7 Complexity Analyzer (bonus)
- **Custom**: Parse Go AST, compute cyclomatic complexity per function
- **Data**: function name, complexity score, file:line

### 3.8 File Statistics (bonus)
- Total lines, total files, `.go` file count, `go.mod` deps count
- Dependency tree from `go mod graph`

---

## 4. Data Model

```go
type ScanResult struct {
    ProjectName  string
    ScanTime     time.Time
    Duration     time.Duration
    Config       *Config
    Files        []FileInfo
    Issues       []Issue
    TestResults  *TestResult
    Benchmarks   []BenchmarkResult
    ProfileCPU   string // path to CPU profile
    ProfileMem   string // path to mem profile
    Deps         []Dependency
    GitInfo      *GitInfo
}

type Issue struct {
    ID         string   // hash of file+line+rule for dedup
    Scanner    string   // "golangci-lint", "gosec", "staticcheck", etc.
    Rule       string   // e.g. "G101", "SA5000", "errcheck"
    Severity   string   // "error", "warning", "info"
    File       string
    Line       int
    Column     int
    Message    string
    Category   string   // "bug", "security", "style", "complexity", "test"
    SuggestedFix *Fix
    GitBlame   *BlameInfo
}

type Fix struct {
    Description string
    Patch       string // unified diff
    Editable    bool   // can auto-apply (simple fixes)
}
```

---

## 5. Web UI (React SPA, embedded via `//go:embed`)

### 5.1 Tech Stack
- **Framework**: React 18 + TypeScript
- **Routing**: react-router (hash router)
- **State**: Zustand (lightweight)
- **Charts**: recharts (bar/line charts) + react-flame-graph
- **UI Library**: Tailwind CSS + shadcn/ui components
- **Build**: Vite, output → `ui/dist/`, embedded into Go binary
- **Real-time**: Server-Sent Events (SSE) for live log streaming during scan

### 5.2 Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Dashboard | Summary cards, severity breakdown, coverage, issue count over time |
| `/issues` | Issue Browser | Filterable, sortable table of all issues |
| `/issues/:id` | Issue Detail | Full context: code snippet, blame, suggested fix, apply button |
| `/file/:path` | File View | Annotated source with inline issue markers, blame gutter, coverage |
| `/tests` | Test Report | Pass/fail, coverage %, slow tests, benchmark results |
| `/security` | Security Report | Vulns by severity, CVE details, affected deps |
| `/profile` | Performance | Flamegraph, CPU/memory top consumers |
| `/git` | Git Stats | Per-author issue counts, churn, hot files |
| `/config` | Configuration | View/edit current config (saved to ~/.config/gopolice) |

### 5.3 Interactive Features
- **Inline fix application**: For supported issues (e.g., `gofmt` style), click "Apply Fix" to auto-edit the file on disk
- **Code snippets**: Each issue shows 5 lines of surrounding context with syntax highlighting (CodeMirror or highlight.js)
- **Filtering**: By scanner, severity, file glob, author, category
- **Export**: Download report as JSON, HTML, or PDF
- **Sort ordering**: By severity, file, line, scanner, git author

### 5.4 API Endpoints (from Go server)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scan` | POST | Trigger a new scan |
| `/api/scan/status` | GET | SSE stream of scan progress |
| `/api/results` | GET | Full aggregated result |
| `/api/results/issues` | GET | Issues with query params (filter, sort, page) |
| `/api/results/issues/:id` | GET | Single issue with context |
| `/api/results/tests` | GET | Test results |
| `/api/results/profile` | GET | Profile data |
| `/api/results/git` | GET | Git stats |
| `/api/results/deps` | GET | Dependency info |
| `/api/fix/:id` | POST | Apply suggested fix for an issue |
| `/api/config` | GET | Read merged config (global + project) |
| `/api/config/global` | GET/PUT | Read/update `~/.config/gopolice/config.yaml` |
| `/api/config/project` | GET/PUT | Read/update `.gopolice/config.yaml` (if inside a Go project) |
| `/api/health` | GET | Health check |

---

## 6. Storage Layout (Two-Tier)

### Global Config — `~/.config/gopolice/`
XDG-compliant, holds user-wide **tool configs and linter rule files** that apply across all projects.

```
~/.config/gopolice/
├── config.yaml                # Global user preferences (UI theme, default port, etc.)
├── .golangci.yml              # golangci-lint config shipped with gopolice (or user-provided)
├── gosec-config.json          # gosec rule overrides
├── staticcheck.conf           # staticcheck configuration
└── templates/                 # Custom report templates (optional)
    └── report.html
```

### Project Config & Data — `./.gopolice/`
Per-project directory (committed to `.gitignore` or left local), holds **project-specific findings, scan results, and settings**.

```
.gopolice/
├── config.yaml                # Project-specific settings (scanner toggles, excludes, flags)
├── cache/
│   └── result.json            # Latest aggregated scan result
│   └── cpuprofile             # CPU profile (pprof binary)
│   └── memprofile             # Memory profile (pprof binary)
│   └── coverage.out           # Go coverage profile
└── history/                   # Historical scan results for trend tracking
    └── 2026-05-23T10-00-00.json
```

### Merged Config Precedence (low → high):
1. Built-in defaults in code
2. `~/.config/gopolice/config.yaml` (global user config)
3. `.gopolice/config.yaml` (project config, highest priority)

### config.yaml (global `~/.config/gopolice/`) structure:

```yaml
project:
  path: "."                # Path to Go project (default: cwd)
  exclude_dirs:            # Directories to skip
    - vendor
    - node_modules

scan:
  quick: false             # Skip expensive scans
  profile: false           # Run CPU/mem profiling
  bench: false             # Run benchmarks
  scanners:                # Individual toggles
    lint: true
    security: true
    tests: true
    profile: false
    git: true
    complexity: true

ui:
  port: 9393               # Default port for web UI
  open_browser: true       # Auto-open browser on scan complete
  theme: "light"           # "light" | "dark" | "system"

export:
  format: "json"           # "json" | "html" | "pdf"
  output: "report.html"
```

---

## 7. Dependencies & Prerequisites

### Required Runtime Dependencies
| Tool | Purpose | Install |
|------|---------|---------|
| `go` (1.22+) | Compile & run the project itself | `brew install go` |
| `golangci-lint` | Meta-linter for code quality | `brew install golangci-lint` |
| `gosec` | Security inspection | `go install github.com/securego/gosec/v2/cmd/gosec@latest` |
| `git` | Blame & project git info | Usually pre-installed |

### Optional but Recommended
| Tool | Purpose | Install |
|------|---------|---------|
| `govulncheck` | CVE scanning in deps | `go install golang.org/x/vuln/cmd/govulncheck@latest` |
| `staticcheck` | Advanced static analysis | `go install honnef.co/go/tools/cmd/staticcheck@latest` |
| `pprof` | Performance profiling | Part of Go toolchain (`go tool pprof`) |

### Go Module Dependencies
```go
// CLI framework
github.com/spf13/cobra

// Config
gopkg.in/yaml.v3

// AST parsing
go/ast, go/parser, go/token (stdlib)

// HTTP + embed
net/http, embed (stdlib)

// Templating (optional HTML export)
html/template (stdlib)

// SSE
github.com/r3labs/sse (or hand-rolled)
```

### UI Build Dependencies
```
node >= 18
npm or pnpm
React 18, TypeScript, Tailwind CSS, Vite
```

---

## 8. Project Structure

```
gopolice/
├── cmd/
│   └── root.go              # cobra root command
│   └── scan.go              # `gopolice scan`
│   └── serve.go             # `gopolice serve`
│   └── config.go            # `gopolice config`
│   └── version.go
├── internal/
│   ├── scanner/
│   │   ├── scanner.go       # Scanner interface + pipeline runner
│   │   ├── lint.go          # golangci-lint / go vet
│   │   ├── security.go      # gosec + govulncheck
│   │   ├── tests.go         # go test runner + coverage
│   │   ├── profile.go       # pprof integration
│   │   ├── git.go           # git blame + stats
│   │   ├── complexity.go    # AST cyclomatic complexity
│   │   └── filestats.go     # Project file statistics
│   ├── config/
│   │   └── config.go        # Config loader/saver (yaml)
│   ├── api/
│   │   └── server.go        # HTTP server + all API handlers
│   │   └── sse.go           # SSE streaming for scan progress
│   ├── model/
│   │   └── types.go         # All data types
│   ├── fixer/
│   │   └── fixer.go         # Auto-apply suggested fixes
│   └── cache/
│       └── cache.go         # Scan result caching
├── ui/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Issues.tsx
│   │   │   ├── IssueDetail.tsx
│   │   │   ├── FileView.tsx
│   │   │   ├── Tests.tsx
│   │   │   ├── Security.tsx
│   │   │   ├── Profile.tsx
│   │   │   ├── GitStats.tsx
│   │   │   └── Config.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── tailwind.config.js
├── internal/embedded.go      # //go:embed ui/dist
├── Makefile
├── go.mod
└── go.sum
```

---

## 9. Implementation Phases

### Phase 1 — Foundation
- [ ] Project scaffold: `go mod init`, cobra CLI, config system
- [ ] Config load/save from `~/.config/gopolice/config.yaml`
- [ ] `gopolice config init`, `gopolice config show`

### Phase 2 — Scanner Pipeline
- [ ] Scanner interface + orchestrator with progress reporting
- [ ] Lint scanner (golangci-lint with fallback to go vet)
- [ ] Security scanner (gosec + govulncheck)
- [ ] Test scanner (test runner + coverage)
- [ ] Complexity scanner (AST walk)
- [ ] File stats scanner
- [ ] Git blame scanner

### Phase 3 — Storage & API
- [ ] Data model types
- [ ] In-memory store + JSON file cache
- [ ] HTTP server with all REST endpoints
- [ ] SSE streaming for scan progress

### Phase 4 — Web UI
- [ ] React SPA scaffold with Vite + Tailwind
- [ ] Dashboard page
- [ ] Issue Browser + Issue Detail
- [ ] File View with inline annotations
- [ ] Tests page (pass/fail, coverage, benchmarks)
- [ ] Security page
- [ ] Profile page with flamegraph
- [ ] Git stats page
- [ ] Config page

### Phase 5 — Interactive Fixing
- [ ] Fix detection (gofmt, simple linter auto-fixes)
- [ ] "Apply Fix" button → writes to file on disk
- [ ] Undo support (git checkout or backup)

### Phase 6 — Polish
- [ ] Embedded UI (`//go:embed ui/dist`)
- [ ] `gopolice scan` opens browser automatically
- [ ] JSON/HTML/PDF export
- [ ] Performance profiling scanner (pprof)
- [ ] Cross-platform testing
- [ ] CI pipeline

---

## 10. Test Plan

### Phase 1 — Foundation
| Test | Type | What to verify |
|------|------|----------------|
| `TestConfigInit` | Unit | `gopolice config init` creates `~/.config/gopolice/config.yaml` with defaults |
| `TestConfigLoadMerge` | Unit | Merged config correctly layers defaults → global → project |
| `TestConfigPrecedence` | Unit | Project config overrides global, global overrides defaults |
| `TestConfigShow` | Unit | `config show` outputs valid YAML with correct values |
| `TestCLIBasicCommands` | Integration | `--help`, `version`, `config` subcommands return exit 0 |
| `TestProjectConfigInit` | Unit | Running inside a Go project creates `.gopolice/config.yaml` |

### Phase 2 — Scanner Pipeline
| Test | Type | What to verify |
|------|------|----------------|
| `TestScannerInterface` | Unit | All scanners implement `Scanner` interface |
| `TestLintScanner_WithGolangciLint` | Integration | Runs against a known test project; returns expected issue count |
| `TestLintScanner_Fallback` | Integration | When `golangci-lint` missing, falls back to `go vet` |
| `TestSecurityScanner` | Integration | `gosec` scanner finds a hardcoded credential in fixture |
| `TestTestScanner_RunAndCoverage` | Integration | Runs `go test ./...` on test fixture; parses pass/fail + coverage |
| `TestComplexityScanner` | Integration | AST walk computes correct cyclomatic complexity for sample funcs |
| `TestGitBlameScanner` | Integration | Blame returns correct author/commit for fixture files |
| `TestFileStatsScanner` | Unit | Counts lines, files, `.go` files, deps correctly |
| `TestScannerPipeline_Orchestration` | Integration | Pipeline runs all enabled scanners, aggregates results, no panic |
| `TestScannerProgress_SSE` | Integration | Progress events emitted for each scanner start/complete |
| `TestScannerSkipMissingTools` | Integration | Missing tool logs warning, continues, doesn't fail |

### Phase 3 — Storage & API
| Test | Type | What to verify |
|------|------|----------------|
| `TestCache_SaveLoad` | Unit | Scan result round-trips through JSON cache in `.gopolice/cache/` |
| `TestCache_CorruptData` | Unit | Corrupt cache file is handled gracefully (re-scan) |
| `TestAPIHealth` | Integration | `GET /api/health` returns 200 |
| `TestAPIScanFlow` | Integration | `POST /api/scan` triggers pipeline, SSE streams progress |
| `TestAPIIssues` | Integration | `GET /api/results/issues` returns filtered/sorted/paginated issues |
| `TestAPISingleIssue` | Integration | `GET /api/results/issues/:id` returns full detail with code context |
| `TestAPITestResults` | Integration | `GET /api/results/tests` returns pass/fail + coverage data |
| `TestAPIGitStats` | Integration | `GET /api/results/git` returns per-author summary |
| `TestAPIConfigEndpoints` | Integration | `GET/PUT /api/config/global` and `/api/config/project` round-trip |
| `TestAPICORS` | Integration | CORS headers present for UI origin |

### Phase 4 — Web UI
| Test | Type | What to verify |
|------|------|----------------|
| `UIBuildSucceeds` | Build | `npm run build` exits 0, produces `ui/dist/` |
| `UIEmbeddedInBinary` | Build | `//go:embed ui/dist/*` compiles; binary serves index.html at `/` |
| `DashboardRender` | E2E | Dashboard loads with summary cards, severity chart, no console errors |
| `IssueBrowserRender` | E2E | Issue table renders rows; filtering by scanner/severity works |
| `IssueDetailRender` | E2E | Clicking an issue shows code snippet, blame info, fix button |
| `FileViewRender` | E2E | File view highlights issue lines inline; blame gutter populated |
| `TestPageRender` | E2E | Test page shows pass/fail table, coverage bar, benchmark results |
| `SecurityPageRender` | E2E | Security page lists vulns by severity with CVE details |
| `ProfilePageRender` | E2E | Profile page renders flamegraph SVG (or placeholder if no data) |
| `GitStatsPageRender` | E2E | Git stats page shows author table + churn chart |
| `ConfigPageRender` | E2E | Config page shows both global and project configs side-by-side |
| `UINavigation` | E2E | All routes navigable via sidebar; active route highlighted |
| `UINoConsoleErrors` | E2E | Zero console errors across all pages |

### Phase 5 — Interactive Fixing
| Test | Type | What to verify |
|------|------|----------------|
| `TestFixDetection` | Unit | Scanner detects which issues have auto-fix candidates |
| `TestFixApply` | Integration | `POST /api/fix/:id` applies patch to file on disk |
| `TestFixUndo` | Integration | Undo restores original file content (git checkout or backup) |
| `TestFix_NonEditable` | Unit | Issues without `Editable=true` return 400 on fix attempt |
| `TestFix_FileNotFound` | Integration | Fix for deleted file returns 404 |
| `TestFixAppliedInUI` | E2E | "Apply Fix" button triggers POST, shows success toast |
| `TestFixUndoInUI` | E2E | "Undo" button restores file, shows confirmation |

### Phase 6 — Polish
| Test | Type | What to verify |
|------|------|----------------|
| `TestProfileScanner` | Integration | `--profile` flag collects CPU/mem pprof data |
| `TestExportJSON` | Integration | `--output json` writes valid JSON to stdout/file |
| `TestExportHTML` | Integration | `--output html` renders HTML report from template |
| `TestBrowserAutoOpen` | Integration | `--open-browser` flag opens correct URL |
| `TestEmbeddedBinary_NoDeps` | Build | Final binary runs standalone without Go/Node installed (`./gopolice scan` on a project) |
| `TestCrossPlatform` | Build | Binary compiles for linux/amd64, linux/arm64, darwin/amd64, darwin/arm64 |
| `TestPerf_LargeProject` | Performance | Scan of 50k+ LoC project completes in under 30s |
| `TestPerf_UI_InitialLoad` | Performance | UI loads under 2s on localhost |
| `TestNoGoroutineLeaks` | Integration | Scan pipeline + server exit cleanly; all goroutines released |
| `TestHistoryTracking` | Integration | Consecutive scans create timestamped entries in `.gopolice/history/` |

---

## 11. Key Design Decisions

1. **Embedded UI**: The entire UI is compiled into the Go binary via `//go:embed`. No separate server or asset pipeline needed at runtime.
2. **Global config in `~/.config/gopolice/`**: XDG-compliant tool configs and linter rule files, shared across projects.
3. **Per-project data in `.gopolice/`**: Scan results, cache, and project-specific settings live inside the project for portability and git context. `.gopolice/` should be added to `.gitignore`.
4. **Tool auto-detection**: If a tool isn't installed, skip it (with a warning), don't fail.
5. **SSE over WebSocket**: Simpler, unidirectional (server→client), sufficient for scan progress.
6. **Zustand over Redux**: Lighter, simpler for this scope.
7. **shadcn/ui**: Copy-paste components (no heavy dependency), consistent with Tailwind.
