package cmd

import (
	"fmt"
	"os"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/cache"
	"github.com/rapando/gopolice/internal/config"
	"github.com/spf13/cobra"
)

func NewServeCommand() *cobra.Command {
	var port int

	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Re-serve a previous scan result",
		Long:  "Serves a previously cached scan result from .gopolice/cache/result.json as a web UI.",
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			projectDir := cfg.Project.Path
			if projectDir == "" {
				projectDir = "."
			}

			cachePath := cache.ResultPath(projectDir)
			if _, err := os.Stat(cachePath); os.IsNotExist(err) {
				return fmt.Errorf("no cached result found at %s (run 'gopolice scan' first)", cachePath)
			}

			cachedResult, err := cache.Load(cachePath)
			if err != nil {
				return fmt.Errorf("load cache: %w", err)
			}

			server := api.NewServerWithResult(cfg, uiFS, cachedResult, GetVersion())
			if port > 0 {
				cfg.UI.Port = port
			}
			uiPort := cfg.UI.Port
			if uiPort == 0 {
				uiPort = 9393
			}

			fmt.Fprintf(os.Stderr, "Serving cached result from %s\n", cachePath)
			fmt.Fprintf(os.Stderr, "Web UI at http://localhost:%d\n", uiPort)
			return server.Start(uiPort)
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 0, "Port for the web UI")
	return cmd
}
