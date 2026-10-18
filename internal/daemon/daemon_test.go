package daemon

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeRunner records commands and answers from a script keyed by the
// command's first two words (e.g. "launchctl bootstrap").
type fakeRunner struct {
	calls   []string
	replies map[string]struct {
		out string
		err error
	}
}

func (f *fakeRunner) run(name string, args ...string) (string, error) {
	call := name + " " + strings.Join(args, " ")
	f.calls = append(f.calls, call)
	key := name
	if len(args) > 0 {
		key += " " + args[0]
		if name == "systemctl" && len(args) > 1 {
			key += " " + args[1]
		}
	}
	if r, ok := f.replies[key]; ok {
		return r.out, r.err
	}
	return "", nil
}

func (f *fakeRunner) reply(key, out string, err error) {
	if f.replies == nil {
		f.replies = map[string]struct {
			out string
			err error
		}{}
	}
	f.replies[key] = struct {
		out string
		err error
	}{out, err}
}

func (f *fakeRunner) called(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

var testSpec = Spec{
	Executable: "/usr/local/bin/gopolice",
	Args:       []string{"service", "--no-open", "--port", "8080", "--allowed-host", "a&b <c>"},
	LogFile:    "/home/me/.config/gopolice/service.log",
	Env:        map[string]string{"PATH": "/usr/bin:/opt/go/bin", "GOPATH": `/home/me/go "quoted"`},
}

func TestRenderPlist(t *testing.T) {
	out := string(renderPlist(testSpec))
	for _, want := range []string{
		"<key>Label</key>\n\t<string>" + Label + "</string>",
		"<string>/usr/local/bin/gopolice</string>",
		"<string>service</string>",
		"<string>--no-open</string>",
		"<string>8080</string>",
		"<string>a&amp;b &lt;c&gt;</string>", // XML-escaped
		"<key>RunAtLoad</key>\n\t<true/>",
		"<key>KeepAlive</key>\n\t<true/>",
		"<key>StandardOutPath</key>\n\t<string>/home/me/.config/gopolice/service.log</string>",
		"<key>StandardErrorPath</key>",
		"<key>GOPATH</key>\n\t\t<string>/home/me/go &#34;quoted&#34;</string>",
		"<key>PATH</key>\n\t\t<string>/usr/bin:/opt/go/bin</string>",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("plist missing %q:\n%s", want, out)
		}
	}
	// GOPATH sorts before PATH: deterministic output.
	if strings.Index(out, "<key>GOPATH</key>") > strings.Index(out, "<key>PATH</key>") {
		t.Errorf("environment keys not sorted:\n%s", out)
	}
}

func TestRenderUnit(t *testing.T) {
	out := string(renderUnit(testSpec))
	for _, want := range []string{
		"[Unit]\n",
		`ExecStart="/usr/local/bin/gopolice" "service" "--no-open" "--port" "8080" "--allowed-host" "a&b <c>"`,
		"Restart=on-failure",
		`Environment="GOPATH=/home/me/go \"quoted\""`,
		`Environment="PATH=/usr/bin:/opt/go/bin"`,
		"WantedBy=default.target",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("unit missing %q:\n%s", want, out)
		}
	}
}

func TestLaunchdInstallUninstall(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{}
	fr.reply("launchctl bootout", "Boot-out failed: 3: No such process", errors.New("exit 3"))
	l := &launchd{home: home, uid: 501, run: fr.run}

	if err := l.Install(testSpec); err != nil {
		t.Fatalf("install: %v", err)
	}
	plist := filepath.Join(home, "Library", "LaunchAgents", Label+".plist")
	if l.UnitPath() != plist {
		t.Errorf("unit path = %s, want %s", l.UnitPath(), plist)
	}
	info, err := os.Stat(plist)
	if err != nil {
		t.Fatalf("plist not written: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("plist mode = %o, want 600", info.Mode().Perm())
	}
	if !fr.called("launchctl bootstrap gui/501 " + plist) {
		t.Errorf("bootstrap not called: %v", fr.calls)
	}

	// A "no such process" from bootout is not an error.
	if err := l.Uninstall(); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	if _, err := os.Stat(plist); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("plist still present after uninstall")
	}
	if !fr.called("launchctl bootout gui/501/" + Label) {
		t.Errorf("bootout not called: %v", fr.calls)
	}
}

