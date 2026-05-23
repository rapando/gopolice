package fixer

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/rapando/gopolice/internal/model"
)

type FixResult struct {
	Applied bool   `json:"applied"`
	Message string `json:"message"`
	Backup  string `json:"backup,omitempty"`
}

func CanAutoFix(issue *model.Issue) bool {
	switch issue.Scanner {
	case "golangci-lint":
		switch issue.Rule {
		case "gofmt", "gofumpt", "gci":
			return true
		}
	case "go vet":
		return false
	}
	return false
}

func ApplyFix(issue *model.Issue, projectDir string) (*FixResult, error) {
	absPath := issue.File
	if !filepath.IsAbs(absPath) {
		absPath = filepath.Join(projectDir, absPath)
	}

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("file not found: %s", absPath)
	}

	backupPath, err := createBackup(absPath)
	if err != nil {
		return nil, fmt.Errorf("backup failed: %w", err)
	}

	switch issue.Scanner {
	case "golangci-lint":
		switch issue.Rule {
		case "gofmt":
			result, runErr := runGofmt(absPath)
			if result != nil {
				result.Backup = backupPath
			}
			return result, runErr
		case "gofumpt":
			result, runErr := runGofumpt(absPath)
			if result != nil {
				result.Backup = backupPath
			}
			return result, runErr
		case "gci":
			result, runErr := runGci(absPath, projectDir)
			if result != nil {
				result.Backup = backupPath
			}
			return result, runErr
		}
	}

	return &FixResult{Applied: false, Message: "no auto-fix available for this issue"}, nil
}

func runGofmt(path string) (*FixResult, error) {
	cmd := exec.Command("gofmt", "-w", path)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return &FixResult{
			Applied: false,
			Message: fmt.Sprintf("gofmt failed: %s", string(output)),
		}, nil
	}
	return &FixResult{Applied: true, Message: "file formatted with gofmt"}, nil
}

func runGofumpt(path string) (*FixResult, error) {
	if _, err := exec.LookPath("gofumpt"); err != nil {
		return &FixResult{Applied: false, Message: "gofumpt not installed"}, nil
	}
	cmd := exec.Command("gofumpt", "-w", path)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return &FixResult{
			Applied: false,
			Message: fmt.Sprintf("gofumpt failed: %s", string(output)),
		}, nil
	}
	return &FixResult{Applied: true, Message: "file formatted with gofumpt"}, nil
}

func runGci(path string, projectDir string) (*FixResult, error) {
	if _, err := exec.LookPath("gci"); err != nil {
		return &FixResult{Applied: false, Message: "gci not installed"}, nil
	}
	cmd := exec.Command("gci", "write", path)
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return &FixResult{
			Applied: false,
			Message: fmt.Sprintf("gci failed: %s", string(output)),
		}, nil
	}
	return &FixResult{Applied: true, Message: "imports organized with gci"}, nil
}

func createBackup(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	backupPath := path + ".bak"
	if err := os.WriteFile(backupPath, data, 0644); err != nil {
		return "", err
	}
	return backupPath, nil
}

func UndoFix(issue *model.Issue, projectDir string) error {
	absPath := issue.File
	if !filepath.IsAbs(absPath) {
		absPath = filepath.Join(projectDir, absPath)
	}
	backupPath := absPath + ".bak"
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		return fmt.Errorf("no backup found at %s", backupPath)
	}
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return err
	}
	if err := os.WriteFile(absPath, data, 0644); err != nil {
		return err
	}
	os.Remove(backupPath)
	return nil
}

func FindFixesForFile(absPath string) ([]model.Issue, error) {
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	content := string(data)
	var issues []model.Issue

	if !strings.HasSuffix(content, "\n") {
		issues = append(issues, model.Issue{
			Scanner: "gofmt",
			Rule:    "no-newline",
			Message: "file does not end with a newline",
			File:    absPath,
		})
	}

	return issues, nil
}
