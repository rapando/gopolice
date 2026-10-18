package cmd

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/rapando/gopolice/internal/daemon"
)

// fakeManager records what the CLI asks of the init system.
type fakeManager struct {
	installed daemon.Spec
	actions   []string
	status    daemon.Status
	err       error
}

func (f *fakeManager) Name() string     { return "fake" }
func (f *fakeManager) UnitPath() string { return "/units/gopolice" }
func (f *fakeManager) Install(spec daemon.Spec) error {
	f.installed = spec
	f.actions = append(f.actions, "install")
	return f.err
}
func (f *fakeManager) Uninstall() error { f.actions = append(f.actions, "uninstall"); return f.err }
func (f *fakeManager) Start() error     { f.actions = append(f.actions, "start"); return f.err }
func (f *fakeManager) Stop() error      { f.actions = append(f.actions, "stop"); return f.err }
func (f *fakeManager) Restart() error   { f.actions = append(f.actions, "restart"); return f.err }
func (f *fakeManager) Status() (daemon.Status, error) {
	return f.status, nil
}
func (f *fakeManager) LogHint(daemon.Spec) string { return "Logs: fake" }

func useFakeManager(t *testing.T, m *fakeManager) {
	t.Helper()
	old, oldWait := newDaemon, healthWait
	newDaemon = func() (daemon.Manager, error) { return m, nil }
	healthWait = 0
	t.Cleanup(func() { newDaemon, healthWait = old, oldWait })
}

func runService(t *testing.T, args ...string) (string, error) {
	t.Helper()
	root := NewRootCommand()
	buf := new(bytes.Buffer)
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs(append([]string{"service"}, args...))
	err := root.Execute()
	return buf.String(), err
}

// fakeBinary stands in for the gopolice executable, so --exec validation
// does not depend on the test binary's location.
func fakeBinary(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "gopolice")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	// The unit stores the symlink-free path (macOS puts temp dirs behind /private).
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		p = resolved
	}
	return p
}

func TestServiceInstallBuildsSpec(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", "/opt/tools/bin:/usr/bin")
	t.Setenv("GOPATH", "/gp")
	exe := fakeBinary(t)
	m := &fakeManager{}
	useFakeManager(t, m)

	out, err := runService(t, "install", "--exec", exe, "--port", "8080", "--auth", "local", "--allowed-host", "h1", "--allowed-host", "h2")
	if err != nil {
		t.Fatalf("install: %v\n%s", err, out)
	}
	if m.installed.Executable != exe {
		t.Errorf("executable = %q, want %q", m.installed.Executable, exe)
	}
	wantArgs := []string{"service", "--no-open", "--port", "8080", "--auth", "local", "--allowed-host", "h1", "--allowed-host", "h2"}
	if !reflect.DeepEqual(m.installed.Args, wantArgs) {
		t.Errorf("args = %v, want %v", m.installed.Args, wantArgs)
	}
	if m.installed.Env["PATH"] != "/opt/tools/bin:/usr/bin" || m.installed.Env["GOPATH"] != "/gp" {
		t.Errorf("env not captured: %v", m.installed.Env)
	}
	if !strings.HasSuffix(m.installed.LogFile, filepath.Join(".config", "gopolice", "service.log")) {
		t.Errorf("log file = %q", m.installed.LogFile)
	}
	for _, want := range []string{"Installed fake unit at /units/gopolice", "localhost:8080", "Logs: fake", "gopolice service uninstall"} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
}

func TestServiceInstallRejectsBadFlags(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	m := &fakeManager{}
	useFakeManager(t, m)
	exe := fakeBinary(t)

	cases := map[string][]string{
		"wildcard host without allowed-host": {"--host", "0.0.0.0"},
		"tls cert without key":               {"--tls-cert", "cert.pem"},
		"unknown auth":                       {"--auth", "ldap"},
		"missing binary":                     {"--exec", "/nonexistent/gopolice"},
	}
	for name, extra := range cases {
		args := append([]string{"install", "--exec", exe}, extra...)
		if _, err := runService(t, args...); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	if len(m.actions) != 0 {
		t.Errorf("nothing should be installed on bad flags, got %v", m.actions)
	}
}

func TestServiceInstallReportsManagerError(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	m := &fakeManager{err: errors.New("launchctl exploded")}
	useFakeManager(t, m)
	if _, err := runService(t, "install", "--exec", fakeBinary(t)); err == nil || !strings.Contains(err.Error(), "launchctl exploded") {
		t.Fatalf("expected manager error, got %v", err)
	}
}

func TestServiceControlCommands(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	m := &fakeManager{status: daemon.Status{Installed: true, Running: true, PID: 99, Detail: "running"}}
	useFakeManager(t, m)

	for _, sub := range []string{"start", "stop", "restart", "uninstall"} {
		out, err := runService(t, sub)
		if err != nil {
			t.Fatalf("%s: %v\n%s", sub, err, out)
		}
	}
	if want := []string{"start", "stop", "restart", "uninstall"}; !reflect.DeepEqual(m.actions, want) {
		t.Errorf("actions = %v, want %v", m.actions, want)
	}

	out, err := runService(t, "status")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "running (pid 99)") || !strings.Contains(out, "/units/gopolice") {
		t.Errorf("status output:\n%s", out)
	}

	m.status = daemon.Status{}
	out, _ = runService(t, "status")
	if !strings.Contains(out, "Not installed") {
		t.Errorf("status output:\n%s", out)
	}
}

func TestServiceInstallUnsupportedPlatform(t *testing.T) {
	old := newDaemon
	newDaemon = func() (daemon.Manager, error) { return nil, daemon.ErrUnsupported }
	t.Cleanup(func() { newDaemon = old })
	if _, err := runService(t, "install", "--exec", fakeBinary(t)); !errors.Is(err, daemon.ErrUnsupported) {
		t.Fatalf("expected ErrUnsupported, got %v", err)
	}
}

func TestIsTemporary(t *testing.T) {
	if !isTemporary(filepath.Join(os.TempDir(), "go-build123", "b001", "exe", "gopolice")) {
		t.Error("go run binary should be temporary")
	}
	if isTemporary("/usr/local/bin/gopolice") {
		t.Error("installed binary should not be temporary")
	}
}
