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

### Option 1: `go install` (recommended)

```bash
go install github.com/rapando/gopolice@latest
```

The web UI is pre-built and embedded into the binary. No Node.js required.

After installing, verify with:

```bash
gopolice version
```

If the version shown is not what you expect, make sure `$(go env GOPATH)/bin` is in your `PATH` and no old binary is shadowing it (`which gopolice` will show you the location).

### Option 2: Download a release binary

Download the latest release for your platform from the [Releases page](https://github.com/rapando/gopolice/releases), extract it, and place the `gopolice` binary somewhere in your `PATH`.

### Option 3: Build from source

```bash
git clone https://github.com/rapando/gopolice.git
cd gopolice
make install
```

This embeds the exact git tag as the version via ldflags.

## Update

Run the same install command you used initially:

```bash
go install github.com/rapando/gopolice@latest
```

`go install` always fetches the latest tagged release. Verify with `gopolice version` after updating.

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

Open `http://localhost:9393` in your browser after running `gopolice scan` or `gopolice serve`. The web UI lets you browse issues, tests, security findings, benchmarks, profile data, dependency graphs, git history, and trend charts — all from previous scans.

## Running as a service

Instead of running gopolice inside a repository, run it once as a service and
open repositories from the browser:

```bash
gopolice service            # http://localhost:9393, loopback only
gopolice service -p 8080    # choose the port
```

- **Open repositories** from the UI (folder picker or pasted path). They are
  saved in `~/.config/gopolice/projects.json` and listed on the next start.
- **Scan** any saved repository from its card or from its dashboard. Each
  repository keeps its own latest result and scan history. Starting a scan
  opens a progress window that lists every scanner with live counts (for
  example *12 of 96 tests*, *3 of 9 packages profiled*), the tool each step is
  running, and a log. Close it and the scan keeps going; the *Scanning…*
  button reopens it, and reloading the page mid-scan shows it again.
- **Sign in (macOS, default):** with your macOS account password, or with
  Touch ID. The Touch ID prompt appears on the Mac running the service, so it
  is only offered when you browse from that machine. Only the user who started
  the service can sign in, and gopolice stores no credentials.
- **Sign in (`--auth local`, default off macOS):** gopolice keeps its own
  username and password, plus optional passkeys (Touch ID, Windows Hello,
  device PIN) added under *Account*. Accounts live in
  `~/.config/gopolice/auth.json` (mode 0600).

By default the service only listens on loopback. To reach it from other
machines:

```bash
gopolice service --host 0.0.0.0 --allowed-host gopolice.example.com \
  --tls-cert cert.pem --tls-key key.pem
```

`--allowed-host` is the name clients use (it is checked against the `Host`
header), and passkeys only work over HTTPS or on `localhost`. When exposed,
first-run account creation requires a setup token printed in the terminal.

Because a scan runs `go vet`, `go test` and benchmarks in the repository, only
open repositories you trust, and keep the service behind its login.

`gopolice scan` and `gopolice serve` are unchanged: one repository, no login.

### Running in the background

`gopolice service` runs in the foreground. To have the operating system start
it at login and keep it running, install it as a background service:

```bash
gopolice service install                 # same flags as `gopolice service`
gopolice service install -p 8080 --host 0.0.0.0 --allowed-host gopolice.example.com \
  --tls-cert cert.pem --tls-key key.pem

gopolice service status                  # installed? running? where are the logs?
gopolice service stop                    # until next login or `start`
gopolice service start
gopolice service restart
gopolice service uninstall               # keeps ~/.config/gopolice
```

- **macOS:** a LaunchAgent at `~/Library/LaunchAgents/com.rapando.gopolice.plist`.
  It runs in your login session, so Touch ID sign-in keeps working. Output goes
  to `~/.config/gopolice/service.log`.
- **Linux:** a systemd user unit at `~/.config/systemd/user/gopolice.service`
  (`systemctl --user`, no root needed). Logs are in
  `journalctl --user -u gopolice`. Run `loginctl enable-linger $USER` if the
  service should keep running while you are logged out.

The unit stores the path of the `gopolice` binary you ran `install` with and
your current `PATH`, so scans can find `go`, `golangci-lint` and the other
tools. After upgrading gopolice, run `gopolice service restart` (or `install`
again if the binary moved).

## Configuration

Config is stored at `~/.config/gopolice/config.yaml`:

```yaml
port: 9393              # web UI port; the next free port is used if taken
disabled_scanners:      # optional: scanners to skip
  - benchmarks
  - profile
```

Scanner names: `lint`, `security`, `tests`, `benchmarks`, `profile`, `deadcode`, `depgraph`, `complexity`, `filestats`, `git`. Skipping `benchmarks` and `profile` makes scans much faster on projects with heavy benchmarks.

To change the port, edit the file directly or use the **Config** page in the web UI.

The web UI listens on localhost only, and its API rejects requests from other origins.

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
