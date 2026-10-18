package daemon

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// UnitName is the systemd user unit.
const UnitName = "gopolice.service"

// systemd manages a user unit (systemctl --user), so no root is needed and
// the service runs as the account that installed it.
type systemd struct {
	home string
	run  runner
}

func (s *systemd) Name() string { return "systemd" }

func (s *systemd) UnitPath() string {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		base = filepath.Join(s.home, ".config")
	}
	return filepath.Join(base, "systemd", "user", UnitName)
}

func (s *systemd) ctl(args ...string) (string, error) {
	return s.run("systemctl", append([]string{"--user"}, args...)...)
}

func (s *systemd) Install(spec Spec) error {
	if err := writeUnit(s.UnitPath(), renderUnit(spec)); err != nil {
		return err
	}
	if _, err := s.ctl("daemon-reload"); err != nil {
		return fmt.Errorf("reload systemd: %w", err)
	}
	if _, err := s.ctl("enable", "--now", UnitName); err != nil {
		return fmt.Errorf("enable %s: %w", UnitName, err)
	}
	// A unit that was already active keeps running the old command line
	// after enable --now; make sure the new one is in effect.
	if _, err := s.ctl("restart", UnitName); err != nil {
		return fmt.Errorf("start %s: %w", UnitName, err)
	}
	return nil
}

func (s *systemd) Uninstall() error {
	_, _ = s.ctl("disable", "--now", UnitName)
	if err := removeUnit(s.UnitPath()); err != nil {
		return err
	}
	_, _ = s.ctl("daemon-reload")
	return nil
}

func (s *systemd) Start() error {
	if !fileExists(s.UnitPath()) {
		return fmt.Errorf("%s is not installed (run: gopolice service install)", UnitName)
	}
	_, err := s.ctl("start", UnitName)
	return err
}

func (s *systemd) Stop() error {
	_, err := s.ctl("stop", UnitName)
	return err
}

func (s *systemd) Restart() error {
	_, err := s.ctl("restart", UnitName)
	return err
}

func (s *systemd) Status() (Status, error) {
	st := Status{Installed: fileExists(s.UnitPath())}
	out, err := s.ctl("show", "-p", "ActiveState,SubState,MainPID", UnitName)
	if err != nil {
		st.Detail = "unknown"
		return st, nil
	}
	var active, sub string
	for _, line := range strings.Split(out, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		switch k {
		case "ActiveState":
			active = v
		case "SubState":
			sub = v
		case "MainPID":
			st.PID, _ = strconv.Atoi(v)
		}
	}
	st.Running = active == "active"
	st.Detail = active
	if sub != "" && sub != active {
		st.Detail = active + " (" + sub + ")"
	}
	return st, nil
}

func (s *systemd) LogHint(Spec) string {
	return "Logs: journalctl --user -u " + UnitName + " -f"
}

// renderUnit produces the systemd user unit. default.target is the user
// session's equivalent of multi-user.target.
func renderUnit(spec Spec) []byte {
	var b bytes.Buffer
	b.WriteString("[Unit]\n")
	b.WriteString("Description=gopolice web UI service\n")
	b.WriteString("After=network.target\n\n")
	b.WriteString("[Service]\n")
	b.WriteString("Type=simple\n")
	parts := []string{systemdQuote(spec.Executable)}
	for _, a := range spec.Args {
		parts = append(parts, systemdQuote(a))
	}
	fmt.Fprintf(&b, "ExecStart=%s\n", strings.Join(parts, " "))
	b.WriteString("Restart=on-failure\n")
	b.WriteString("RestartSec=5\n")
	for _, k := range sortedKeys(spec.Env) {
		fmt.Fprintf(&b, "Environment=%s\n", systemdQuote(k+"="+spec.Env[k]))
	}
	b.WriteString("\n[Install]\n")
	b.WriteString("WantedBy=default.target\n")
	return b.Bytes()
}

// systemdQuote wraps a value in double quotes using systemd's own escaping
// rules, which differ from the shell's.
func systemdQuote(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
