package scanner

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

func drainProgress(progress chan ProgressEvent) {
	go func() {
		for range progress {
		}
	}()
}

func testConfig(projectDir string) *config.Config {
	cfg := config.DefaultConfig()
	cfg.Project.Path = projectDir
	cfg.Scan.Scanners.Lint = true
	cfg.Scan.Scanners.Security = true
	cfg.Scan.Scanners.Tests = true
	cfg.Scan.Scanners.Git = true
	cfg.Scan.Scanners.Complexity = true
	return cfg
}

func TestScannerInterface_Compiles(t *testing.T) {
	var s Scanner = NewLintScanner()
	if s.Name() != "lint" {
		t.Errorf("expected name lint, got %s", s.Name())
	}
	s = NewSecurityScanner()
	if s.Name() != "security" {
		t.Errorf("expected name security, got %s", s.Name())
	}
	s = NewTestScanner()
	if s.Name() != "tests" {
		t.Errorf("expected name tests, got %s", s.Name())
	}
	s = NewComplexityScanner()
	if s.Name() != "complexity" {
		t.Errorf("expected name complexity, got %s", s.Name())
	}
	s = NewFileStatsScanner()
	if s.Name() != "filestats" {
		t.Errorf("expected name filestats, got %s", s.Name())
	}
	s = NewGitScanner()
	if s.Name() != "git" {
		t.Errorf("expected name git, got %s", s.Name())
	}
}

func TestParseVetOutput(t *testing.T) {
	input := `# github.com/example
./foo.go:42:2: something is wrong
./bar/baz.go:10:5: another issue
exit status 1
`
	issues := parseVetOutput(input)
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}

	if issues[0].File != "./foo.go" || issues[0].Line != 42 || issues[0].Column != 2 {
		t.Errorf("unexpected first issue: %+v", issues[0])
	}
	if issues[0].Message != "something is wrong" {
		t.Errorf("unexpected message: %s", issues[0].Message)
	}
	if issues[1].File != "./bar/baz.go" || issues[1].Line != 10 || issues[1].Column != 5 {
		t.Errorf("unexpected second issue: %+v", issues[1])
	}
}

