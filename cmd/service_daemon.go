package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/daemon"
	"github.com/spf13/cobra"
)

// newDaemon is swapped out by tests so they never touch launchctl/systemctl.
var newDaemon = daemon.New

// healthWait bounds how long install waits for the service to answer.
var healthWait = 5 * time.Second

// serviceLogPath is where the background service writes its output on
// macOS (systemd uses the journal).
func serviceLogPath() string {
	return filepath.Join(config.GlobalConfigDir(), "service.log")
}

func newServiceInstallCommand() *cobra.Command {
	var f serviceFlags
	var execPath string

	cmd := &cobra.Command{
		Use:   "install",
		Short: "Install gopolice as a background service that starts at login",
		Long: `Registers "gopolice service" with the operating system so it runs in the
background, starts when you log in, and is restarted if it exits.

  macOS   a LaunchAgent in ~/Library/LaunchAgents (launchd)
  Linux   a user unit in ~/.config/systemd/user (systemctl --user)

The flags accepted by "gopolice service" are stored in the unit, so pass the
port, host, TLS and login options here. Running install again replaces the
existing unit. Your current PATH is stored too, so scans can find go,
golangci-lint and the other tools you have installed.

On Linux, to keep the service running while you are logged out:
  loginctl enable-linger $USER`,
		RunE: func(c *cobra.Command, args []string) error {
			st, err := f.resolve()
			if err != nil {
				return err
			}
			mgr, err := newDaemon()
			if err != nil {
				return err
			}
			exe, err := resolveExecutable(execPath)
			if err != nil {
				return err
			}

			dir := config.GlobalConfigDir()
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return fmt.Errorf("create %s: %w", dir, err)
			}
			spec := daemon.Spec{
				Executable: exe,
				Args:       f.args(),
				LogFile:    serviceLogPath(),
				Env:        daemonEnv(),
			}
			if err := mgr.Install(spec); err != nil {
				return err
			}

			port := f.port
			if port == 0 {
				if cfg, err := config.DefaultLoadConfig(); err == nil {
					port = cfg.Port
				} else {
					port = config.DefaultPort
				}
			}
			url := f.serviceURL(st, port)

			c.PrintErrf("Installed %s unit at %s\n", mgr.Name(), mgr.UnitPath())
			c.PrintErrf("Command: %s %s\n", exe, strings.Join(spec.Args, " "))
			if st.tlsCfg == nil && waitHealthy(url, healthWait) {
				c.PrintErrf("gopolice service is running at %s\n", url)
			} else {
				c.PrintErrf("gopolice service starting at %s (check with: gopolice service status)\n", url)
			}
			c.PrintErrln(mgr.LogHint(spec))
			c.PrintErr("Uninstall with: gopolice service uninstall\n")
			return nil
		},
	}

	f.bind(cmd)
	cmd.Flags().StringVar(&execPath, "exec", "", "gopolice binary to run (default: this executable)")
	return cmd
}

func newServiceUninstallCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "uninstall",
		Short: "Stop the background service and remove it from login items",
		RunE: func(c *cobra.Command, args []string) error {
			mgr, err := newDaemon()
			if err != nil {
				return err
			}
			if err := mgr.Uninstall(); err != nil {
				return err
			}
			c.PrintErrf("Removed %s unit %s\n", mgr.Name(), mgr.UnitPath())
			c.PrintErr("Saved repositories and accounts in " + config.GlobalConfigDir() + " were kept.\n")
			return nil
		},
	}
}

func newServiceControlCommand(use, short string, action func(daemon.Manager) error) *cobra.Command {
	return &cobra.Command{
		Use:   use,
		Short: short,
		RunE: func(c *cobra.Command, args []string) error {
			mgr, err := newDaemon()
			if err != nil {
				return err
			}
			if err := action(mgr); err != nil {
				return err
			}
			return printStatus(c, mgr)
		},
	}
}

func newServiceStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show whether the background service is installed and running",
		RunE: func(c *cobra.Command, args []string) error {
			mgr, err := newDaemon()
			if err != nil {
				return err
			}
			return printStatus(c, mgr)
		},
	}
}

func printStatus(c *cobra.Command, mgr daemon.Manager) error {
	st, err := mgr.Status()
	if err != nil {
		return err
	}
	if !st.Installed {
		c.Printf("Not installed (unit would be %s). Run: gopolice service install\n", mgr.UnitPath())
		return nil
	}
	state := "stopped"
	if st.Running {
		state = "running"
		if st.PID > 0 {
			state = fmt.Sprintf("running (pid %d)", st.PID)
		}
	}
	if st.Detail != "" && !strings.HasPrefix(state, st.Detail) {
		state += ", " + st.Detail
	}
	c.Printf("%s: %s\n", mgr.Name(), state)
	c.Printf("Unit: %s\n", mgr.UnitPath())
	c.Println(mgr.LogHint(daemon.Spec{LogFile: serviceLogPath()}))
	return nil
}

// resolveExecutable picks the binary the unit will run. A path from `go run`
// vanishes with its build cache, so it is refused.
func resolveExecutable(override string) (string, error) {
	path := override
	if path == "" {
		exe, err := os.Executable()
		if err != nil {
			return "", fmt.Errorf("locate gopolice binary: %w", err)
		}
		path = exe
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	path = absPath(path)
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("gopolice binary: %w", err)
	}
	if info.IsDir() || info.Mode()&0o111 == 0 {
		return "", fmt.Errorf("%s is not an executable file", path)
	}
	if override == "" && isTemporary(path) {
		return "", errors.New("this binary lives in a temporary directory (go run?); install gopolice first (go install github.com/rapando/gopolice@latest) or pass --exec with a permanent path")
	}
	return path, nil
}

func isTemporary(path string) bool {
	tmp := os.TempDir()
	if resolved, err := filepath.EvalSymlinks(tmp); err == nil {
		tmp = resolved
	}
	return strings.HasPrefix(path, filepath.Clean(tmp)+string(filepath.Separator)) || strings.Contains(path, "/go-build")
}

// daemonEnv captures the parts of the current environment the scanners
// depend on; launchd and systemd otherwise start the service with a bare
// PATH that lacks go and the optional tools.
func daemonEnv() map[string]string {
	env := map[string]string{}
	for _, k := range []string{"PATH", "GOPATH", "GOROOT", "GOFLAGS", "GOPROXY", "GOPRIVATE", "GONOSUMDB", "GONOSUMCHECK", "GOTOOLCHAIN", "XDG_CONFIG_HOME"} {
		if v := os.Getenv(k); v != "" {
			env[k] = v
		}
	}
	return env
}

// waitHealthy polls the service's health endpoint until it answers or the
// deadline passes.
func waitHealthy(url string, timeout time.Duration) bool {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	client := &http.Client{Timeout: time.Second}
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/health", nil)
		if err != nil {
			return false
		}
		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return true
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(250 * time.Millisecond):
		}
	}
}
