package daemon

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Label is the launchd job label, and the stem of the plist file name.
const Label = "com.rapando.gopolice"

// launchd manages a per-user LaunchAgent in the gui domain, which has a
// window-server session so Touch ID prompts can appear.
type launchd struct {
	home string
	uid  int
	run  runner
}

func (l *launchd) Name() string { return "launchd" }

func (l *launchd) UnitPath() string {
	return filepath.Join(l.home, "Library", "LaunchAgents", Label+".plist")
}

func (l *launchd) domain() string { return fmt.Sprintf("gui/%d", l.uid) }
func (l *launchd) target() string { return l.domain() + "/" + Label }

func (l *launchd) Install(spec Spec) error {
	if err := writeUnit(l.UnitPath(), renderPlist(spec)); err != nil {
		return err
	}
	// A previous install may still be loaded; replace it.
	_ = l.bootout()
	if _, err := l.run("launchctl", "bootstrap", l.domain(), l.UnitPath()); err != nil {
		return fmt.Errorf("register with launchd: %w", err)
	}
	return nil
}

func (l *launchd) Uninstall() error {
	_ = l.bootout()
	return removeUnit(l.UnitPath())
}

func (l *launchd) Start() error {
	if !fileExists(l.UnitPath()) {
		return fmt.Errorf("%s is not installed (run: gopolice service install)", Label)
	}
	// bootstrap loads and (RunAtLoad) starts the job. If it is already loaded
	// but stopped, kickstart starts it.
	if _, err := l.run("launchctl", "bootstrap", l.domain(), l.UnitPath()); err != nil {
		if _, kerr := l.run("launchctl", "kickstart", l.target()); kerr != nil {
			return fmt.Errorf("start %s: %w", Label, err)
		}
	}
	return nil
}

func (l *launchd) Stop() error {
	// KeepAlive would restart a killed process, so stopping means unloading.
	return l.bootout()
}

func (l *launchd) Restart() error {
	if !fileExists(l.UnitPath()) {
		return fmt.Errorf("%s is not installed (run: gopolice service install)", Label)
	}
	// kickstart -k restarts a loaded job in place. Stop followed by Start
	// does not work here: bootout unloads asynchronously, so an immediate
	// bootstrap races it and can leave nothing running.
	if _, err := l.run("launchctl", "kickstart", "-k", l.target()); err == nil {
		return nil
	}
	return l.Start()
}

// bootout unloads the job. A job that is not loaded is not an error.
func (l *launchd) bootout() error {
	out, err := l.run("launchctl", "bootout", l.target())
	if err != nil && !isNotLoaded(out) {
		return fmt.Errorf("stop %s: %w", Label, err)
	}
	return nil
}

func isNotLoaded(out string) bool {
	out = strings.ToLower(out)
	return strings.Contains(out, "no such process") ||
		strings.Contains(out, "could not find service") ||
		strings.Contains(out, "not find") ||
		strings.Contains(out, "input/output error") // launchctl's code for "nothing loaded"
}

var (
	plistPID   = regexp.MustCompile(`(?m)^\s*pid = (\d+)`)
	plistState = regexp.MustCompile(`(?m)^\s*state = (\w+)`)
)

func (l *launchd) Status() (Status, error) {
	st := Status{Installed: fileExists(l.UnitPath())}
	out, err := l.run("launchctl", "print", l.target())
	if err != nil {
		st.Detail = "not loaded"
		return st, nil
	}
	if m := plistState.FindStringSubmatch(out); m != nil {
		st.Detail = m[1]
	}
	if m := plistPID.FindStringSubmatch(out); m != nil {
		st.PID, _ = strconv.Atoi(m[1])
	}
	st.Running = st.PID > 0 || st.Detail == "running"
	if st.Detail == "" {
		st.Detail = "loaded"
	}
	return st, nil
}

func (l *launchd) LogHint(spec Spec) string {
	return "Logs: " + spec.LogFile
}

// renderPlist produces the LaunchAgent property list. RunAtLoad starts the
// service at login (and right after install); KeepAlive restarts it if it
// exits, with launchd's own back-off when it keeps failing.
func renderPlist(spec Spec) []byte {
	var b bytes.Buffer
	b.WriteString(xml.Header)
	b.WriteString(`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` + "\n")
	b.WriteString("<plist version=\"1.0\">\n<dict>\n")
	fmt.Fprintf(&b, "\t<key>Label</key>\n\t<string>%s</string>\n", Label)
	b.WriteString("\t<key>ProgramArguments</key>\n\t<array>\n")
	fmt.Fprintf(&b, "\t\t<string>%s</string>\n", xmlEscape(spec.Executable))
	for _, a := range spec.Args {
		fmt.Fprintf(&b, "\t\t<string>%s</string>\n", xmlEscape(a))
	}
	b.WriteString("\t</array>\n")
	b.WriteString("\t<key>RunAtLoad</key>\n\t<true/>\n")
	b.WriteString("\t<key>KeepAlive</key>\n\t<true/>\n")
	b.WriteString("\t<key>ProcessType</key>\n\t<string>Background</string>\n")
	if spec.LogFile != "" {
		fmt.Fprintf(&b, "\t<key>StandardOutPath</key>\n\t<string>%s</string>\n", xmlEscape(spec.LogFile))
		fmt.Fprintf(&b, "\t<key>StandardErrorPath</key>\n\t<string>%s</string>\n", xmlEscape(spec.LogFile))
	}
	if len(spec.Env) > 0 {
		b.WriteString("\t<key>EnvironmentVariables</key>\n\t<dict>\n")
		for _, k := range sortedKeys(spec.Env) {
			fmt.Fprintf(&b, "\t\t<key>%s</key>\n\t\t<string>%s</string>\n", xmlEscape(k), xmlEscape(spec.Env[k]))
		}
		b.WriteString("\t</dict>\n")
	}
	b.WriteString("</dict>\n</plist>\n")
	return b.Bytes()
}

func xmlEscape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
