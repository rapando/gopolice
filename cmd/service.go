package cmd

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strconv"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/auth"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/daemon"
	"github.com/rapando/gopolice/internal/osauth"
	"github.com/rapando/gopolice/internal/projects"
	"github.com/spf13/cobra"
)

// serviceFlags are the options shared by `gopolice service` and
// `gopolice service install`, which bakes them into the background unit.
type serviceFlags struct {
	host         string
	port         int
	noOpen       bool
	tlsCert      string
	tlsKey       string
	allowedHosts []string
	authMode     string
}

func (f *serviceFlags) bind(cmd *cobra.Command) {
	cmd.Flags().StringVar(&f.host, "host", "", "Address to listen on (default: loopback only)")
	cmd.Flags().IntVarP(&f.port, "port", "p", 0, "Port to listen on")
	cmd.Flags().StringVar(&f.authMode, "auth", "", `Login method: "os" (macOS account password / Touch ID) or "local" (gopolice account + passkeys). Default: os on macOS, local elsewhere`)
	cmd.Flags().StringVar(&f.tlsCert, "tls-cert", "", "TLS certificate file (enables HTTPS)")
	cmd.Flags().StringVar(&f.tlsKey, "tls-key", "", "TLS private key file")
	cmd.Flags().StringSliceVar(&f.allowedHosts, "allowed-host", nil, "Host name or IP clients use to reach the service (repeatable)")
}

// serviceSettings is what the flags resolve to once validated.
type serviceSettings struct {
	exposed bool
	hosts   []string
	tlsCfg  *tls.Config
	osMode  bool
}

// resolve validates the flags and loads the TLS pair, so that both the
// foreground command and the installer reject bad options up front.
func (f *serviceFlags) resolve() (serviceSettings, error) {
	var st serviceSettings
	st.exposed = f.host != "" && !isLoopbackBind(f.host)
	st.hosts = append([]string(nil), f.allowedHosts...)
	if st.exposed && len(st.hosts) == 0 {
		if ip := net.ParseIP(f.host); f.host == "0.0.0.0" || f.host == "::" || (ip != nil && ip.IsUnspecified()) {
			return st, errors.New("--host is a wildcard address: pass --allowed-host with the name or IP clients will use to reach the service")
		}
		st.hosts = append(st.hosts, f.host)
	}

	if f.tlsCert != "" || f.tlsKey != "" {
		if f.tlsCert == "" || f.tlsKey == "" {
			return st, errors.New("--tls-cert and --tls-key must be given together")
		}
		cert, err := tls.LoadX509KeyPair(f.tlsCert, f.tlsKey)
		if err != nil {
			return st, fmt.Errorf("load TLS certificate: %w", err)
		}
		st.tlsCfg = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	}

	osMode, err := resolveAuthMode(f.authMode)
	if err != nil {
		return st, err
	}
	st.osMode = osMode
	return st, nil
}

// args reproduces the flags as a command line for the background unit.
// Relative file paths are made absolute, since the service will not start
// in this directory.
func (f *serviceFlags) args() []string {
	args := []string{"service", "--no-open"}
	if f.host != "" {
		args = append(args, "--host", f.host)
	}
	if f.port > 0 {
		args = append(args, "--port", strconv.Itoa(f.port))
	}
	if f.authMode != "" {
		args = append(args, "--auth", f.authMode)
	}
	if f.tlsCert != "" {
		args = append(args, "--tls-cert", absPath(f.tlsCert))
	}
	if f.tlsKey != "" {
		args = append(args, "--tls-key", absPath(f.tlsKey))
	}
	for _, h := range f.allowedHosts {
		args = append(args, "--allowed-host", h)
	}
	return args
}

func absPath(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}

// serviceURL is the address to show the user for the given settings.
func (f *serviceFlags) serviceURL(st serviceSettings, port int) string {
	scheme := "http"
	if st.tlsCfg != nil {
		scheme = "https"
	}
	shown := "localhost"
	if st.exposed {
		shown = f.host
		if len(f.allowedHosts) > 0 {
			shown = f.allowedHosts[0]
		}
	}
	return fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(shown, strconv.Itoa(port)))
}

