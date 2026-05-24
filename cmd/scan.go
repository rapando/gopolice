package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"

	"github.com/rapando/gopolice/internal/api"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/history"
	"github.com/rapando/gopolice/internal/scanner"
	"github.com/spf13/cobra"
)

func NewScanCommand() *cobra.Command {
	var noOpen bool

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

			cfg.TargetDir = "."

			return runScanAndServe(c, cfg, noOpen)
		},
	}

	cmd.Flags().BoolVarP(&noOpen, "no-open", "n", false, "Don't open browser automatically")

	return cmd
}

func runScanAndServe(c *cobra.Command, cfg *config.Config, noOpen bool) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

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
		result, err := scanner.RunWorkspaceScan(ctx, cfg, progress)
		if err != nil {
			c.PrintErr(fmt.Sprintf("Scan failed: %v\n", err))
			close(resultCh)
			return
		}
		if result == nil {
			p := scanner.NewDefaultPipeline()
			result, err = p.Run(ctx, cfg, progress)
			if err != nil {
				c.PrintErr(fmt.Sprintf("Scan failed: %v\n", err))
				close(resultCh)
				return
			}
		}
		c.PrintErr(fmt.Sprintf("Scan complete: %d issues found in %v\n", len(result.Issues), result.Duration))

		if err := history.Save(cfg.TargetDir, result); err != nil {
			c.PrintErr(fmt.Sprintf("history save: %v\n", err))
		}

		server := api.NewServer(cfg, uiFS, GetVersion())
		uiPort := cfg.Port
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

func openBrowser(url string) {
	if runtime.GOOS == "darwin" && hasTool("osascript") {
		if tryReloadTab(url) {
			return
		}
	}
	if hasTool("open") {
		execSilent("open", url)
	} else if hasTool("xdg-open") {
		execSilent("xdg-open", url)
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
	return "9393"
}

func execSilent(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}

func hasTool(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