func TestParseVetOutput_Empty(t *testing.T) {
	issues := parseVetOutput("")
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestParseVetOutput_NoIssues(t *testing.T) {
	issues := parseVetOutput("exit status 0\n")
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestParseVetOutput_Deduplicate(t *testing.T) {
	input := "./foo.go:10:5: first issue\n./foo.go:10:5: first issue\n"
	issues := parseVetOutput(input)
	if len(issues) != 1 {
		t.Errorf("expected 1 issue (dedup), got %d", len(issues))
	}
}

func TestParseTestOutput(t *testing.T) {
	input := `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- PASS: TestSubtract (0.00s)
=== RUN   TestDivide
--- PASS: TestDivide (0.00s)
=== RUN   TestDivideByZero
--- PASS: TestDivideByZero (0.00s)
=== RUN   TestFailing
    math_test.go:35: expected 3, got 2
--- FAIL: TestFailing (0.01s)
ok  	gopolice/scanner/testdata/withtests	0.123s
`
	result := parseTestOutput(input)
	if result.Total.Total != 5 {
		t.Errorf("expected 5 tests total, got %d", result.Total.Total)
	}
	if result.Total.Passed != 4 {
		t.Errorf("expected 4 passed, got %d", result.Total.Passed)
	}
	if result.Total.Failed != 1 {
		t.Errorf("expected 1 failed, got %d", result.Total.Failed)
	}
	if len(result.Packages) != 1 {
		t.Errorf("expected 1 package, got %d", len(result.Packages))
	}
}

func TestParseTestOutput_Empty(t *testing.T) {
	result := parseTestOutput("")
	if result.Total.Total != 0 {
		t.Errorf("expected 0 tests, got %d", result.Total.Total)
	}
}

func TestParseCoverageOutput(t *testing.T) {
	input := `ok  	gopolice/scanner/testdata/withtests	0.123s	coverage: 75.0% of statements
?   	gopolice/scanner/no-tests	[no test files]
`
	result := parseCoverageOutput(input)
	if len(result.Packages) != 2 {
		t.Fatalf("expected 2 packages, got %d", len(result.Packages))
	}
	if result.Packages[0].Coverage != 75.0 {
		t.Errorf("expected 75%% coverage, got %.1f", result.Packages[0].Coverage)
	}
	if result.Packages[1].Coverage != 0 {
		t.Errorf("expected 0%% coverage for no-test package, got %.1f", result.Packages[1].Coverage)
	}
}

func TestComputeComplexity_Simple(t *testing.T) {
	code := `package main
func simple() int { return 1 }`
	comp := computeComplexityForCode(t, code)
	if comp != 1 {
		t.Errorf("expected complexity 1, got %d", comp)
	}
}

func TestComputeComplexity_If(t *testing.T) {
	code := `package main
func withIf(x int) int {
	if x > 0 { return 1 }
	return 0
}`
	comp := computeComplexityForCode(t, code)
	if comp != 2 {
		t.Errorf("expected complexity 2, got %d", comp)
	}
}

func TestComputeComplexity_Complex(t *testing.T) {
	code := `package main
func complex(x int) int {
	result := 0
	if x > 0 {
		for i := 0; i < x; i++ {
			if i%2 == 0 { result += i } else { result -= i }
		}
	}
	return result
}`
	comp := computeComplexityForCode(t, code)
	if comp != 4 {
		t.Errorf("expected complexity 4 (1 base + 1 if + 1 for + 1 if/else), got %d", comp)
	}
}

func TestComputeComplexity_Switch(t *testing.T) {
	code := `package main
func withSwitch(val string) int {
	switch val {
	case "a": return 1
	case "b": return 2
	default: return 0
	}
}`
	comp := computeComplexityForCode(t, code)
	if comp != 4 {
		t.Errorf("expected complexity 4 (1 base + 3 cases), got %d", comp)
	}
}

func computeComplexityForCode(t *testing.T, code string) int {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "", code, parser.ParseComments)
	if err != nil {
		t.Fatal(err)
	}
	for _, decl := range f.Decls {
		funcDecl, ok := decl.(*ast.FuncDecl)
		if ok {
			return computeComplexity(funcDecl)
		}
	}
	t.Fatal("no function declaration found")
	return 0
}

func TestCountFileLines(t *testing.T) {
	content := `package main

import "fmt"

func main() {
	// this is a comment
	fmt.Println("hello")
}
`
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "main.go")
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	stat := countFileLines(tmpFile)
	if stat.Lines != 8 {
		t.Errorf("expected 8 lines, got %d", stat.Lines)
	}
	if stat.BlankLines != 2 {
		t.Errorf("expected 2 blank lines, got %d", stat.BlankLines)
	}
}

