package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

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

			server := api.NewServer(cfg, uiFS, GetVersion())
			if port > 0 {
				cfg.Port = port
			}
			uiPort := cfg.Port
			if uiPort == 0 {
				uiPort = 9393
			}

			actualPort, err := server.Start(uiPort)
			if err != nil {
				return err
			}
			openBrowser(fmt.Sprintf("http://localhost:%d", actualPort))
			fmt.Fprintf(os.Stderr, "Web UI at http://localhost:%d\n", actualPort)
			// block until signal
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			<-sigCh
			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer shutdownCancel()
			return server.Shutdown(shutdownCtx)
		},
	}

	cmd.Flags().IntVarP(&port, "port", "p", 0, "Port for the web UI")
	return cmd
}
