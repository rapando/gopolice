.PHONY: build test clean lint

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS = -X github.com/rapando/gopolice/cmd.Version=$(VERSION)

build:
	go build -ldflags "$(LDFLAGS)" -o bin/gopolice .

test:
	go test -v -count=1 ./...

test-short:
	go test -count=1 -short ./...

test-race:
	go test -race -count=1 ./...

clean:
	rm -rf bin/

install:
	go install -ldflags "$(LDFLAGS)" .

build-all:
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/gopolice_darwin_arm64 .
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/gopolice_linux_amd64 .
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/gopolice_linux_arm64 .
