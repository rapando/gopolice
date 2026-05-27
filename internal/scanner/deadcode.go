package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type DeadCodeScanner struct{}

func NewDeadCodeScanner() *DeadCodeScanner {
	return &DeadCodeScanner{}
}

func (s *DeadCodeScanner) Name() string {
	return "deadcode"
}

type staticcheckIssue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Location struct {
		File   string `json:"file"`
		Line   int    `json:"line"`
		Column int    `json:"column"`
	} `json:"location"`
	Message string `json:"message"`
}

var unusedLineRe = regexp.MustCompile(`^(.+?):(\d+):(\d+):\s*(.+)$`)

func (s *DeadCodeScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Checking for dead code"}

	var allIssues []model.Issue

	if hasTool("staticcheck") {
		issues, err := s.runStaticcheck(ctx, projectDir)
		if err != nil {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: fmt.Sprintf("staticcheck: %v", err)}
		} else {
			allIssues = append(allIssues, issues...)
		}
	} else {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: "staticcheck not found, trying unused"}

		if hasTool("unused") {
			issues, err := s.runUnused(ctx, projectDir)
			if err != nil {
				progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: fmt.Sprintf("unused: %v", err)}
			} else {
				allIssues = append(allIssues, issues...)
			}
		} else {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: "unused not found, skipping dead code detection"}
		}
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d dead code issues", len(allIssues)), Elapsed: time.Since(start)}
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues}, nil
}

func (s *DeadCodeScanner) runStaticcheck(ctx context.Context, projectDir string) ([]model.Issue, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "staticcheck", "-checks", "U1000", "-f", "json", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			return nil, nil
		}
	}

	var staticcheckIssues []staticcheckIssue
	// staticcheck v2026+ outputs newline-delimited JSON objects (JSON lines),
	// older versions output a JSON array. Try JSON array first, then fall back
	// to line-by-line parsing.
	if err := json.Unmarshal(output, &staticcheckIssues); err != nil {
		lines := strings.Split(strings.TrimSpace(string(output)), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var si staticcheckIssue
			if err := json.Unmarshal([]byte(line), &si); err != nil {
				continue
			}
			staticcheckIssues = append(staticcheckIssues, si)
		}
		if len(staticcheckIssues) == 0 {
			return nil, fmt.Errorf("parse staticcheck output: %w", err)
		}
	}

	var issues []model.Issue
	for _, si := range staticcheckIssues {
		var sev model.Severity
		switch si.Severity {
		case "error":
			sev = model.SeverityError
		case "warning":
			sev = model.SeverityWarning
		default:
			sev = model.SeverityInfo
		}

		issues = append(issues, model.Issue{
			ID:       fmt.Sprintf("deadcode-%s-%s-%d", si.Code, si.Location.File, si.Location.Line),
			Scanner:  "deadcode",
			Rule:     si.Code,
			Severity: sev,
			File:     si.Location.File,
			Line:     si.Location.Line,
			Column:   si.Location.Column,
			Message:  si.Message,
			Category: model.CategoryDeadCode,
		})
	}

	return issues, nil
}

func (s *DeadCodeScanner) runUnused(ctx context.Context, projectDir string) ([]model.Issue, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "unused", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			return nil, nil
		}
	}

	var issues []model.Issue
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		matches := unusedLineRe.FindStringSubmatch(line)
		if matches == nil {
			continue
		}
		lineNum, _ := strconv.Atoi(matches[2])
		colNum, _ := strconv.Atoi(matches[3])

		issues = append(issues, model.Issue{
			ID:       fmt.Sprintf("deadcode-unused-%s-%d", matches[1], lineNum),
			Scanner:  "deadcode",
			Rule:     "U1000",
			Severity: model.SeverityWarning,
			File:     matches[1],
			Line:     lineNum,
			Column:   colNum,
			Message:  matches[4],
			Category: model.CategoryDeadCode,
		})
	}

	return issues, nil
}
