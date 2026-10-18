package scanner

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

// testInventory is what a project declares in its _test.go files. It is
// gathered by parsing, which is far cheaper than compiling, and it lets the
// test and benchmark scanners report "N of M" while go test runs.
type testInventory struct {
	Tests      int // top-level Test functions
	Benchmarks int // top-level Benchmark functions
	Packages   int // directories with at least one _test.go file
}

// inventoryTests walks projectDir (honouring .gitignore) and counts the
// top-level Test and Benchmark functions in _test.go files.
func inventoryTests(projectDir string) testInventory {
	var inv testInventory
	skipDir := NewGitIgnoreFilter(projectDir)
	fset := token.NewFileSet()
	testDirs := map[string]struct{}{}

	_ = filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if skipDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(info.Name(), "_test.go") {
			return nil
		}
		testDirs[filepath.Dir(path)] = struct{}{}
		// Only declarations are needed, so stop before function bodies.
		f, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return nil
		}
		for _, decl := range f.Decls {
			fd, ok := decl.(*ast.FuncDecl)
			if !ok || fd.Recv != nil || fd.Type.Params == nil || len(fd.Type.Params.List) != 1 {
				continue
			}
			switch {
			case isTestFunc(fd.Name.Name, "Test"):
				inv.Tests++
			case isTestFunc(fd.Name.Name, "Benchmark"):
				inv.Benchmarks++
			}
		}
		return nil
	})
	inv.Packages = len(testDirs)
	return inv
}

// isTestFunc mirrors go test's rule: the prefix must be followed by a
// non-lowercase character (TestFoo, Test_foo, Test1), so "Testing" is not a
// test.
func isTestFunc(name, prefix string) bool {
	if !strings.HasPrefix(name, prefix) {
		return false
	}
	rest := name[len(prefix):]
	if rest == "" {
		return true
	}
	c := rest[0]
	return c < 'a' || c > 'z'
}

// goFiles lists the non-test .go files under projectDir, honouring
// .gitignore, so file-walking scanners know their total up front.
func goFiles(projectDir string, includeTests bool) []string {
	skipDir := NewGitIgnoreFilter(projectDir)
	var files []string
	_ = filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if skipDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(info.Name(), ".go") {
			return nil
		}
		if !includeTests && strings.HasSuffix(info.Name(), "_test.go") {
			return nil
		}
		files = append(files, path)
		return nil
	})
	return files
}
