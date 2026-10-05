package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/cache"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/exporter"
	"github.com/rapando/gopolice/internal/history"
	"github.com/rapando/gopolice/internal/model"
	"github.com/rapando/gopolice/internal/scanner"

	"github.com/spf13/cobra"
)

func NewScanCommand() *cobra.Command {
	var noOpen bool
	var outputFmt string

	cmd := &cobra.Command{
		Use:   "scan",
		Short: "Scan a Go project and open the web UI",
		Long: `Scans the current Go project for code quality, security, logical issues,
tests, git blames and more, then opens an interactive web UI report.

Use --output to write results in a machine-readable format to stdout:
  gopolice scan --output sarif     # SARIF format (static analysis results)
  gopolice scan --output json      # native JSON format`,
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			cfg.TargetDir = "."

			if outputFmt != "" {
				return runScanAndOutput(c, cfg, outputFmt)
			}
			return runScanAndServe(c, cfg, noOpen)
		},
	}

	cmd.Flags().BoolVarP(&noOpen, "no-open", "n", false, "Don't open browser automatically")
	cmd.Flags().StringVarP(&outputFmt, "output", "o", "", "Output format: sarif, json (writes to stdout, no server)")

	return cmd
}

func runScanAndOutput(c *cobra.Command, cfg *config.Config, outputFmt string) error {
	if outputFmt != "sarif" && outputFmt != "json" {
		return fmt.Errorf("unsupported output format: %s (supported: sarif, json)", outputFmt)
	}

	ctx, cancel := signalContext()
	defer cancel()

	result, err := runScanInternal(ctx, cfg, printProgress(c))
	if err != nil {
		return err
	}

	if outputFmt == "sarif" {
		return exporter.ExportSARIF(result, GetVersion(), os.Stdout)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(result)
}

// printProgress returns a channel whose events are printed to stderr.
func printProgress(c *cobra.Command) chan scanner.ProgressEvent {
	progress := make(chan scanner.ProgressEvent, 100)
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
	return progress
}

// runScanInternal scans the project and persists the result to the cache
// (read by `gopolice serve`) and to history.
func runScanInternal(ctx context.Context, cfg *config.Config, progress chan scanner.ProgressEvent) (*model.ScanResult, error) {
	result, err := scanner.RunWorkspaceScan(ctx, cfg, progress)
	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}
	if result == nil {
		p := scanner.NewDefaultPipeline()
		result, err = p.Run(ctx, cfg, progress)
		if err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}
	}
	if result == nil {
		return nil, fmt.Errorf("scan produced no result")
	}

	if err := cache.Save(result, cache.ResultPath(cfg.TargetDir)); err != nil {
		fmt.Fprintf(os.Stderr, "cache save: %v\n", err)
	}
	if err := history.Save(cfg.TargetDir, result); err != nil {
		fmt.Fprintf(os.Stderr, "history save: %v\n", err)
	}
	return result, nil
}

func runScanAndServe(c *cobra.Command, cfg *config.Config, noOpen bool) error {
	ctx, cancel := signalContext()
	defer cancel()

	c.PrintErr("gopolice scan starting...\n")

	server := api.NewServer(cfg, uiFS, GetVersion())
	port, err := startServer(c, server, cfg.Port)
	if err != nil {
		return err
	}
	if !noOpen {
		openBrowser(fmt.Sprintf("http://localhost:%d", port))
	}

	result, err := runScanInternal(ctx, cfg, printProgress(c))
	if err != nil {
		_ = shutdownServer(c, server)
		return err
	}
	c.PrintErrf("Scan complete: %d issues found in %v\n", len(result.Issues), result.Duration)
	server.SetResult(result)

	<-ctx.Done()
	return shutdownServer(c, server)
}

func openBrowser(url string) {
	if runtime.GOOS == "darwin" && hasTool("osascript") {
		if tryReloadTab(url) {
			return
		}
	}
	if hasTool("open") {
		_ = execSilent("open", url)
	} else if hasTool("xdg-open") {
		_ = execSilent("xdg-open", url)
	}
}

func tryReloadTab(url string) bool {
	chromeScript := fmt.Sprintf(`tell application "Google Chrome"
	set found to false
	repeat with w in windows
		set idx to 0
		repeat with t in tabs of w
			set idx to idx + 1
			if URL of t contains "localhost:%s" then
				set active tab index of w to idx
				set index of w to 1
				set URL of t to %q
				set found to true
				exit repeat
			end if
		end repeat
		if found then exit repeat
	end repeat
	if not found then open location %q
end tell`, portOfURL(url), url, url)
	if execSilent("osascript", "-e", chromeScript) == nil {
		return true
	}

	safariScript := fmt.Sprintf(`tell application "Safari"
	set found to false
	repeat with w in windows
		set idx to 0
		repeat with t in tabs of w
			set idx to idx + 1
			if URL of t contains "localhost:%s" then
				set current tab of w to t
				set index of w to 1
				set URL of t to %q
				set found to true
				exit repeat
			end if
		end repeat
		if found then exit repeat
	end repeat
	if not found then open location %q
end tell`, portOfURL(url), url, url)
	if execSilent("osascript", "-e", safariScript) == nil {
		return true
	}

	frontAppScript := fmt.Sprintf(`try
	tell application "System Events"
		set frontApp to bundle identifier of (first application process whose frontmost is true)
	end tell
	tell application id frontApp
		activate
		open location %q
	end tell
end try`, url)
	return execSilent("osascript", "-e", frontAppScript) == nil
}

func portOfURL(raw string) string {
	if i := strings.LastIndex(raw, ":"); i >= 0 {
		return raw[i+1:]
	}
	return strconv.Itoa(config.DefaultPort)
}

func execSilent(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}

func hasTool(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
