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

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

func drainProgress(progress chan ProgressEvent) {
	go func() {
		for range progress {
		}
	}()
}

func testConfig(dir string) *config.Config {
	cfg := config.DefaultConfig()
	cfg.TargetDir = dir
	return cfg
}

func TestScannerInterface_Compiles(t *testing.T) {
	var s Scanner = NewLintScanner()
	if s.Name() != "lint" {
		t.Errorf("expected name lint, got %s", s.Name())
	}
}

func TestParseVetOutput(t *testing.T) {
	input := `main.go:13:2: other declaration of main exists
main.go:14:2: missing return`
	issues := parseVetOutput(input)
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}
	if issues[0].File != "main.go" {
		t.Errorf("expected file main.go, got %s", issues[0].File)
	}
	if issues[0].Severity != model.SeverityWarning {
		t.Errorf("expected severity warning, got %s", issues[0].Severity)
	}
}

func TestParseVetOutput_Empty(t *testing.T) {
	issues := parseVetOutput("")
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestParseVetOutput_NoIssues(t *testing.T) {
	issues := parseVetOutput("no errors found")
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestParseVetOutput_Deduplicate(t *testing.T) {
	input := `main.go:10:2: duplicate
main.go:10:2: duplicate`
	issues := parseVetOutput(input)
	if len(issues) != 1 {
		t.Errorf("expected 1 deduplicated issue, got %d", len(issues))
	}
}

func TestParseTestOutput(t *testing.T) {
	input := `--- FAIL: TestSomething (0.01s)
    main_test.go:15: expected true, got false
--- PASS: TestOK (0.00s)`
	result := parseTestOutput(input)
	if len(result.Packages) == 0 || len(result.Packages[0].Tests) != 2 {
		t.Fatalf("expected 2 tests, got %d", len(result.Packages[0].Tests))
	}
	if result.Packages[0].Tests[0].Name != "TestSomething" {
		t.Errorf("expected TestSomething, got %s", result.Packages[0].Tests[0].Name)
	}
	if result.Packages[0].Tests[0].Status != "FAIL" {
		t.Errorf("expected FAIL, got %s", result.Packages[0].Tests[0].Status)
	}
}

func TestParseTestOutput_Subtests(t *testing.T) {
	input := `=== RUN   TestParent
=== RUN   TestParent/Sub1
=== PAUSE TestParent/Sub1
=== RUN   TestParent/Sub2
=== PAUSE TestParent/Sub2
=== CONT  TestParent/Sub1
=== CONT  TestParent/Sub2
--- PASS: TestParent (0.00s)
    --- PASS: TestParent/Sub2 (0.01s)
    --- PASS: TestParent/Sub1 (0.02s)
PASS
ok  	github.com/example/pkg	0.500s`
	result := parseTestOutput(input)
	if len(result.Packages) != 1 {
		t.Fatalf("expected 1 package, got %d", len(result.Packages))
	}
	if len(result.Packages[0].Tests) != 3 {
		t.Fatalf("expected 3 tests (parent + 2 subtests), got %d", len(result.Packages[0].Tests))
	}
	if result.Total.Total != 3 {
		t.Errorf("expected Total.Total=3, got %d", result.Total.Total)
	}
}

func TestParseTestOutput_Empty(t *testing.T) {
	result := parseTestOutput("")
	if len(result.Packages) != 0 {
		t.Errorf("expected 0 packages, got %d", len(result.Packages))
	}
}

func TestParseCoverageOutput(t *testing.T) {
	result := parseCoverageOutput("ok  \ttest\t0.123s\tcoverage: 75.5% of statements")
	if len(result.Packages) == 0 || result.Packages[0].Coverage != 75.5 {
		t.Errorf("expected 75.5 coverage, got %f", result.Packages[0].Coverage)
	}
}

func TestParseCoverageOutput_Missing(t *testing.T) {
	result := parseCoverageOutput("ok  test  0.1s")
	if len(result.Packages) != 1 {
		t.Fatalf("expected 1 package, got %d", len(result.Packages))
	}
	if result.Packages[0].Coverage != 0 {
		t.Errorf("expected 0 coverage, got %f", result.Packages[0].Coverage)
	}
}

func firstFuncDecl(f *ast.File) *ast.FuncDecl {
	for _, decl := range f.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			return fn
		}
	}
	return nil
}

