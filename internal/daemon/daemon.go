// Package daemon installs gopolice as a background service that the
// operating system starts at login and restarts if it dies: a launchd user
// agent on macOS, a systemd user unit on Linux.
package daemon

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ErrUnsupported is returned on platforms without a supported init system.
var ErrUnsupported = errors.New("background service is only supported on macOS (launchd) and Linux (systemd)")

// Spec describes the process the init system should keep running.
type Spec struct {
	// Executable is the absolute path of the gopolice binary.
	Executable string
	// Args are the command-line arguments after the executable.
	Args []string
	// LogFile receives stdout and stderr. systemd ignores it in favor of the
	// journal.
	LogFile string
	// Env is baked into the unit, because init systems start processes with
	// a minimal environment that cannot find go, golangci-lint and friends.
	Env map[string]string
}

// Status is the init system's view of the service.
type Status struct {
	Installed bool
	Running   bool
	PID       int
	// Detail is a short, human-readable state such as "running" or "inactive".
	Detail string
}

// Manager controls the service through one init system.
type Manager interface {
	// Name is the init system in use: "launchd" or "systemd".
	Name() string
	// UnitPath is where the unit definition is (or would be) written.
	UnitPath() string
	// Install writes the unit, registers it, and starts it.
	Install(spec Spec) error
	// Uninstall stops the service and removes the unit.
	Uninstall() error
	Start() error
	Stop() error
	Restart() error
	Status() (Status, error)
	// LogHint tells the user where the service's output goes.
	LogHint(spec Spec) string
}

// New returns the Manager for this operating system.
func New() (Manager, error) {
	return newFor(runtime.GOOS)
}

func newFor(goos string) (Manager, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("find home directory: %w", err)
	}
	switch goos {
	case "darwin":
		return &launchd{home: home, uid: os.Getuid(), run: runCommand}, nil
	case "linux":
		return &systemd{home: home, run: runCommand}, nil
	}
	return nil, ErrUnsupported
}

// runner executes an external command and returns its combined output.
type runner func(name string, args ...string) (string, error)

func runCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	out := strings.TrimSpace(buf.String())
	if err != nil {
		if out != "" {
			return out, fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, out)
		}
		return out, fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return out, nil
}

// writeUnit creates the unit file (and its directory) readable by the user
// only, since it may carry paths to TLS keys.
func writeUnit(path string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func removeUnit(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// sortedKeys gives deterministic unit files, which keeps installs
// reproducible and tests stable.
func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
