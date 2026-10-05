package cmd

import (
	"fmt"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/history"
	"github.com/spf13/cobra"
)

func NewHistoryCommand() *cobra.Command {
	var port int

	cmd := &cobra.Command{
		Use:   "history",
		Short: "Open the scan history UI",
		Long:  "Shows past scan results with issue tracking across runs.",
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			cfg.TargetDir = "."

			if _, err := history.List(cfg.TargetDir); err != nil {
				return fmt.Errorf("list history: %w", err)
			}

			if port > 0 {
				cfg.Port = port
			}

			ctx, cancel := signalContext()
			defer cancel()

			server := api.NewServer(cfg, uiFS, GetVersion())
			actualPort, err := startServer(c, server, cfg.Port)
			if err != nil {
				return err
			}
			openBrowser(fmt.Sprintf("http://localhost:%d", actualPort))

			<-ctx.Done()
			return shutdownServer(c, server)
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 0, "Port for the web UI")
	return cmd
}
