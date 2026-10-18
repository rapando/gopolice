package scanner

import (
	"bufio"
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
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
	testResultRe = regexp.MustCompile(`^(?:\s*)(?:=== RUN|--- (?:PASS|FAIL|SKIP):)\s+(.+?)(?:\s+\((\d+\.\d+)s\))?$`)
	testCoverRe  = regexp.MustCompile(`^coverage: (\d+\.\d+)% of statements`)
	testPkgRe    = regexp.MustCompile(`^(ok|FAIL|\?)\s+(\S+)\s+(?:(\d+\.\d+)s)?(?:\s+coverage:\s+(\d+\.\d+)%)?`)
)

func (s *TestScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	t := newTracker(progress, s.Name())
	t.started("Running tests")

	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	inv := inventoryTests(projectDir)
	if inv.Tests > 0 {
		t.step(0, inv.Tests, "tests", fmt.Sprintf("Found %d tests in %d packages", inv.Tests, inv.Packages), "")
	}

	testResult := s.runTests(ctx, projectDir, t, inv)

	s.locateTestFileLocations(projectDir, testResult)
	issues := s.issuesFromTestResult(testResult)

	t.completedf("Ran %d tests, %d passed, %d failed", testResult.Total.Total, testResult.Total.Passed, testResult.Total.Failed)
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Issues:      issues,
		Data:        testResult,
	}, nil
}

var (
	testRunLineRe  = regexp.MustCompile(`^=== RUN\s+(\S+)`)
	testDoneLineRe = regexp.MustCompile(`^--- (PASS|FAIL|SKIP):\s+(\S+)`)
)

func (s *TestScanner) runTests(ctx context.Context, projectDir string, t *tracker, inv testInventory) *model.TestResult {
	// -cover adds "coverage: N%" to each package summary line, so results and
	// coverage come from a single run.
	cmd := exec.CommandContext(ctx, "go", "test", "-v", "-cover", "-count=1", "./...")
	cmd.Dir = projectDir

	// Top-level tests only (subtests contain a slash): their count is what
	// the inventory predicted, and -v prints their result as each finishes.
	done, failed := 0, 0
	total := inv.Tests
	output, err := streamOutput(cmd, func(line string) {
		if m := testRunLineRe.FindStringSubmatch(line); m != nil {
			if !strings.Contains(m[1], "/") {
				t.tick(done, total, "tests", m[1], false)
			}
			return
		}
		if m := testDoneLineRe.FindStringSubmatch(line); m != nil {
			if strings.Contains(m[2], "/") {
				return
			}
			done++
			if m[1] == "FAIL" {
				failed++
			}
			if done > total {
				total = done
			}
			detail := m[2]
			if failed > 0 {
				detail = fmt.Sprintf("%s (%d failed)", m[2], failed)
			}
			t.tick(done, total, "tests", detail, done == total)
			return
		}
		if m := testPkgRe.FindStringSubmatch(line); m != nil && m[1] == "FAIL" {
			// A package that failed to build or test: say so while the rest runs.
			t.tick(done, total, "tests", "FAIL "+m[2], true)
		}
	})
	if err != nil && len(output) == 0 {
		return &model.TestResult{Packages: []model.TestPackage{}}
	}

	return parseTestOutput(string(output))
}

func parseTestOutput(output string) *model.TestResult {
	result := &model.TestResult{Packages: []model.TestPackage{}}
	var pendingTest *model.Test
	// With -v, coverage is printed on its own line before the package summary;
	// failing packages omit it from the summary, so remember it here.
	var lastCoverage float64
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

		if matches := testCoverRe.FindStringSubmatch(line); matches != nil {
			if c, err := strconv.ParseFloat(matches[1], 64); err == nil {
				lastCoverage = c
			}
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
			pkg.Coverage = lastCoverage
			if len(matches) > 4 && matches[4] != "" {
				if c, err := strconv.ParseFloat(matches[4], 64); err == nil {
					pkg.Coverage = c
				}
			}
			lastCoverage = 0

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

var fileLineRe = regexp.MustCompile(`^(.+?\.go):(\d+):`)

func (s *TestScanner) locateTestFileLocations(projectDir string, result *model.TestResult) {
	modPath := ""
	if f, err := os.ReadFile(filepath.Join(projectDir, "go.mod")); err == nil {
		for _, line := range strings.Split(string(f), "\n") {
			if strings.HasPrefix(line, "module ") {
				modPath = strings.TrimSpace(strings.TrimPrefix(line, "module"))
				break
			}
		}
	}

	fset := token.NewFileSet()

	for pi := range result.Packages {
		pkg := &result.Packages[pi]
		pkgImportPath := pkg.Name
		relDir := pkgImportPath
		if modPath != "" && strings.HasPrefix(pkgImportPath, modPath) {
			relDir = strings.TrimPrefix(pkgImportPath, modPath+"/")
		}
		pkgDir := filepath.Join(projectDir, relDir)

		testFileLocations := make(map[string]struct {
			file string
			line int
		})

		entries, err := os.ReadDir(pkgDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			f, err := parser.ParseFile(fset, filepath.Join(pkgDir, entry.Name()), nil, parser.ParseComments)
			if err != nil {
				continue
			}
			for _, decl := range f.Decls {
				fd, ok := decl.(*ast.FuncDecl)
				if !ok || fd.Recv != nil {
					continue
				}
				if !strings.HasPrefix(fd.Name.Name, "Test") {
					continue
				}
				pos := fset.Position(fd.Pos())
				relPath, _ := filepath.Rel(projectDir, pos.Filename)
				testFileLocations[fd.Name.Name] = struct {
					file string
					line int
				}{relPath, pos.Line}
			}
		}

		for ti := range pkg.Tests {
			t := &pkg.Tests[ti]
			if t.File != "" {
				continue
			}
			if t.Output != "" {
				if m := fileLineRe.FindStringSubmatch(t.Output); m != nil {
					relPath, _ := filepath.Rel(projectDir, m[1])
					t.File = relPath
					t.Line, _ = strconv.Atoi(m[2])
					continue
				}
			}
			if loc, ok := testFileLocations[t.Name]; ok {
				t.File = loc.file
				t.Line = loc.line
			}
		}
	}
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
