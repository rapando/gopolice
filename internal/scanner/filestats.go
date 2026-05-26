package scanner

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type FileStatsScanner struct{}

func NewFileStatsScanner() *FileStatsScanner {
	return &FileStatsScanner{}
}

func (s *FileStatsScanner) Name() string {
	return "filestats"
}

func (s *FileStatsScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Gathering file statistics"}

	skipDir := NewGitIgnoreFilter(projectDir)

	var fileStats []model.FileStat
	totalFiles := 0
	goFiles := 0
	totalLines := 0

	err := filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if skipDir(path) {
				return filepath.SkipDir
			}
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		totalFiles++

		relPath, err := filepath.Rel(projectDir, path)
		if err != nil {
			relPath = path
		}

		if !strings.HasSuffix(info.Name(), ".go") {
			fileStats = append(fileStats, model.FileStat{
				Path:  relPath,
				Lines: 0,
			})
			return nil
		}

		goFiles++
		stat := countFileLines(path)
		stat.Path = relPath
		fileStats = append(fileStats, stat)
		totalLines += stat.Lines

		return nil
	})
	if err != nil {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusFailed, Message: fmt.Sprintf("file stats failed: %v", err), Error: err}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start), Error: err}, nil
	}

	deps := parseGoMod(filepath.Join(projectDir, "go.mod"))

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d .go files, %d total lines", goFiles, totalLines), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data: &model.ScanResult{
			FileStats:  fileStats,
			TotalFiles: totalFiles,
			GoFiles:    goFiles,
			TotalLines: totalLines,
			Deps:       deps,
		},
	}, nil
}

func countFileLines(path string) model.FileStat {
	file, err := os.Open(path)
	if err != nil {
		return model.FileStat{Path: path}
	}
	defer func() { _ = file.Close() }()

	var stat model.FileStat
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		stat.Lines++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			stat.BlankLines++
		} else if strings.HasPrefix(line, "//") || strings.HasPrefix(line, "/*") || strings.HasPrefix(line, "*") {
			stat.CommentLines++
		} else {
			stat.CodeLines++
		}
	}
	return stat
}

func parseGoMod(path string) []model.Dependency {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer func() { _ = file.Close() }()

	var deps []model.Dependency
	scanner := bufio.NewScanner(file)
	inRequire := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "require (" {
			inRequire = true
			continue
		}
		if inRequire && line == ")" {
			inRequire = false
			continue
		}
		if inRequire {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				dep := model.Dependency{
					Path:    parts[0],
					Version: parts[1],
				}
				if strings.Contains(line, "// indirect") {
					dep.Indirect = true
				}
				deps = append(deps, dep)
			}
		}
	}
	return deps
}
