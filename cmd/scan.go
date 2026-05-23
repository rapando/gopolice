package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/scanner"
	"github.com/spf13/cobra"
)

func NewScanCommand() *cobra.Command {
	var quick bool
	var profile bool
	var bench bool
	var noOpen bool
	var outputFormat string

	cmd := &cobra.Command{
		Use:   "scan",
		Short: "Scan a Go project and open the web UI",
		Long: `Scans the current Go project for code quality, security, logical issues,
tests, git blames and more, then opens an interactive web UI report.`,
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			if quick {
				cfg.Scan.Quick = true
			}
			if profile {
				cfg.Scan.Profile = true
			}
			if bench {
				cfg.Scan.Bench = true
			}

			projectDir := cfg.Project.Path
			if projectDir == "" {
				projectDir = "."
			}

			if outputFormat != "" {
				return runScanAndExport(cfg, projectDir, outputFormat)
			}

			return runScanAndServe(c, cfg, projectDir, noOpen)
		},
	}

	cmd.Flags().BoolVarP(&quick, "quick", "q", false, "Skip expensive scans (profile, complexity)")
	cmd.Flags().BoolVar(&profile, "profile", false, "Run CPU/memory profiling")
	cmd.Flags().BoolVar(&bench, "bench", false, "Run benchmarks")
	cmd.Flags().BoolVarP(&noOpen, "no-open", "n", false, "Don't open browser automatically")
	cmd.Flags().StringVarP(&outputFormat, "output", "o", "", "Export format (json) — skip UI")

	return cmd
}

func runScanAndServe(c *cobra.Command, cfg *config.Config, projectDir string, noOpen bool) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	p := scanner.NewDefaultPipeline()
	progress := make(chan scanner.ProgressEvent, 100)

	c.PrintErr("gopolice scan starting...\n")

	go func() {
		for event := range progress {
			msg := fmt.Sprintf("[%s] %s", event.Scanner, event.Message)
			if event.Status == scanner.StatusFailed {
				c.PrintErr("ERROR: ", msg, "\n")
			} else {
				c.PrintErr(msg, "\n")
			}
		}
	}()

	resultCh := make(chan struct{})
	go func() {
		result, err := p.Run(ctx, cfg, progress)
		if err != nil {
			c.PrintErr(fmt.Sprintf("Scan failed: %v\n", err))
			close(resultCh)
			return
		}
		c.PrintErr(fmt.Sprintf("Scan complete: %d issues found in %v\n", len(result.Issues), result.Duration))

		server := api.NewServer(cfg, uiFS)
		uiPort := cfg.UI.Port
		if uiPort == 0 {
			uiPort = 9393
		}

		if !noOpen {
			openBrowser(fmt.Sprintf("http://localhost:%d", uiPort))
		}

		go func() {
			c.PrintErr(fmt.Sprintf("Web UI at http://localhost:%d\n", uiPort))
			if err := server.Start(uiPort); err != nil {
				c.PrintErr(fmt.Sprintf("Server error: %v\n", err))
			}
		}()

		<-sigCh
		c.PrintErr("Shutting down...\n")
		cancel()
		close(resultCh)
	}()

	<-resultCh
	return nil
}

func runScanAndExport(cfg *config.Config, projectDir, format string) error {
	ctx := context.Background()
	p := scanner.NewDefaultPipeline()
	progress := make(chan scanner.ProgressEvent, 100)

	go func() {
		for range progress {
		}
	}()

	result, err := p.Run(ctx, cfg, progress)
	if err != nil {
		return fmt.Errorf("scan failed: %w", err)
	}

	switch format {
	case "json":
		data, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
	default:
		return fmt.Errorf("unsupported export format: %s", format)
	}
	return nil
}

func openBrowser(url string) {
	switch {
	case hasTool("open"):
		execSilent("open", url)
	case hasTool("xdg-open"):
		execSilent("xdg-open", url)
	}
}

func execSilent(name string, args ...string) {
	cmd := exec.Command(name, args...)
	cmd.Run()
}

func hasTool(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
