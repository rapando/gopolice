package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type SecurityScanner struct{}

func NewSecurityScanner() *SecurityScanner {
	return &SecurityScanner{}
}

func (s *SecurityScanner) Name() string {
	return "security"
}

type gosecOutput struct {
	Issues []gosecIssue `json:"Issues"`
}

type gosecIssue struct {
	Severity   string `json:"severity"`
	Confidence string `json:"confidence"`
	RuleID     string `json:"rule_id"`
	Details    string `json:"details"`
	File       string `json:"file"`
	Line       string `json:"line"`
	Code       string `json:"code"`
}

func (s *SecurityScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Running security checks"}
	var allIssues []model.Issue

	if hasTool("gosec") {
		issues, err := s.runGosec(ctx, projectDir)
		if err != nil {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: fmt.Sprintf("gosec: %v", err)}
		} else {
			allIssues = append(allIssues, issues...)
		}
	} else {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: "gosec not found, skipping"}
	}

	if hasTool("govulncheck") {
		issues, err := s.runGovulncheck(ctx, projectDir)
		if err != nil {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: fmt.Sprintf("govulncheck: %v", err)}
		} else {
			allIssues = append(allIssues, issues...)
		}
	} else {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusRunning, Message: "govulncheck not found, skipping"}
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d security issues", len(allIssues)), Elapsed: time.Since(start)}
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues}, nil
}

func (s *SecurityScanner) runGosec(ctx context.Context, projectDir string) ([]model.Issue, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "gosec", "-fmt=json", "./...")
	cmd.Dir = projectDir
	output, err := cmd.Output()
	if err != nil {
		if len(output) == 0 {
			return nil, fmt.Errorf("gosec execution failed: %w", err)
		}
	}

	var parsed gosecOutput
	if err := json.Unmarshal(output, &parsed); err != nil {
		return nil, fmt.Errorf("parse gosec output: %w", err)
	}

	var issues []model.Issue
	for _, gi := range parsed.Issues {
		line := parseInt(gi.Line)
		sol := gosecSolution(gi.RuleID)
		if sol == "" {
			sol = gi.Details
		}
		issues = append(issues, model.Issue{
			ID:       fmt.Sprintf("gosec-%s-%s-%d", gi.RuleID, gi.File, line),
			Scanner:  "gosec",
			Rule:     gi.RuleID,
			Severity: mapGosecSeverity(gi.Severity),
			File:     gi.File,
			Line:     line,
			Message:  gi.Details,
			Category: model.CategorySecurity,
			Solution: sol,
		})
	}
	return issues, nil
}

func (s *SecurityScanner) runGovulncheck(ctx context.Context, projectDir string) ([]model.Issue, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "govulncheck", "-json", "./...")
	cmd.Dir = projectDir
	output, err := cmd.Output()
	if err != nil {
		if len(output) == 0 {
			return nil, fmt.Errorf("govulncheck execution failed: %w", err)
		}
	}

	return parseGovulncheckOutput(output)
}

type govulncheckOutput struct {
	Vulns []govulncheckVuln `json:"vulns"`
}

type govulncheckVuln struct {
	OSVs    []govulncheckOSV `json:"osvs"`
	Modules []govulncheckMod `json:"modules"`
	Title   string           `json:"title"`
}

type govulncheckOSV struct {
	ID string `json:"id"`
}

type govulncheckMod struct {
	Path string `json:"path"`
}

func parseGovulncheckOutput(data []byte) ([]model.Issue, error) {
	var parsed govulncheckOutput
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("parse govulncheck output: %w", err)
	}

	var issues []model.Issue
	for _, v := range parsed.Vulns {
		vulnID := ""
		if len(v.OSVs) > 0 {
			vulnID = v.OSVs[0].ID
		}
		modPath := ""
		if len(v.Modules) > 0 {
			modPath = v.Modules[0].Path
		}

		issues = append(issues, model.Issue{
			ID:       fmt.Sprintf("govulncheck-%s", vulnID),
			Scanner:  "govulncheck",
			Rule:     vulnID,
			Severity: model.SeverityError,
			Message:  v.Title,
			File:     modPath,
			Category: model.CategorySecurity,
			Solution: fmt.Sprintf("Update the affected module to a patched version. Run `go get -u %s` and check %s for details.", modPath, vulnID),
		})
	}
	return issues, nil
}

func gosecSolution(ruleID string) string {
	switch ruleID {
	case "G101":
		return "Remove hardcoded credentials from source code. Use environment variables, a secrets manager, or a config file excluded from version control."
	case "G102":
		return "Bind to all network interfaces only when necessary. Use `127.0.0.1` to restrict to localhost when possible."
	case "G103":
		return "Avoid using `unsafe` package unless absolutely necessary. Review if there is a safer alternative."
	case "G104":
		return "Always check returned errors. Ignoring errors can mask bugs and lead to unexpected behavior."
	case "G106":
		return "Audit the use of `ssh.InsecureIgnoreHostKey()` — this disables host key verification and enables MITM attacks."
	case "G107":
		return "Ensure HTTP request URLs are not constructed from user input without proper sanitization to prevent SSRF attacks."
	case "G108":
		return "Remove or restrict the pprof HTTP endpoint in production builds. It exposes profiling data."
	case "G109":
		return "Validate integer values before using them in memory allocations to prevent integer overflow."
	case "G110":
		return "Limit the size of files read from user-supplied paths to prevent resource exhaustion (zip bomb)."
	case "G111":
		return "Validate path arguments to avoid directory traversal attacks."
	case "G112":
		return "Set proper read/write timeouts on HTTP servers to prevent slow-loris attacks."
	case "G201", "G202":
		return "Use parameterized queries (prepared statements) instead of string concatenation for SQL queries to prevent SQL injection."
	case "G203":
		return "Use `html/template` instead of `text/template` for HTML output, or manually escape user data to prevent XSS."
	case "G204":
		return "Avoid executing arbitrary commands constructed from user input. Use safer alternatives when possible."
	case "G301", "G302", "G303", "G304":
		return "Set restrictive file permissions (0600 for files, 0700 for directories) when creating files with sensitive data."
	case "G305":
		return "Validate archive paths before extracting files to prevent zip slip (directory traversal via archive)."
	case "G306":
		return "Use `os.OpenFile` with proper permissions instead of `ioutil.WriteFile` which defaults to 0644."
	case "G307":
		return "Ensure deferred file/directory cleanup is handled properly to avoid resource leaks."
	case "G401", "G402", "G403":
		return "Use a secure hash function (SHA-256 or higher). MD5 and SHA-1 are cryptographically broken."
	case "G501", "G502", "G503", "G504", "G505":
		return "Replace weak TLS settings. Use modern TLS 1.2+ with secure cipher suites."
	case "G601":
		return "Avoid using `rand.Read` for secrets. Use `crypto/rand` instead."
	default:
		return ""
	}
}

func mapGosecSeverity(s string) model.Severity {
	switch strings.ToUpper(s) {
	case "HIGH":
		return model.SeverityError
	case "MEDIUM":
		return model.SeverityWarning
	default:
		return model.SeverityInfo
	}
}
