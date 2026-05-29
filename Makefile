.PHONY: build test clean lint

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS = -X github.com/rapando/gopolice/cmd.Version=$(VERSION)

CPUS ?= $(shell getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

build:
	go build -ldflags "$(LDFLAGS)" -o bin/gopolice .

test:
	@echo "Running tests on $(CPUS) CPU cores..."
	go test -v -count=1 -parallel=$(CPUS) ./...

test-short:
	@echo "Running tests on $(CPUS) CPU cores..."
	go test -count=1 -short -parallel=$(CPUS) ./...

test-race:
	@echo "Running tests (race) on $(CPUS) CPU cores..."
	go test -race -count=1 -parallel=$(CPUS) ./...

clean:
	rm -rf bin/

install:
	go install -ldflags "$(LDFLAGS)" .

build-all:
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/gopolice_darwin_arm64 .
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o bin/gopolice_linux_amd64 .
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o bin/gopolice_linux_arm64 .
