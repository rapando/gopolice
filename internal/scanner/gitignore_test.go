package scanner

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestDefaultSkipFilter(t *testing.T) {
	filter := defaultSkipFilter()
	cases := map[string]bool{
		"vendor":                     true,
		"node_modules":               true,
		"dist":                       true,
		".hidden":                    true,
		filepath.Join("a", "vendor"): true,
		"cmd":                        false,
		".":                          false,
		"..":                         false,
	}
	for path, want := range cases {
		if got := filter(path); got != want {
			t.Errorf("defaultSkipFilter(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestGitIgnoreFilterSkipsDefaultNames(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	for _, d := range []string{"vendor", "src", "build"} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("build/\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	filter := NewGitIgnoreFilter(dir)
	cases := map[string]bool{
		"vendor": true,
		"build":  true,
		"src":    false,
	}
	for name, want := range cases {
		if got := filter(filepath.Join(dir, name)); got != want {
			t.Errorf("filter(%q) = %v, want %v", name, got, want)
		}
	}
}
