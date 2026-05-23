package scanner

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type GitScanner struct{}

func NewGitScanner() *GitScanner {
	return &GitScanner{}
}

func (s *GitScanner) Name() string {
	return "git"
}

func (s *GitScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Collecting git information"}

	if !hasTool("git") {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusSkipped, Message: "git not found"}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
	}

	if !isGitRepo(projectDir) {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusSkipped, Message: "not a git repository"}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
	}

	info := &model.GitInfo{}

	if branch, err := gitCommand(projectDir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		info.Branch = strings.TrimSpace(branch)
	}

	if commit, err := gitCommand(projectDir, "rev-parse", "HEAD"); err == nil {
		info.Commit = strings.TrimSpace(commit)
	}

	if commitTime, err := gitCommand(projectDir, "log", "-1", "--format=%cI"); err == nil {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(commitTime)); err == nil {
			info.CommitTime = t
		}
	}

	if authors, err := gitCommand(projectDir, "shortlog", "-sn", "HEAD"); err == nil {
		info.AuthorCount = countLines(strings.TrimSpace(authors))
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Branch: %s, Commit: %.7s", info.Branch, info.Commit), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data:        info,
	}, nil
}

func gitCommand(dir, arg string, args ...string) (string, error) {
	cmdArgs := append([]string{arg}, args...)
	cmd := exec.Command("git", cmdArgs...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func isGitRepo(dir string) bool {
	out, err := gitCommand(dir, "rev-parse", "--git-dir")
	return err == nil && strings.TrimSpace(out) != ""
}

func countLines(s string) int {
	if s == "" {
		return 0
	}
	count := 0
	scanner := bufio.NewScanner(strings.NewReader(s))
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) != "" {
			count++
		}
	}
	return count
}