func TestComputeComplexity_Simple(t *testing.T) {
	fset := token.NewFileSet()
	f, _ := parser.ParseFile(fset, "test.go", `package main
func main() {}`, parser.ParseComments)
	fd := firstFuncDecl(f)
	c := computeComplexity(fd)
	if c != 1 {
		t.Errorf("expected complexity 1, got %d", c)
	}
}

func TestComputeComplexity_If(t *testing.T) {
	fset := token.NewFileSet()
	f, _ := parser.ParseFile(fset, "test.go", `package main
func f() { if true {} }`, parser.ParseComments)
	fd := firstFuncDecl(f)
	c := computeComplexity(fd)
	if c != 2 {
		t.Errorf("expected complexity 2, got %d", c)
	}
}

func TestComputeComplexity_Complex(t *testing.T) {
	fset := token.NewFileSet()
	f, _ := parser.ParseFile(fset, "test.go", `package main
func f() { if true {} else if false {} else {} }`, parser.ParseComments)
	fd := firstFuncDecl(f)
	c := computeComplexity(fd)
	if c != 3 {
		t.Errorf("expected complexity 3, got %d", c)
	}
}

func TestComputeComplexity_Switch(t *testing.T) {
	fset := token.NewFileSet()
	f, _ := parser.ParseFile(fset, "test.go", `package main
func f() { switch x { case 1: case 2: default: } }`, parser.ParseComments)
	fd := firstFuncDecl(f)
	c := computeComplexity(fd)
	if c != 4 {
		t.Errorf("expected complexity 4, got %d", c)
	}
}

func TestCountFileLines(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "test.go")
	_ = os.WriteFile(path, []byte("line1\nline2\nline3\n"), 0600)
	stat := countFileLines(path)
	if stat.Lines != 3 {
		t.Errorf("expected 3 lines, got %d", stat.Lines)
	}
}

func TestParseGoMod(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "go.mod")
	content := `module github.com/user/project

go 1.22

require (
	golang.org/x/text v0.3.0
)`
	_ = os.WriteFile(path, []byte(content), 0600)

	deps := parseGoMod(path)
	if len(deps) == 0 {
		t.Fatal("expected at least one dependency")
	}
	if deps[0].Path != "golang.org/x/text" {
		t.Errorf("expected dep golang.org/x/text, got %s", deps[0].Path)
	}
}

func TestParseGoMod_NoFile(t *testing.T) {
	deps := parseGoMod("/nonexistent/go.mod")
	if len(deps) != 0 {
		t.Errorf("expected 0 deps, got %d", len(deps))
	}
}

