# gopolice

A web UI reporting tool for Go projects. Scans for code quality, security issues, test results, git blame, and more.

## Install

```bash
go install github.com/rapando/gopolice@latest
```

This requires Go 1.22+. The web UI is pre-built and embedded into the binary — no Node.js needed at install time.

## Usage

```bash
# Scan the current project and open the web UI
gopolice scan

# Scan without opening the browser
gopolice scan --no-open

# Re-serve a previous scan result from cache
gopolice serve

# Export scan results as JSON
gopolice scan --output json

# Show version
gopolice version
```

## Configuration

Config is stored at `~/.config/gopolice/config.yaml` (global) and `.gopolice/config.yaml` (per-project).

```bash
# Open config in the web UI
gopolice --config

# Edit global config directly
gopolice config init
gopolice config show
```

## Development

```bash
# Build UI (requires Node.js 25+)
cd ui && npm install && npm run build

# Build binary
make build

# Run tests
make test
```

## CI/CD

- **Tests** run on every push to non-main branches.
- **Releases** are triggered by pushes to `main`.
  - `fix:` commits bump the patch version.
  - `feat:` commits bump the minor version.
  - `BREAKING CHANGE` in the commit body bumps the major version.
  - Release artifacts are built for darwin/arm64, linux/amd64, and linux/arm64.
