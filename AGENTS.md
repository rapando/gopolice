# gopolice — Agent Instructions

## Build
- `go build ./...` — build all packages
- `go build -o bin/gopolice .` — build binary
- `make build` — build binary with version ldflags
- `make build-all` — cross-compile for darwin/arm64, linux/amd64, linux/arm64

## Test
- `go test ./...` — run all tests
- `go test -v -count=1 ./...` — verbose, no cache
- `go test -race -count=1 ./...` — with race detector
- `make test` — run all tests with verbose
- `make test-race` — run with race detector

## Lint
- `go vet ./...` — standard Go vet

## Project structure
- `cmd/` — cobra CLI commands
- `internal/config/` — config types, loading, saving, merging
- `main.go` — entry point
