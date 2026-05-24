# gopolice

A web UI reporting tool for Go projects. Scans for code quality, security vulnerabilities, test results, git blame, performance benchmarks, dead code, dependency graphs, and more — all presented in a local web dashboard.

## Prerequisites

- **Go 1.26+** (required; [install](https://go.dev/doc/install))
- **Optional tools** (not needed for basic operation, but enable additional scanners):

  | Tool | Enables | Install |
  |------|---------|---------|
  | `golangci-lint` | Advanced linting | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
  | `gosec` | Security scanning | `go install github.com/securego/gosec/v2/cmd/gosec@latest` |
  | `govulncheck` | Vulnerability checking | `go install golang.org/x/vuln/cmd/govulncheck@latest` |
  | `staticcheck` | Dead code detection | `go install honnef.co/go/tools/cmd/staticcheck@latest` |
  | `git` | Git blame and stats | Bundled with your OS |

  All optional scanners degrade gracefully — the tool works with just `go`.

## Install

```bash
go install github.com/rapando/gopolice@latest
```

The web UI is pre-built and embedded into the binary. No Node.js required.

## Usage

```bash
# Scan the current project and open the web dashboard
gopolice scan

# Start the web server without running a new scan (re-serves cached results)
gopolice serve

# Serve with automatic re-scan on file changes
gopolice serve --watch

# View or manage scan history
gopolice history

# Show the current config
gopolice config

# Display version
gopolice version
```

Open `http://localhost:8580` in your browser after running `gopolice scan` or `gopolice serve`. The web UI lets you browse issues, tests, security findings, benchmarks, profile data, dependency graphs, git history, and trend charts — all from previous scans.

## Configuration

Config is stored at `~/.config/gopolice/config.yaml`. The only user-configurable option is the port:

```yaml
port: 8580
```

To change the port, edit the file directly or use the **Config** page in the web UI.

## Multi-module Workspaces

If your project has a `go.work` file, gopolice automatically detects it and runs all scanners against each module in the workspace. Results are aggregated into a single report, and issues are tagged with their module name. Use the **Module** group option in the Issues page to filter by module.

## Development

```bash
# Build UI (requires Node.js 20+)
cd ui && npm install && npm run build

# Build binary
make build

# Run tests
make test

# Run tests with race detector
make test-race
```

## CI/CD

- **Tests** run on every push to non-main branches.
- **Releases** are triggered by pushes to `main`.
  - `fix:` commits bump the patch version.
  - `feat:` commits bump the minor version.
  - `BREAKING CHANGE` in the commit body bumps the major version.
  - Release artifacts are built for darwin/arm64, linux/amd64, and linux/arm64.
