# gopolice — Feature Roadmap

> **Status key:** ✅ Done  🔜 In Progress  ⬜ Not Started

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

## Quality of Life

- [ ] **`gopolice fix --all`** — apply all auto-fixable issues

  - CLI flag: `--all` or `fix` subcommand
  - Iterate `ScanResult.Issues`, skip non-editable, apply each
  - Report summary: `Applied 12/15 fixes (3 skipped)`

- [ ] **Configurable issue filters** — CLI flags to include/exclude

  - `--include-rule`, `--exclude-rule`, `--include-file`, `--exclude-file`
  - Filtering applied post-scan (results still stored unfiltered)
  - Useful for CI: ignore known non-blockers

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
