package scanner

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
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
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	t := newTracker(progress, s.Name())
	t.started("Analyzing code complexity")

	threshold := s.Threshold
	files := goFiles(projectDir, false)
	t.step(0, len(files), "files", fmt.Sprintf("Parsing %d Go files", len(files)), "")

	var allIssues []model.Issue
	var err error

	for i, path := range files {
		select {
		case <-ctx.Done():
			err = ctx.Err()
		default:
		}
		if err != nil {
			break
		}

		relPath, relErr := filepath.Rel(projectDir, path)
		if relErr != nil {
			relPath = path
		}
		t.tick(i+1, len(files), "files", relPath, i+1 == len(files))

		fset := token.NewFileSet()
		f, parseErr := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if parseErr != nil {
			continue
		}

		for _, decl := range f.Decls {
			funcDecl, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}

			comp := computeComplexity(funcDecl)
			if comp > threshold {
				pos := fset.Position(funcDecl.Pos())
				name := funcDecl.Name.Name
				if recv := receiverName(funcDecl); recv != "" {
					name = recv + "." + name
				}
				allIssues = append(allIssues, model.Issue{
					ID:        fmt.Sprintf("complexity-%s-%s", relPath, name),
					Scanner:   "complexity",
					Rule:      "high-complexity",
					Severity:  model.SeverityWarning,
					File:      relPath,
					Line:      pos.Line,
					Message:   fmt.Sprintf("Function %s has cyclomatic complexity of %d (threshold: %d)", name, comp, threshold),
					Category:  model.CategoryComplexity,
					Value:     comp,
					Threshold: threshold,
					Solution:  "Consider extracting logic into smaller helper functions, using early returns to reduce nesting, or simplifying conditional branches to bring the complexity below the threshold.",
				})
			}
		}
	}
	if err != nil {
		t.failed(fmt.Sprintf("complexity analysis failed: %v", err), err)
		return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues, Error: err}, nil
	}

	t.completedf("Found %d complex functions", len(allIssues))
	return &Result{ScannerName: s.Name(), Duration: time.Since(start), Issues: allIssues}, nil
}

// receiverName returns the base type name of fd's receiver, or "" for plain functions.
func receiverName(fd *ast.FuncDecl) string {
	if fd.Recv == nil || len(fd.Recv.List) == 0 {
		return ""
	}
	expr := fd.Recv.List[0].Type
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	switch t := expr.(type) {
	case *ast.IndexExpr:
		expr = t.X
	case *ast.IndexListExpr:
		expr = t.X
	}
	if ident, ok := expr.(*ast.Ident); ok {
		return ident.Name
	}
	return ""
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
