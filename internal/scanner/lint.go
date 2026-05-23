package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type LintScanner struct{}

func NewLintScanner() *LintScanner {
	return &LintScanner{}
}

func (s *LintScanner) Name() string {
	return "lint"
}

type golangciLintOutput struct {
	Issues []golangciIssue `json:"Issues"`
}

type golangciIssue struct {
	FromLinter string `json:"FromLinter"`
	Text       string `json:"Text"`
	Severity   string `json:"Severity"`
	Pos        struct {
		Filename string `json:"Filename"`
		Line     int    `json:"Line"`
		Column   int    `json:"Column"`
	} `json:"Pos"`
}

var vetLineRe = regexp.MustCompile(`^(?:#\s+\S+\s+)?(.+?):(\d+):(\d+):\s*(.+)$`)

func (s *LintScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Running lint checks"}

	if hasTool("golangci-lint") {
		return s.runGolangciLint(ctx, projectDir, progress)
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: "golangci-lint not found, falling back to go vet"}
	return s.runGoVet(ctx, projectDir, progress, start)
}

func (s *LintScanner) runGolangciLint(ctx context.Context, projectDir string, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "golangci-lint", "run", "--out-format=json", "--issues-exit-code=0", "./...")
	cmd.Dir = projectDir
	output, err := cmd.Output()
	if err != nil {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusFailed, Message: fmt.Sprintf("golangci-lint failed: %v", err), Error: err}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: nil, Error: err}, nil
	}

	var parsed golangciLintOutput
	if err := json.Unmarshal(output, &parsed); err != nil {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusFailed, Message: fmt.Sprintf("failed to parse golangci-lint output: %v", err), Error: err}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: nil, Error: err}, nil
	}

	issues := make([]model.Issue, 0, len(parsed.Issues))
	for _, gi := range parsed.Issues {
		sol := linterSolution(gi.FromLinter, gi.Text)
		if sol == "" {
			sol = gi.Text
		}
		issues = append(issues, model.Issue{
			ID:       fmt.Sprintf("gl-%s-%s-%d", gi.FromLinter, gi.Pos.Filename, gi.Pos.Line),
			Scanner:  "golangci-lint",
			Rule:     gi.FromLinter,
			Severity: mapSeverity(gi.Severity),
			File:     gi.Pos.Filename,
			Line:     gi.Pos.Line,
			Column:   gi.Pos.Column,
			Message:  gi.Text,
			Category: linterCategory(gi.FromLinter),
			Solution: sol,
		})
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d issues", len(issues)), Elapsed: time.Since(start)}
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: issues}, nil
}

func (s *LintScanner) runGoVet(ctx context.Context, projectDir string, progress chan<- ProgressEvent, start time.Time) (*Result, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "go", "vet", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusFailed, Message: fmt.Sprintf("go vet failed: %v", err), Error: err}
			return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: nil, Error: err}, nil
		}
	}

	issues := parseVetOutput(string(output))
	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d issues (go vet)", len(issues)), Elapsed: time.Since(start)}
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: issues}, nil
}

func parseVetOutput(output string) []model.Issue {
	var issues []model.Issue
	seen := make(map[string]bool)

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "exit status") {
			continue
		}
		matches := vetLineRe.FindStringSubmatch(line)
		if matches == nil {
			continue
		}

		file := matches[1]
		lineNum := parseInt(matches[2])
		col := parseInt(matches[3])
		msg := matches[4]

		id := fmt.Sprintf("govet-%s-%d", file, lineNum)
		if seen[id] {
			continue
		}
		seen[id] = true

		issues = append(issues, model.Issue{
			ID:       id,
			Scanner:  "go vet",
			Rule:     "vet",
			Severity: model.SeverityWarning,
			File:     file,
			Line:     lineNum,
			Column:   col,
			Message:  msg,
			Category: model.CategoryBug,
			Solution: msg,
		})
	}
	return issues
}

func linterCategory(linter string) model.Category {
	switch {
	case linter == "errcheck" || linter == "govet":
		return model.CategoryBug
	case strings.HasPrefix(linter, "SA"):
		return model.CategoryBug
	case strings.HasPrefix(linter, "ST") || linter == "gofmt" || linter == "gofumpt" || linter == "gci":
		return model.CategoryStyle
	case strings.HasPrefix(linter, "G") && linter != "GCI":
		return model.CategorySecurity
	default:
		return model.CategoryStyle
	}
}

func mapSeverity(s string) model.Severity {
	switch strings.ToLower(s) {
	case "error":
		return model.SeverityError
	case "warning":
		return model.SeverityWarning
	default:
		return model.SeverityInfo
	}
}

func linterSolution(linter, text string) string {
	switch linter {
	case "gofmt", "gofumpt", "gci":
		return "This issue can be auto-fixed. Run the fix command or use the Apply Fix button to format the code automatically."
	case "errcheck":
		return "Handle the returned error explicitly. Use `_ = fn()` to ignore it, or better, check and handle the error appropriately."
	case "govet":
		return "Review the vet warning and adjust the code accordingly. Run `go vet ./...` locally to see all warnings."
	case "ineffassign":
		return "Remove the unused assignment or use the variable. Ineffective assignments increase code noise and may indicate bugs."
	case "staticcheck":
		return "Review the staticcheck finding. See https://staticcheck.io/docs/checks for detailed explanations."
	default:
		if strings.HasPrefix(linter, "SA") {
			return fmt.Sprintf("See https://staticcheck.io/docs/checks#%s for details about this issue.", strings.ToLower(linter))
		}
		if strings.HasPrefix(linter, "ST") {
			return "This is a style issue. Consider refactoring to follow Go best practices for readability and maintainability."
		}
		return ""
	}
}

func parseInt(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

func hasTool(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

