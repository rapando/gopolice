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
	projectDir := cfg.TargetDir
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

	if authorsOut, err := gitCommand(projectDir, "shortlog", "-sne", "HEAD"); err == nil {
		info.Authors = parseAuthors(authorsOut)
		info.AuthorCount = len(info.Authors)
	}

	if commitsOut, err := gitCommand(projectDir, "log", "--max-count=10", "--format=%H|%cI|%an|%ae|%s|%G?"); err == nil {
		info.Commits = parseCommits(commitsOut)
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Branch: %s, Commit: %.7s", info.Branch, info.Commit), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data:        info,
	}, nil
}

func parseAuthors(out string) []model.AuthorInfo {
	var authors []model.AuthorInfo
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var count int
		var name, email string
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) < 2 {
			continue
		}
		fmt.Sscanf(parts[0], "%d", &count)
		rest := parts[1]
		if i := strings.LastIndex(rest, "<"); i >= 0 {
			name = strings.TrimSpace(rest[:i])
			email = strings.Trim(rest[i:], "<> ")
		} else {
			name = rest
		}
		authors = append(authors, model.AuthorInfo{Name: name, Email: email, Count: count})
	}
	return authors
}

func parseCommits(out string) []model.CommitInfo {
	var commits []model.CommitInfo
	scanner := bufio.NewScanner(strings.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 6)
		if len(parts) < 6 {
			continue
		}
		hash := strings.TrimSpace(parts[0])
		dateStr := strings.TrimSpace(parts[1])
		author := strings.TrimSpace(parts[2])
		email := strings.TrimSpace(parts[3])
		message := strings.TrimSpace(parts[4])
		verified := strings.TrimSpace(parts[5])

		var date time.Time
		if t, err := time.Parse(time.RFC3339, dateStr); err == nil {
			date = t
		}

		commits = append(commits, model.CommitInfo{
			Hash:     hash,
			Date:     date,
			Author:   author,
			Email:    email,
			Message:  message,
			Verified: verified,
		})
	}
	return commits
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
