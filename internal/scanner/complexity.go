package scanner

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

const complexityThreshold = 10

type ComplexityScanner struct {
	Threshold int
}

func NewComplexityScanner() *ComplexityScanner {
	return &ComplexityScanner{Threshold: complexityThreshold}
}

func (s *ComplexityScanner) Name() string {
	return "complexity"
}

func (s *ComplexityScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Analyzing code complexity"}

	threshold := s.Threshold
	excludeDirs := make(map[string]bool)
	for _, d := range cfg.Project.ExcludeDirs {
		excludeDirs[d] = true
	}

	var allIssues []model.Issue

	err := filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if excludeDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(info.Name(), ".go") || strings.HasSuffix(info.Name(), "_test.go") {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if err != nil {
			return nil
		}

		relPath, err := filepath.Rel(projectDir, path)
		if err != nil {
			relPath = path
		}

		for _, decl := range f.Decls {
			funcDecl, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}

			comp := computeComplexity(funcDecl)
			if comp > threshold {
				pos := fset.Position(funcDecl.Pos())
				allIssues = append(allIssues, model.Issue{
					ID:       fmt.Sprintf("complexity-%s-%s", relPath, funcDecl.Name.Name),
					Scanner:  "complexity",
					Rule:     "high-complexity",
					Severity: model.SeverityWarning,
					File:     relPath,
					Line:     pos.Line,
					Message:  fmt.Sprintf("Function %s has cyclomatic complexity of %d (threshold: %d)", funcDecl.Name.Name, comp, threshold),
					Category: model.CategoryComplexity,
					Solution: "Consider extracting logic into smaller helper functions, using early returns to reduce nesting, or simplifying conditional branches to bring the complexity below the threshold.",
				})
			}
		}
		return nil
	})
	if err != nil {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusFailed, Message: fmt.Sprintf("complexity analysis failed: %v", err), Error: err}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues, Error: err}, nil
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d complex functions", len(allIssues)), Elapsed: time.Since(start)}
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues}, nil
}

func computeComplexity(funcDecl *ast.FuncDecl) int {
	comp := 1
	ast.Inspect(funcDecl, func(n ast.Node) bool {
		switch n.(type) {
		case *ast.IfStmt:
			comp++
		case *ast.ForStmt:
			comp++
		case *ast.RangeStmt:
			comp++
		case *ast.CaseClause:
			comp++
		case *ast.CommClause:
			comp++
		default:
		}
		return true
	})
	return comp
}
