package cmd

import (
	"fmt"
	"os"
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
			if port > 0 {
				cfg.Port = port
			}

			cachePath := cache.ResultPath(cfg.TargetDir)
			if _, err := os.Stat(cachePath); os.IsNotExist(err) {
				return fmt.Errorf("no cached result found at %s (run 'gopolice scan' first)", cachePath)
			}

			cachedResult, err := cache.Load(cachePath)
			if err != nil {
				return fmt.Errorf("load cache: %w", err)
			}

			ctx, cancel := signalContext()
			defer cancel()

			server := api.NewServerWithResult(cfg, uiFS, cachedResult, GetVersion())
			c.PrintErrf("Serving cached result from %s\n", cachePath)
			if _, err := startServer(c, server, cfg.Port); err != nil {
				return err
			}

			if watch {
				w, err := server.Watch(500 * time.Millisecond)
				if err != nil {
					_ = shutdownServer(c, server)
					return fmt.Errorf("file watcher: %w", err)
				}
				defer func() { _ = w.Stop() }()
				c.PrintErr("Watching .go files for changes (--watch enabled)\n")
			}

			<-ctx.Done()
			return shutdownServer(c, server)
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 0, "Port for the web UI")
	cmd.Flags().BoolVarP(&watch, "watch", "w", false, "Watch .go files and re-scan on change")
	return cmd
}
