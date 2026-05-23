package scanner

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type Pipeline struct {
	scanners []Scanner
}

func NewPipeline(scanners ...Scanner) *Pipeline {
	return &Pipeline{scanners: scanners}
}

func NewDefaultPipeline() *Pipeline {
	return NewPipeline(
		NewLintScanner(),
		NewSecurityScanner(),
		NewTestScanner(),
		NewComplexityScanner(),
		NewFileStatsScanner(),
		NewGitScanner(),
	)
}

func (p *Pipeline) Scanners() []string {
	names := make([]string, len(p.scanners))
	for i, s := range p.scanners {
		names[i] = s.Name()
	}
	return names
}

func (p *Pipeline) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*model.ScanResult, error) {
	start := time.Now()

	result := &model.ScanResult{
		ScanTime: start,
		Issues:   make([]model.Issue, 0),
	}

	enabledScanners := p.filterEnabled(cfg)

	for _, s := range enabledScanners {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}

		r, err := s.Run(ctx, cfg, progress)
		if err != nil {
			if progress != nil {
				progress <- ProgressEvent{Scanner: s.Name(), Status: StatusFailed, Message: fmt.Sprintf("scanner failed: %v", err), Error: err}
			}
			continue
		}
		if r == nil {
			continue
		}

		if r.Issues != nil {
			result.Issues = append(result.Issues, r.Issues...)
		}

		switch data := r.Data.(type) {
		case *model.TestResult:
			result.TestResults = data
		case *model.GitInfo:
			result.GitInfo = data
		case *model.ScanResult:
			if data.FileStats != nil {
				result.FileStats = data.FileStats
			}
			if data.Deps != nil {
				result.Deps = data.Deps
			}
			if data.TotalFiles > 0 {
				result.TotalFiles = data.TotalFiles
			}
			if data.GoFiles > 0 {
				result.GoFiles = data.GoFiles
			}
			if data.TotalLines > 0 {
				result.TotalLines = data.TotalLines
			}
		}
	}

	result.Duration = time.Since(start)
	p.normalizePaths(result, cfg)
	return result, nil
}

func (p *Pipeline) normalizePaths(result *model.ScanResult, cfg *config.Config) {
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}
	absDir, err := filepath.Abs(projectDir)
	if err != nil {
		return
	}

	for i := range result.Issues {
		path := result.Issues[i].File
		if path == "" {
			continue
		}

		path = strings.TrimPrefix(path, "./")

		if filepath.IsAbs(path) {
			rel, err := filepath.Rel(absDir, path)
			if err == nil {
				result.Issues[i].File = rel
			}
		} else {
			result.Issues[i].File = path
		}
	}
}

func (p *Pipeline) filterEnabled(cfg *config.Config) []Scanner {
	toggles := cfg.Scan.Scanners
	var enabled []Scanner

	for _, s := range p.scanners {
		switch s.Name() {
		case "lint":
			if toggles.Lint {
				enabled = append(enabled, s)
			}
		case "security":
			if toggles.Security {
				enabled = append(enabled, s)
			}
		case "tests":
			if toggles.Tests {
				enabled = append(enabled, s)
			}
		case "profile":
			if toggles.Profile && !cfg.Scan.Quick {
				enabled = append(enabled, s)
			}
		case "git":
			if toggles.Git {
				enabled = append(enabled, s)
			}
		case "complexity":
			if toggles.Complexity {
				enabled = append(enabled, s)
			}
		case "filestats":
			enabled = append(enabled, s)
		default:
			enabled = append(enabled, s)
		}
	}
	return enabled
}