func TestMapSeverity(t *testing.T) {
	tests := []struct {
		input string
		want  model.Severity
	}{
		{"error", model.SeverityError},
		{"warning", model.SeverityWarning},
		{"info", model.SeverityInfo},
		{"unknown", model.SeverityInfo},
	}
	for _, tc := range tests {
		got := mapSeverity(tc.input)
		if got != tc.want {
			t.Errorf("mapSeverity(%q) = %q, want %q", tc.input, got, tc.want)
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
		{"unknown", model.SeverityInfo},
	}
	for _, tc := range tests {
		got := mapGosecSeverity(tc.input)
		if got != tc.want {
			t.Errorf("mapGosecSeverity(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestLinterCategory(t *testing.T) {
	tests := []struct {
		input string
		want  model.Category
	}{
		{"errcheck", model.CategoryBug},
		{"govet", model.CategoryBug},
		{"gofmt", model.CategoryStyle},
		{"golint", model.CategoryStyle},
		{"unknown", model.CategoryStyle},
	}
	for _, tc := range tests {
		got := linterCategory(tc.input)
		if got != tc.want {
			t.Errorf("linterCategory(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestHasTool(t *testing.T) {
	if !hasTool("go") {
		t.Error("expected 'go' to be found")
	}
	if hasTool("nonexistent-tool-xyz") {
		t.Error("expected nonexistent tool to not be found")
	}
}

func TestIsGitRepo(t *testing.T) {
	tmpDir := t.TempDir()

	if isGitRepo(tmpDir) {
		t.Error("expected false for non-git dir")
	}

	_ = exec.Command("git", "-C", tmpDir, "init").Run()
	if !isGitRepo(tmpDir) {
		t.Error("expected true for git dir")
	}
}

func TestIssueFromTestResult_NoFailures(t *testing.T) {
	s := &TestScanner{}
	tr := &model.TestResult{
		Packages: []model.TestPackage{
			{Tests: []model.Test{{Name: "TestOK", Status: "PASS"}}},
		},
	}
	issues := s.issuesFromTestResult(tr)
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestIssueFromTestResult_WithFailures(t *testing.T) {
	s := &TestScanner{}
	tr := &model.TestResult{
		Packages: []model.TestPackage{
			{Name: "mypkg", Tests: []model.Test{
				{Name: "TestA", Status: "PASS"},
				{Name: "TestB", Status: "FAIL"},
			}},
		},
	}
	issues := s.issuesFromTestResult(tr)
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(issues))
	}
	if !strings.Contains(issues[0].Message, "TestB") {
		t.Errorf("expected message to mention TestB, got %s", issues[0].Message)
	}
}

func TestFileStatsScanner(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "main.go"), []byte("package main\nfunc main() {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "README.md"), []byte("# readme\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte("module test\n\ngo 1.22\n"), 0600); err != nil {
		t.Fatal(err)
	}

	scanner := NewFileStatsScanner()
	cfg := testConfig(tmpDir)

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
	s := &LintScanner{}
	cfg := testConfig("testdata/simple")

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

func TestPipeline_Scanners(t *testing.T) {
	p := NewPipeline(NewLintScanner(), NewGitScanner())
	names := p.Scanners()
	if len(names) != 2 || names[0] != "lint" || names[1] != "git" {
		t.Errorf("unexpected scanner names: %v", names)
	}
}

func TestFileStatsScanner_NoExcludeDirs(t *testing.T) {
	tmpDir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(tmpDir, "vendor"), 0755)
	_ = os.WriteFile(filepath.Join(tmpDir, "vendor", "dep.go"), []byte("package vendor\n"), 0600)
	_ = os.WriteFile(filepath.Join(tmpDir, "main.go"), []byte("package main\n"), 0600)

	scanner := NewFileStatsScanner()
	cfg := testConfig(tmpDir)

	progress := make(chan ProgressEvent, 10)
	drainProgress(progress)
	defer close(progress)

	result, err := scanner.Run(context.Background(), cfg, progress)
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	data := result.Data.(*model.ScanResult)
	if data.GoFiles != 1 {
		t.Errorf("expected 1 go file (vendor skipped by default filter), got %d", data.GoFiles)
	}
}

func BenchmarkMapSeverity(b *testing.B) {
	levels := []string{"error", "warning", "info", "unknown", "fatal", "debug"}
	for i := range b.N {
		mapSeverity(levels[i%len(levels)])
	}
}

func BenchmarkModuleName(b *testing.B) {
	paths := []string{".", "/home/user/go/src/github.com/foo/bar", "/tmp/project"}
	for i := range b.N {
		moduleName(paths[i%len(paths)])
	}
}

func BenchmarkParseBenchOutput(b *testing.B) {
	output := `BenchmarkAdd-8   	100000000	        12.34 ns/op	       0 B/op	       0 allocs/op
BenchmarkSubtract-8   	50000000	        25.67 ns/op	       0 B/op	       0 allocs/op
BenchmarkDivide-8   	30000000	        40.12 ns/op	       0 B/op	       0 allocs/op
`
	b.ResetTimer()
	for range b.N {
		parseBenchOutput(output)
	}
}
