package scanner

import (
	"os/exec"
	"path/filepath"
	"strings"
)

type PathFilter func(path string) bool

func NewGitIgnoreFilter(projectDir string) PathFilter {
	if !hasTool("git") {
		return defaultSkipFilter()
	}

	cmd := exec.Command("git", "rev-parse", "--git-dir")
	cmd.Dir = projectDir
	if err := cmd.Run(); err != nil {
		return defaultSkipFilter()
	}

	return func(path string) bool {
		base := filepath.Base(path)
		if base == ".git" {
			return true
		}
		rel, err := filepath.Rel(projectDir, path)
		if err != nil {
			return false
		}
		if rel == "." || strings.HasPrefix(rel, "..") {
			return false
		}
		cmd := exec.Command("git", "check-ignore", "-q", rel)
		cmd.Dir = projectDir
		return cmd.Run() == nil
	}
}

func defaultSkipFilter() PathFilter {
	return func(path string) bool {
		base := filepath.Base(path)
		if base == "." || base == ".." {
			return false
		}
		if strings.HasPrefix(base, ".") {
			return true
		}
		return base == "node_modules" || base == "vendor" || base == "dist"
	}
}