func NewServiceCommand() *cobra.Command {
	var f serviceFlags

	cmd := &cobra.Command{
		Use:   "service",
		Short: "Run gopolice as a long-lived service for many repositories",
		Long: `Runs the gopolice web UI as a service that is not tied to one repository.

On macOS you sign in with your macOS account: its password, or Touch ID
(offered when you browse from the Mac itself). Elsewhere, or with
--auth local, gopolice keeps its own account and supports passkeys. From the UI you can open any Go repository on this
machine, which is remembered across restarts, and start scans in it.

The first time it runs, open the UI to create your account. By default the
service only listens on loopback. To expose it on a network, pass --host and
--allowed-host, and use --tls-cert/--tls-key (passkeys require HTTPS on any
host other than localhost).

State is stored in ~/.config/gopolice (accounts, saved repositories).

This command runs in the foreground. To have the operating system start it
at login and keep it running, use "gopolice service install".`,
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			if f.port > 0 {
				cfg.Port = f.port
			}

			st, err := f.resolve()
			if err != nil {
				return err
			}

			dir := config.GlobalConfigDir()
			authMgr, err := auth.NewManager(filepath.Join(dir, "auth.json"))
			if err != nil {
				return err
			}
			registry, err := projects.Open(filepath.Join(dir, "projects.json"))
			if err != nil {
				return fmt.Errorf("load saved repositories: %w", err)
			}

			if st.osMode {
				name, err := osauth.CurrentUser()
				if err != nil {
					return fmt.Errorf("find current user: %w", err)
				}
				backend := &auth.OSBackend{VerifyPassword: osauth.VerifyPassword, Biometric: osauth.Biometric}
				authMgr.EnableOS(name, backend)
				c.PrintErrf("Sign in as macOS user %q (password or Touch ID)\n", name)
			}

			if st.exposed && authMgr.NeedsSetup() {
				authMgr.SetupToken = auth.RandomToken()
				c.PrintErrf("No account exists yet. Setup token (required to create it): %s\n", authMgr.SetupToken)
			}
			if st.exposed && st.tlsCfg == nil {
				c.PrintErr("WARNING: listening on the network without TLS; passwords are sent in clear text and passkeys will not work.\n")
			}

			ctx, cancel := signalContext()
			defer cancel()

			server := api.NewService(cfg, uiFS, GetVersion(), api.ServiceOptions{
				Auth:         authMgr,
				Registry:     registry,
				AllowedHosts: st.hosts,
				TLS:          st.tlsCfg,
			})
			bound, err := server.ListenHost(f.host, cfg.Port)
			if err != nil {
				return fmt.Errorf("start service: %w", err)
			}
			go func() {
				if err := server.Serve(); err != nil {
					c.PrintErrf("Server error: %v\n", err)
				}
			}()

			url := f.serviceURL(st, bound)
			c.PrintErrf("gopolice service at %s\n", url)
			if authMgr.NeedsSetup() {
				c.PrintErr("Open it to create your account.\n")
			}
			if !f.noOpen && !st.exposed {
				openBrowser(url)
			}

			<-ctx.Done()
			return shutdownServer(c, server)
		},
	}

	f.bind(cmd)
	cmd.Flags().BoolVarP(&f.noOpen, "no-open", "n", false, "Don't open the browser automatically")

	cmd.AddCommand(
		newServiceInstallCommand(),
		newServiceUninstallCommand(),
		newServiceControlCommand("start", "Start the installed background service", daemon.Manager.Start),
		newServiceControlCommand("stop", "Stop the background service (it starts again at next login)", daemon.Manager.Stop),
		newServiceControlCommand("restart", "Restart the background service", daemon.Manager.Restart),
		newServiceStatusCommand(),
	)
	return cmd
}

// resolveAuthMode turns the --auth flag into "use OS authentication?".
func resolveAuthMode(mode string) (bool, error) {
	switch mode {
	case "":
		return osauth.Supported(), nil
	case "os":
		if !osauth.Supported() {
			return false, osauth.ErrUnsupported
		}
		return true, nil
	case "local":
		return false, nil
	}
	return false, fmt.Errorf("unknown --auth %q (use os or local)", mode)
}

func isLoopbackBind(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
