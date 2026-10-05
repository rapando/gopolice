package cmd

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rapando/gopolice/internal/api"

	"github.com/spf13/cobra"
)

var uiFS fs.FS

func NewRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:   "gopolice",
		Short: "A web UI reporting tool for Go projects",
		Long: `gopolice scans Go projects for code quality, security, logical issues,
performance profiling, tests and git blame, then opens an interactive web UI.`,
	}

	root.AddCommand(NewVersionCommand())
	root.AddCommand(NewConfigCommand())
	root.AddCommand(NewScanCommand())
	root.AddCommand(NewServeCommand())
	root.AddCommand(NewHistoryCommand())

	return root
}

func Execute(uifs fs.FS) {
	uiFS = uifs
	if err := NewRootCommand().Execute(); err != nil {
		os.Exit(1)
	}
}

// startServer binds the web UI (falling back to the next free port) and
// serves it in the background. It returns the port actually bound.
func startServer(c *cobra.Command, server *api.Server, port int) (int, error) {
	actualPort, err := server.Listen(port)
	if err != nil {
		return 0, fmt.Errorf("start web UI: %w", err)
	}
	go func() {
		if err := server.Serve(); err != nil {
			c.PrintErrf("Server error: %v\n", err)
		}
	}()
	c.PrintErrf("Web UI at http://localhost:%d\n", actualPort)
	return actualPort, nil
}

// signalContext returns a context canceled on SIGINT or SIGTERM.
func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

func shutdownServer(c *cobra.Command, server *api.Server) error {
	c.PrintErr("Shutting down...\n")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return server.Shutdown(ctx)
}
