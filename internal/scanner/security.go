package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sort"
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
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	t := newTracker(progress, s.Name())
	t.started("Running security checks")
	var allIssues []model.Issue
	gosec := model.ToolStatus{Scanner: s.Name(), Tool: "gosec", Status: model.ToolMissing, Install: "go install github.com/securego/gosec/v2/cmd/gosec@latest"}
	govuln := model.ToolStatus{Scanner: s.Name(), Tool: "govulncheck", Status: model.ToolMissing, Install: "go install golang.org/x/vuln/cmd/govulncheck@latest"}

	if hasTool("gosec") {
		t.step(1, 2, "tools", "Running gosec (static analysis)", "gosec ./...")
		issues, err := s.runGosec(ctx, projectDir)
		if err != nil {
			gosec.Status, gosec.Error = model.ToolFailed, err.Error()
			t.running(fmt.Sprintf("gosec: %v", err))
		} else {
			gosec.Status, gosec.Findings = model.ToolRan, len(issues)
			allIssues = append(allIssues, issues...)
			t.running(fmt.Sprintf("gosec found %d issues", len(issues)))
		}
	} else {
		t.running("gosec not found, skipping")
	}

	if hasTool("govulncheck") {
		t.step(2, 2, "tools", "Running govulncheck (known vulnerabilities)", "govulncheck ./...")
		issues, err := s.runGovulncheck(ctx, projectDir)
		if err != nil {
			govuln.Status, govuln.Error = model.ToolFailed, err.Error()
			t.running(fmt.Sprintf("govulncheck: %v", err))
		} else {
			govuln.Status, govuln.Findings = model.ToolRan, len(issues)
			allIssues = append(allIssues, issues...)
			t.running(fmt.Sprintf("govulncheck found %d vulnerabilities", len(issues)))
		}
	} else {
		t.running("govulncheck not found, skipping")
	}

	t.completedf("Found %d security issues", len(allIssues))
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues, Data: []model.ToolStatus{gosec, govuln}}, nil
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

// govulncheckMessage is one top-level object in the govulncheck v1 JSON
// stream. Exactly one field is set per object; other keys (config, progress,
// SBOM, ...) are ignored.
type govulncheckMessage struct {
	OSV     *govulncheckOSV     `json:"osv"`
	Finding *govulncheckFinding `json:"finding"`
}

type govulncheckOSV struct {
	ID      string `json:"id"`
	Summary string `json:"summary"`
}

type govulncheckFinding struct {
	OSV          string             `json:"osv"`
	FixedVersion string             `json:"fixed_version"`
	Trace        []govulncheckFrame `json:"trace"`
}

type govulncheckFrame struct {
	Module   string               `json:"module"`
	Version  string               `json:"version"`
	Package  string               `json:"package"`
	Function string               `json:"function"`
	Receiver string               `json:"receiver"`
	Position *govulncheckPosition `json:"position"`
}

type govulncheckPosition struct {
	Filename string `json:"filename"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

// isSymbolLevel reports whether the finding reaches a vulnerable symbol, as
// opposed to only requiring the vulnerable module.
func (f *govulncheckFinding) isSymbolLevel() bool {
	for _, fr := range f.Trace {
		if fr.Function != "" {
			return true
		}
	}
	return false
}

// parseGovulncheckOutput decodes the govulncheck v1 JSON stream and returns
// one issue per OSV id that has at least one symbol-level finding.
func parseGovulncheckOutput(data []byte) ([]model.Issue, error) {
	summaries := map[string]string{}
	firstFinding := map[string]*govulncheckFinding{}

	dec := json.NewDecoder(bytes.NewReader(data))
	for {
		var msg govulncheckMessage
		if err := dec.Decode(&msg); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("parse govulncheck output: %w", err)
		}
		if msg.OSV != nil && msg.OSV.ID != "" {
			summaries[msg.OSV.ID] = msg.OSV.Summary
		}
		if f := msg.Finding; f != nil && f.OSV != "" && len(f.Trace) > 0 && f.isSymbolLevel() {
			if _, seen := firstFinding[f.OSV]; !seen {
				firstFinding[f.OSV] = f
			}
		}
	}

	ids := make([]string, 0, len(firstFinding))
	for id := range firstFinding {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	issues := make([]model.Issue, 0, len(ids))
	for _, id := range ids {
		f := firstFinding[id]
		module := f.Trace[0].Module

		file, line, col := module, 0, 0
		if pos := f.Trace[len(f.Trace)-1].Position; pos != nil && pos.Filename != "" {
			file, line, col = pos.Filename, pos.Line, pos.Column
		}

		msg, ok := summaries[id]
		if !ok || msg == "" {
			msg = fmt.Sprintf("%s in %s", id, module)
		}

		issues = append(issues, model.Issue{
			ID:       fmt.Sprintf("govulncheck-%s", id),
			Scanner:  "govulncheck",
			Rule:     id,
			Severity: model.SeverityError,
			Message:  msg,
			File:     file,
			Line:     line,
			Column:   col,
			Category: model.CategorySecurity,
			Solution: govulncheckSolution(id, module, f.FixedVersion),
		})
	}
	return issues, nil
}

func govulncheckSolution(id, module, fixed string) string {
	ref := fmt.Sprintf("See https://pkg.go.dev/vuln/%s.", id)
	if fixed == "" {
		return "No fixed version yet. " + ref
	}
	target := module
	if module == "stdlib" {
		target = "Go"
	}
	return fmt.Sprintf("Update %s to %s or later. %s", target, fixed, ref)
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