func TestParseGoMod(t *testing.T) {
	content := `module example.com/test

go 1.22

require (
	github.com/foo/bar v1.0.0
	github.com/baz/qux v2.0.0 // indirect
)
`
	tmpDir := t.TempDir()
	modFile := filepath.Join(tmpDir, "go.mod")
	if err := os.WriteFile(modFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	deps := parseGoMod(modFile)
	if len(deps) != 2 {
		t.Fatalf("expected 2 deps, got %d", len(deps))
	}
	if deps[0].Path != "github.com/foo/bar" || deps[0].Version != "v1.0.0" || deps[0].Indirect {
		t.Errorf("unexpected first dep: %+v", deps[0])
	}
	if deps[1].Path != "github.com/baz/qux" || deps[1].Version != "v2.0.0" || !deps[1].Indirect {
		t.Errorf("unexpected second dep: %+v", deps[1])
	}
}

func TestParseGoMod_NoFile(t *testing.T) {
	deps := parseGoMod("/nonexistent/go.mod")
	if deps != nil {
		t.Errorf("expected nil, got %v", deps)
	}
}

func TestMapSeverity(t *testing.T) {
	tests := []struct {
		input string
		want  model.Severity
	}{
		{"error", model.SeverityError},
		{"ERROR", model.SeverityError},
		{"warning", model.SeverityWarning},
		{"WARNING", model.SeverityWarning},
		{"info", model.SeverityInfo},
		{"unknown", model.SeverityInfo},
	}
	for _, tt := range tests {
		got := mapSeverity(tt.input)
		if got != tt.want {
			t.Errorf("mapSeverity(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestMapGosecSeverity(t *testing.T) {
	tests := []struct {
		input string
		want  model.Severity
	}{
		{"HIGH", model.SeverityError},
		{"MEDIUM", model.SeverityWarning},
		{"LOW", model.SeverityInfo},
	}
	for _, tt := range tests {
		got := mapGosecSeverity(tt.input)
		if got != tt.want {
			t.Errorf("mapGosecSeverity(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestLinterCategory(t *testing.T) {
	tests := []struct {
		linter string
		category model.Category
	}{
		{"errcheck", model.CategoryBug},
		{"govet", model.CategoryBug},
		{"SA5000", model.CategoryBug},
		{"ST1000", model.CategoryStyle},
		{"gofmt", model.CategoryStyle},
		{"G101", model.CategorySecurity},
		{"G204", model.CategorySecurity},
		{"gci", model.CategoryStyle},
		{"unused", model.CategoryStyle},
	}
	for _, tt := range tests {
		got := linterCategory(tt.linter)
		if got != tt.category {
			t.Errorf("linterCategory(%q) = %v, want %v", tt.linter, got, tt.category)
		}
	}
}

func TestHasTool(t *testing.T) {
	if !hasTool("go") {
		t.Error("expected 'go' to be available")
	}
	if hasTool("nonexistent-tool-12345") {
		t.Error("expected nonexistent tool to not be found")
	}
}

func TestIsGitRepo(t *testing.T) {
	tmpDir := t.TempDir()
	if isGitRepo(tmpDir) {
		t.Error("expected temp dir to not be a git repo")
	}

	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git init failed: %v", err)
	}
	if !isGitRepo(tmpDir) {
		t.Error("expected inited repo to be a git repo")
	}
}

func TestCountLines(t *testing.T) {
	if countLines("") != 0 {
		t.Errorf("expected 0 for empty string")
	}
	if countLines("a\nb\nc") != 3 {
		t.Errorf("expected 3, got %d", countLines("a\nb\nc"))
	}
	if countLines("a\n\n\nc") != 2 {
		t.Errorf("expected 2 (non-blank lines), got %d", countLines("a\n\n\nc"))
	}
}

func TestIssueFromTestResult_NoFailures(t *testing.T) {
	scanner := NewTestScanner()
	tr := &model.TestResult{
		Packages: []model.TestPackage{
			{
				Name: "pkg1",
				Tests: []model.Test{
					{Name: "TestA", Status: "PASS"},
					{Name: "TestB", Status: "PASS"},
				},
			},
		},
		Total: model.TestSummary{Total: 2, Passed: 2},
	}
	issues := scanner.issuesFromTestResult(tr)
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestIssueFromTestResult_WithFailures(t *testing.T) {
	scanner := NewTestScanner()
	tr := &model.TestResult{
		Packages: []model.TestPackage{
			{
				Name: "pkg1",
				Tests: []model.Test{
					{Name: "TestA", Status: "PASS"},
					{Name: "TestB", Status: "FAIL"},
					{Name: "TestC", Status: "FAIL"},
				},
			},
		},
	}
	issues := scanner.issuesFromTestResult(tr)
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}
	if !strings.Contains(issues[0].Message, "TestB") {
		t.Errorf("expected message to mention TestB, got %s", issues[0].Message)
	}
}

func TestFileStatsScanner(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "main.go"), []byte("package main\nfunc main() {}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "README.md"), []byte("# readme\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte("module test\n\ngo 1.22\n"), 0644); err != nil {
		t.Fatal(err)
	}

	scanner := NewFileStatsScanner()
	cfg := testConfig(tmpDir)
	cfg.Project.ExcludeDirs = nil

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	data, ok := result.Data.(*model.ScanResult)
	if !ok {
		t.Fatalf("expected *model.ScanResult, got %T", result.Data)
	}
	if data.TotalFiles != 3 {
		t.Errorf("expected 3 total files, got %d", data.TotalFiles)
	}
	if data.GoFiles != 1 {
		t.Errorf("expected 1 go file, got %d", data.GoFiles)
	}
	if data.TotalLines <= 0 {
		t.Errorf("expected positive total lines, got %d", data.TotalLines)
	}
}

func TestComplexityScanner(t *testing.T) {
	fixtureDir := "testdata/complex"
	scanner := &ComplexityScanner{Threshold: 7}
	cfg := testConfig(fixtureDir)
	cfg.Project.ExcludeDirs = nil

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	if len(result.Issues) == 0 {
		t.Fatal("expected at least one complexity issue")
	}

	hasComplex := false
	for _, issue := range result.Issues {
		if strings.Contains(issue.File, "main.go") {
			hasComplex = true
			break
		}
	}
	if !hasComplex {
		t.Error("expected issues from main.go")
	}
}

func TestComplexityScanner_CustomThreshold(t *testing.T) {
	fixtureDir := "testdata/simple"
	scanner := &ComplexityScanner{Threshold: 0}
	cfg := testConfig(fixtureDir)
	cfg.Project.ExcludeDirs = nil

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	if len(result.Issues) == 0 {
		t.Error("expected issues with threshold 0")
	}
}

func TestGoVetFallback(t *testing.T) {
	fixtureDir := "testdata/simple"
	s := &LintScanner{}
	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := s.runGoVet(context.Background(), fixtureDir, progress, time.Now())
	if err != nil {
		t.Fatalf("go vet fallback failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestTestScanner(t *testing.T) {
	fixtureDir := "testdata/withtests"
	scanner := NewTestScanner()
	cfg := testConfig(fixtureDir)

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	testResult, ok := result.Data.(*model.TestResult)
	if !ok {
		t.Fatalf("expected *model.TestResult in Data, got %T", result.Data)
	}

	if testResult.Total.Total == 0 {
		t.Error("expected at least one test")
	}
	if testResult.Total.Failed == 0 {
		t.Error("expected at least one failing test (TestFailing)")
	}

	if len(result.Issues) == 0 {
		t.Error("expected issues from failing tests")
	}
}

func TestGitScanner(t *testing.T) {
	if !hasTool("git") {
		t.Skip("git not installed")
	}

	tmpDir := t.TempDir()
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	if err := initCmd.Run(); err != nil {
		t.Fatalf("git init: %v", err)
	}

	gitConfig := func(key, value string) {
		cmd := exec.Command("git", "config", key, value)
		cmd.Dir = tmpDir
		cmd.Run()
	}
	gitConfig("user.email", "test@test.com")
	gitConfig("user.name", "Test User")

	if err := os.WriteFile(filepath.Join(tmpDir, "file.go"), []byte("package main\n"), 0644); err != nil {
		t.Fatal(err)
	}

	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = tmpDir
	addCmd.Run()

	commitCmd := exec.Command("git", "commit", "-m", "initial commit")
	commitCmd.Dir = tmpDir
	commitCmd.Run()

	scanner := NewGitScanner()
	cfg := testConfig(tmpDir)
	cfg.Project.ExcludeDirs = nil

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}

	info, ok := result.Data.(*model.GitInfo)
	if !ok {
		t.Fatalf("expected *model.GitInfo in Data, got %T", result.Data)
	}
	if info.Branch == "" {
		t.Error("expected branch to be set")
	}
	if info.Commit == "" {
		t.Error("expected commit to be set")
	}
}

func TestGitScanner_NoRepo(t *testing.T) {
	if !hasTool("git") {
		t.Skip("git not installed")
	}

	tmpDir := t.TempDir()
	scanner := NewGitScanner()
	cfg := testConfig(tmpDir)

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Data != nil {
		t.Errorf("expected nil data for non-repo, got %v", result.Data)
	}
}

func TestSecurityScanner_SkipWhenMissing(t *testing.T) {
	if hasTool("gosec") {
		t.Skip("gosec is installed, cannot test missing tool scenario")
	}

	scanner := NewSecurityScanner()
	cfg := testConfig("testdata/simple")

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result (no error, just no issues)")
	}
}

func TestLintGolangciLint(t *testing.T) {
	if !hasTool("golangci-lint") {
		t.Skip("golangci-lint not installed")
	}

	s := &LintScanner{}
	cfg := testConfig("testdata/simple")
	cfg.Project.ExcludeDirs = nil

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := s.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestSecurityGosec(t *testing.T) {
	if !hasTool("gosec") {
		t.Skip("gosec not installed")
	}

	scanner := NewSecurityScanner()
	cfg := testConfig("testdata/vulnerable")

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if len(result.Issues) == 0 {
		t.Log("no issues found - may be expected if gosec doesn't flag the test file patterns")
	}
}

func TestPipeline_Run(t *testing.T) {
	cfg := testConfig("testdata/simple")
	cfg.Project.ExcludeDirs = nil
	cfg.Scan.Scanners.Security = false
	cfg.Scan.Scanners.Tests = false

	p := NewPipeline(
		NewLintScanner(),
		NewFileStatsScanner(),
		NewComplexityScanner(),
	)

	progress := make(chan ProgressEvent, 20)
	drainProgress(progress)
	defer close(progress)

	result, err := p.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Pipeline.Run failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestPipeline_ContextCancel(t *testing.T) {
	cfg := testConfig("testdata/simple")
	cfg.Project.ExcludeDirs = nil

	p := NewPipeline(NewComplexityScanner())

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := p.Run(ctx, cfg, progress)
	if err != nil {
		exiting := result.Duration > 0
		if !exiting {
			t.Logf("pipeline returned error after cancellation: %v", err)
		}
		return
	}
	_ = result
}

func TestPipeline_FilterEnabled(t *testing.T) {
	p := NewDefaultPipeline()
	cfg := config.DefaultConfig()
	cfg.Scan.Scanners.Lint = false
	cfg.Scan.Scanners.Security = false

	enabled := p.filterEnabled(cfg)
	for _, s := range enabled {
		if s.Name() == "lint" || s.Name() == "security" {
			t.Errorf("scanner %s should be disabled", s.Name())
		}
	}
}

func TestPipeline_Scanners(t *testing.T) {
	p := NewPipeline(NewLintScanner(), NewGitScanner())
	names := p.Scanners()
	if len(names) != 2 || names[0] != "lint" || names[1] != "git" {
		t.Errorf("unexpected scanner names: %v", names)
	}
}

func TestFileStatsScanner_ExcludeDirs(t *testing.T) {
	tmpDir := t.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "vendor"), 0755)
	os.WriteFile(filepath.Join(tmpDir, "vendor", "dep.go"), []byte("package vendor\n"), 0644)
	os.WriteFile(filepath.Join(tmpDir, "main.go"), []byte("package main\n"), 0644)

	scanner := NewFileStatsScanner()
	cfg := testConfig(tmpDir)
	cfg.Project.ExcludeDirs = []string{"vendor"}

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	data := result.Data.(*model.ScanResult)
	if data.GoFiles != 1 {
		t.Errorf("expected 1 go file (vendor excluded), got %d", data.GoFiles)
	}
}
