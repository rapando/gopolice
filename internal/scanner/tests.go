package scanner

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type TestScanner struct{}

func NewTestScanner() *TestScanner {
	return &TestScanner{}
}

func (s *TestScanner) Name() string {
	return "tests"
}

var (
	testResultRe = regexp.MustCompile(`^(?:=== RUN|--- (?:PASS|FAIL|SKIP):)\s+(.+?)(?:\s+\((\d+\.\d+)s\))?$`)
	testPkgRe    = regexp.MustCompile(`^(ok|FAIL|\?)\s+(\S+)\s+(?:(\d+\.\d+)s)?(?:\s+coverage:\s+(\d+\.\d+)%)?`)
)

func (s *TestScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Running tests"}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	testResult := s.runTests(ctx, projectDir)
	coverageResult := s.runCoverage(ctx, projectDir)
	if coverageResult != nil {
		for i := range testResult.Packages {
			for _, cp := range coverageResult.Packages {
				if cp.Name == testResult.Packages[i].Name {
					testResult.Packages[i].Coverage = cp.Coverage
					break
				}
			}
		}
		if coverageResult.Total.Total > 0 {
			testResult.Total = coverageResult.Total
		}
	}

	issues := s.issuesFromTestResult(testResult)

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Ran %d tests, %d passed, %d failed", testResult.Total.Total, testResult.Total.Passed, testResult.Total.Failed), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Issues:      issues,
		Data:        testResult,
	}, nil
}

func (s *TestScanner) runTests(ctx context.Context, projectDir string) *model.TestResult {
	cmd := exec.CommandContext(ctx, "go", "test", "-v", "-count=1", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			return &model.TestResult{Packages: []model.TestPackage{}}
		}
	}

	return parseTestOutput(string(output))
}

func (s *TestScanner) runCoverage(ctx context.Context, projectDir string) *model.TestResult {
	cmd := exec.CommandContext(ctx, "go", "test", "-cover", "-count=1", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			return nil
		}
	}

	return parseCoverageOutput(string(output))
}

func parseTestOutput(output string) *model.TestResult {
	result := &model.TestResult{Packages: []model.TestPackage{}}
	var pendingTest *model.Test
	pkgMap := make(map[string]*model.TestPackage)
	unknownKey := "_unknown_"

	ensurePkg := func() {
		if _, ok := pkgMap[unknownKey]; !ok {
			pkgMap[unknownKey] = &model.TestPackage{Name: unknownKey, Status: "ok", Tests: []model.Test{}}
		}
	}

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()

		if matches := testResultRe.FindStringSubmatch(line); matches != nil {
			testName := matches[1]

			if strings.HasPrefix(line, "===") {
				pendingTest = &model.Test{Name: testName, Status: "RUN"}
				continue
			}

			status := "PASS"
			if strings.Contains(line, "FAIL") {
				status = "FAIL"
			} else if strings.Contains(line, "SKIP") {
				status = "SKIP"
			}

			test := &model.Test{
				Name:   testName,
				Status: status,
			}
			if pendingTest != nil && pendingTest.Output != "" {
				test.Output = pendingTest.Output
			}
			if len(matches) > 2 && matches[2] != "" {
				if d, err := strconv.ParseFloat(matches[2], 64); err == nil {
					test.Duration = time.Duration(d * float64(time.Second))
				}
			}

			ensurePkg()
			pkgMap[unknownKey].Tests = append(pkgMap[unknownKey].Tests, *test)
			pendingTest = nil
			continue
		}

		if matches := testPkgRe.FindStringSubmatch(line); matches != nil {
			status := matches[1]
			pkgName := matches[2]

			if unk, ok := pkgMap[unknownKey]; ok && len(unk.Tests) > 0 {
				unk.Name = pkgName
				delete(pkgMap, unknownKey)
				if _, exists := pkgMap[pkgName]; !exists {
					pkgMap[pkgName] = unk
				}
			}

			pkg, ok := pkgMap[pkgName]
			if !ok {
				pkg = &model.TestPackage{Name: pkgName, Tests: []model.Test{}}
				pkgMap[pkgName] = pkg
			}
			pkg.Status = status

			if len(matches) > 3 && matches[3] != "" {
				if d, err := strconv.ParseFloat(matches[3], 64); err == nil {
					pkg.Duration = time.Duration(d * float64(time.Second))
				}
			}
			if len(matches) > 4 && matches[4] != "" {
				if c, err := strconv.ParseFloat(matches[4], 64); err == nil {
					pkg.Coverage = c
				}
			}

			if status == "?" {
				result.Total.Skipped++
			}

			pendingTest = nil
			continue
		}

		if pendingTest != nil && strings.HasPrefix(line, "\t") {
			pendingTest.Output += strings.TrimSpace(line) + "\n"
		}
	}

	for _, pkg := range pkgMap {
		result.Packages = append(result.Packages, *pkg)
		for _, t := range pkg.Tests {
			result.Total.Total++
			switch t.Status {
			case "PASS":
				result.Total.Passed++
			case "FAIL":
				result.Total.Failed++
			case "SKIP":
				result.Total.Skipped++
			}
		}
	}

	return result
}

func parseCoverageOutput(output string) *model.TestResult {
	result := &model.TestResult{}
	scanner := bufio.NewScanner(strings.NewReader(output))

	for scanner.Scan() {
		line := scanner.Text()
		if matches := testPkgRe.FindStringSubmatch(line); matches != nil {
			pkgName := matches[2]
			var coverage float64
			if len(matches) > 4 && matches[4] != "" {
				if c, err := strconv.ParseFloat(matches[4], 64); err == nil {
					coverage = c
				}
			}
			result.Packages = append(result.Packages, model.TestPackage{
				Name:     pkgName,
				Coverage: coverage,
				Tests:    []model.Test{},
			})
			if coverage > 0 {
				result.Total.Total++
			}
		}
	}
	return result
}

func (s *TestScanner) issuesFromTestResult(tr *model.TestResult) []model.Issue {
	var issues []model.Issue
	if tr == nil {
		return issues
	}
	for _, pkg := range tr.Packages {
		for _, t := range pkg.Tests {
			if t.Status == "FAIL" {
				issues = append(issues, model.Issue{
					ID:       fmt.Sprintf("test-fail-%s-%s", pkg.Name, t.Name),
					Scanner:  "go test",
					Rule:     "test-failure",
					Severity: model.SeverityError,
					Message:  fmt.Sprintf("Test %s failed in package %s", t.Name, pkg.Name),
					Category: model.CategoryTest,
				})
			}
		}
	}
	return issues
}

