package cmd

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"path/filepath"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/auth"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/osauth"
	"github.com/rapando/gopolice/internal/projects"
	"github.com/spf13/cobra"
)

func NewServiceCommand() *cobra.Command {
	var (
		host         string
		port         int
		noOpen       bool
		tlsCert      string
		tlsKey       string
		allowedHosts []string
		authMode     string
	)

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

State is stored in ~/.config/gopolice (accounts, saved repositories).`,
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}
			if port > 0 {
				cfg.Port = port
			}

			exposed := host != "" && !isLoopbackBind(host)
			hosts := append([]string(nil), allowedHosts...)
			if exposed {
				if len(hosts) == 0 {
					if ip := net.ParseIP(host); host == "0.0.0.0" || host == "::" || (ip != nil && ip.IsUnspecified()) {
						return errors.New("--host is a wildcard address: pass --allowed-host with the name or IP clients will use to reach the service")
					}
					hosts = append(hosts, host)
				}
			}

			var tlsCfg *tls.Config
			if tlsCert != "" || tlsKey != "" {
				if tlsCert == "" || tlsKey == "" {
					return errors.New("--tls-cert and --tls-key must be given together")
				}
				cert, err := tls.LoadX509KeyPair(tlsCert, tlsKey)
				if err != nil {
					return fmt.Errorf("load TLS certificate: %w", err)
				}
				tlsCfg = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
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

			osMode, err := resolveAuthMode(authMode)
			if err != nil {
				return err
			}
			if osMode {
				name, err := osauth.CurrentUser()
				if err != nil {
					return fmt.Errorf("find current user: %w", err)
				}
				backend := &auth.OSBackend{VerifyPassword: osauth.VerifyPassword, Biometric: osauth.Biometric}
				authMgr.EnableOS(name, backend)
				c.PrintErrf("Sign in as macOS user %q (password or Touch ID)\n", name)
			}

			if exposed && authMgr.NeedsSetup() {
				authMgr.SetupToken = auth.RandomToken()
				c.PrintErrf("No account exists yet. Setup token (required to create it): %s\n", authMgr.SetupToken)
			}
			if exposed && tlsCfg == nil {
				c.PrintErr("WARNING: listening on the network without TLS; passwords are sent in clear text and passkeys will not work.\n")
			}

			ctx, cancel := signalContext()
			defer cancel()

			server := api.NewService(cfg, uiFS, GetVersion(), api.ServiceOptions{
				Auth:         authMgr,
				Registry:     registry,
				AllowedHosts: hosts,
				TLS:          tlsCfg,
			})
			bound, err := server.ListenHost(host, cfg.Port)
			if err != nil {
				return fmt.Errorf("start service: %w", err)
			}
			go func() {
				if err := server.Serve(); err != nil {
					c.PrintErrf("Server error: %v\n", err)
				}
			}()

			scheme := "http"
			if tlsCfg != nil {
				scheme = "https"
			}
			shown := "localhost"
			if exposed {
				shown = host
				if len(allowedHosts) > 0 {
					shown = allowedHosts[0]
				}
			}
			url := fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(shown, fmt.Sprint(bound)))
			c.PrintErrf("gopolice service at %s\n", url)
			if authMgr.NeedsSetup() {
				c.PrintErr("Open it to create your account.\n")
			}
			if !noOpen && !exposed {
				openBrowser(url)
			}

			<-ctx.Done()
			return shutdownServer(c, server)
		},
	}

	cmd.Flags().StringVar(&host, "host", "", "Address to listen on (default: loopback only)")
	cmd.Flags().IntVarP(&port, "port", "p", 0, "Port to listen on")
	cmd.Flags().BoolVarP(&noOpen, "no-open", "n", false, "Don't open the browser automatically")
	cmd.Flags().StringVar(&authMode, "auth", "", `Login method: "os" (macOS account password / Touch ID) or "local" (gopolice account + passkeys). Default: os on macOS, local elsewhere`)
	cmd.Flags().StringVar(&tlsCert, "tls-cert", "", "TLS certificate file (enables HTTPS)")
	cmd.Flags().StringVar(&tlsKey, "tls-key", "", "TLS private key file")
	cmd.Flags().StringSliceVar(&allowedHosts, "allowed-host", nil, "Host name or IP clients use to reach the service (repeatable)")
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
