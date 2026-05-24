package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/cache"
	"github.com/rapando/gopolice/internal/config"
	"github.com/spf13/cobra"
)

func NewServeCommand() *cobra.Command {
	var port int
	var watch bool

	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Re-serve a previous scan result",
		Long:  "Serves a previously cached scan result from .gopolice/cache/result.json as a web UI.",
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			cfg.TargetDir = "."

			cachePath := cache.ResultPath(cfg.TargetDir)
			if _, err := os.Stat(cachePath); os.IsNotExist(err) {
				return fmt.Errorf("no cached result found at %s (run 'gopolice scan' first)", cachePath)
			}

			cachedResult, err := cache.Load(cachePath)
			if err != nil {
				return fmt.Errorf("load cache: %w", err)
			}

			server := api.NewServerWithResult(cfg, uiFS, cachedResult, GetVersion())
			if port > 0 {
				cfg.Port = port
			}
			uiPort := cfg.Port
			if uiPort == 0 {
				uiPort = 9393
			}

			fmt.Fprintf(os.Stderr, "Serving cached result from %s\n", cachePath)
			fmt.Fprintf(os.Stderr, "Web UI at http://localhost:%d\n", uiPort)

			if watch {
				w, err := server.Watch(500 * time.Millisecond)
				if err != nil {
					return fmt.Errorf("file watcher: %w", err)
				}
				defer w.Stop()
				fmt.Fprintf(os.Stderr, "Watching .go files for changes (--watch enabled)\n")
			}

			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

			go func() {
				<-sigCh
				shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer shutdownCancel()
				server.Shutdown(shutdownCtx)
			}()

			return server.Start(uiPort)
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 0, "Port for the web UI")
	cmd.Flags().BoolVarP(&watch, "watch", "w", false, "Watch .go files and re-scan on change")
	return cmd
}