func TestLaunchdRestartKickstartsInPlace(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{}
	l := &launchd{home: home, uid: 501, run: fr.run}
	if err := l.Restart(); err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("expected not-installed error, got %v", err)
	}
	if err := writeUnit(l.UnitPath(), renderPlist(testSpec)); err != nil {
		t.Fatal(err)
	}

	// Loaded job: a single kickstart -k, never a bootout.
	if err := l.Restart(); err != nil {
		t.Fatalf("restart: %v", err)
	}
	if !fr.called("launchctl kickstart -k gui/501/"+Label) || fr.called("launchctl bootout") {
		t.Errorf("unexpected calls: %v", fr.calls)
	}

	// Nothing loaded: kickstart fails, so it is bootstrapped.
	fr.calls = nil
	fr.reply("launchctl kickstart", "Could not find service", errors.New("exit 113"))
	if err := l.Restart(); err != nil {
		t.Fatalf("restart when unloaded: %v", err)
	}
	if !fr.called("launchctl bootstrap gui/501 " + l.UnitPath()) {
		t.Errorf("bootstrap not called: %v", fr.calls)
	}
}

func TestLaunchdInstallBootstrapFails(t *testing.T) {
	fr := &fakeRunner{}
	fr.reply("launchctl bootstrap", "Bootstrap failed: 5: Input/output error", errors.New("exit 5"))
	l := &launchd{home: t.TempDir(), uid: 501, run: fr.run}
	if err := l.Install(testSpec); err == nil || !strings.Contains(err.Error(), "register with launchd") {
		t.Fatalf("expected bootstrap failure, got %v", err)
	}
}

func TestLaunchdStartRequiresInstall(t *testing.T) {
	fr := &fakeRunner{}
	l := &launchd{home: t.TempDir(), uid: 501, run: fr.run}
	if err := l.Start(); err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("expected not-installed error, got %v", err)
	}
	if len(fr.calls) != 0 {
		t.Errorf("launchctl should not run when nothing is installed: %v", fr.calls)
	}
}

func TestLaunchdStatus(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{}
	l := &launchd{home: home, uid: 501, run: fr.run}

	fr.reply("launchctl print", "Could not find service", errors.New("exit 113"))
	st, err := l.Status()
	if err != nil {
		t.Fatal(err)
	}
	if st.Installed || st.Running {
		t.Errorf("expected not installed/not running, got %+v", st)
	}

	if err := writeUnit(l.UnitPath(), renderPlist(testSpec)); err != nil {
		t.Fatal(err)
	}
	fr.reply("launchctl print", "gui/501/com.rapando.gopolice = {\n\tactive count = 1\n\tpath = /x.plist\n\tstate = running\n\n\tprogram = /usr/local/bin/gopolice\n\tpid = 4242\n}", nil)
	st, err = l.Status()
	if err != nil {
		t.Fatal(err)
	}
	if !st.Installed || !st.Running || st.PID != 4242 || st.Detail != "running" {
		t.Errorf("unexpected status %+v", st)
	}
}

func TestSystemdInstallAndStatus(t *testing.T) {
	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", "")
	fr := &fakeRunner{}
	s := &systemd{home: home, run: fr.run}

	if err := s.Install(testSpec); err != nil {
		t.Fatalf("install: %v", err)
	}
	unit := filepath.Join(home, ".config", "systemd", "user", UnitName)
	if _, err := os.Stat(unit); err != nil {
		t.Fatalf("unit not written at %s: %v", unit, err)
	}
	for _, want := range []string{"systemctl --user daemon-reload", "systemctl --user enable --now " + UnitName, "systemctl --user restart " + UnitName} {
		if !fr.called(want) {
			t.Errorf("missing call %q in %v", want, fr.calls)
		}
	}

	fr.reply("systemctl --user show", "ActiveState=active\nSubState=running\nMainPID=777", nil)
	st, err := s.Status()
	if err != nil {
		t.Fatal(err)
	}
	if !st.Installed || !st.Running || st.PID != 777 || st.Detail != "active (running)" {
		t.Errorf("unexpected status %+v", st)
	}

	if err := s.Uninstall(); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	if _, err := os.Stat(unit); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("unit still present after uninstall")
	}
	if !fr.called("systemctl --user disable --now " + UnitName) {
		t.Errorf("disable not called: %v", fr.calls)
	}
}

func TestSystemdUnitPathHonoursXDG(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "/xdg")
	s := &systemd{home: "/home/me"}
	if got := s.UnitPath(); got != filepath.Join("/xdg", "systemd", "user", UnitName) {
		t.Errorf("unit path = %s", got)
	}
}

func TestNewForUnsupported(t *testing.T) {
	if _, err := newFor("windows"); !errors.Is(err, ErrUnsupported) {
		t.Errorf("expected ErrUnsupported, got %v", err)
	}
	for _, goos := range []string{"darwin", "linux"} {
		m, err := newFor(goos)
		if err != nil || m == nil {
			t.Errorf("%s: %v", goos, err)
		}
	}
}
