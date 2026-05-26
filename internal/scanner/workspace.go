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

type WorkFile struct {
	GoVersion string
	Use       []string
}

func ParseWorkFile(path string) (*WorkFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()

	wf := &WorkFile{}
	scanner := bufio.NewScanner(f)
	inUse := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}

		if strings.HasPrefix(line, "go ") {
			wf.GoVersion = strings.TrimSpace(strings.TrimPrefix(line, "go"))
			continue
		}

		if line == "use (" {
			inUse = true
			continue
		}
		if inUse && line == ")" {
			inUse = false
			continue
		}
		if inUse {
			dir := strings.TrimSpace(line)
			if dir != "" {
				wf.Use = append(wf.Use, dir)
			}
			continue
		}

		if strings.HasPrefix(line, "use ") {
			dir := strings.TrimSpace(strings.TrimPrefix(line, "use"))
			if dir != "" {
				wf.Use = append(wf.Use, dir)
			}
		}
	}

	return wf, scanner.Err()
}

func resolveWorkspaceModules(cfg *config.Config) ([]string, []string, error) {
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	workPath := filepath.Join(projectDir, "go.work")
	wf, err := ParseWorkFile(workPath)
	if err != nil {
		return nil, nil, err
	}

	if wf == nil || len(wf.Use) == 0 {
		return nil, nil, nil
	}

	absProjectDir, _ := filepath.Abs(projectDir)
	var moduleDirs []string
	for _, use := range wf.Use {
		modDir := use
		if !filepath.IsAbs(modDir) {
			modDir = filepath.Join(absProjectDir, modDir)
		}
		modDir = filepath.Clean(modDir)
		if info, err := os.Stat(filepath.Join(modDir, "go.mod")); err == nil && !info.IsDir() {
			moduleDirs = append(moduleDirs, modDir)
		}
	}

	if len(moduleDirs) == 0 {
		return nil, nil, nil
	}

	var moduleNames []string
	for _, d := range moduleDirs {
		rel, _ := filepath.Rel(absProjectDir, d)
		moduleNames = append(moduleNames, rel)
	}

	return moduleDirs, moduleNames, nil
}

func RunWorkspaceScan(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*model.ScanResult, error) {
	moduleDirs, moduleNames, err := resolveWorkspaceModules(cfg)
	if err != nil {
		return nil, err
	}
	if moduleDirs == nil {
		return nil, nil //nolint:nilnil // nil/nil means "not a workspace", caller checks this
	}

	if progress != nil {
		progress <- ProgressEvent{Scanner: "workspace", Status: StatusStarted, Message: fmt.Sprintf("Workspace scan: %d modules", len(moduleDirs))}
	}

	combined := &model.ScanResult{
		ScanTime: time.Now(),
		Modules:  moduleNames,
	}

	for i, modDir := range moduleDirs {
		modCfg := *cfg
		modCfg.TargetDir = modDir

		modName := moduleNames[i]
		if progress != nil {
			progress <- ProgressEvent{Scanner: "workspace", Status: StatusRunning, Message: fmt.Sprintf("Scanning module: %s", modName)}
		}

		p := NewDefaultPipeline()
		result, err := p.Run(ctx, &modCfg, progress)
		if err != nil {
			if progress != nil {
				progress <- ProgressEvent{Scanner: "workspace", Status: StatusRunning, Message: fmt.Sprintf("Module %s failed: %v", modName, err)}
			}
			continue
		}
		if result == nil {
			continue
		}

		for i := range result.Issues {
			result.Issues[i].Module = modName
		}

		combined.Issues = append(combined.Issues, result.Issues...)

		if result.TestResults != nil {
			if combined.TestResults == nil {
				combined.TestResults = result.TestResults
			} else {
				combined.TestResults.Packages = append(combined.TestResults.Packages, result.TestResults.Packages...)
				combined.TestResults.Total.Total += result.TestResults.Total.Total
				combined.TestResults.Total.Passed += result.TestResults.Total.Passed
				combined.TestResults.Total.Failed += result.TestResults.Total.Failed
				combined.TestResults.Total.Skipped += result.TestResults.Total.Skipped
			}
		}

		if result.Benchmarks != nil {
			combined.Benchmarks = append(combined.Benchmarks, result.Benchmarks...)
		}
		if result.Profile != nil {
			combined.Profile = result.Profile
		}
		if result.DepGraph != nil {
			if combined.DepGraph == nil {
				combined.DepGraph = result.DepGraph
			} else {
				combined.DepGraph.Edges = append(combined.DepGraph.Edges, result.DepGraph.Edges...)
			}
		}
		if result.GitInfo != nil {
			combined.GitInfo = result.GitInfo
		}
		if result.FileStats != nil {
			combined.FileStats = append(combined.FileStats, result.FileStats...)
		}
		combined.TotalFiles += result.TotalFiles
		combined.GoFiles += result.GoFiles
		combined.TotalLines += result.TotalLines
		if result.Deps != nil {
			combined.Deps = append(combined.Deps, result.Deps...)
		}
	}

	if progress != nil {
		progress <- ProgressEvent{Scanner: "workspace", Status: StatusCompleted, Message: fmt.Sprintf("Workspace scan complete: %d modules, %d issues", len(moduleDirs), len(combined.Issues))}
	}

	combined.Duration = time.Since(combined.ScanTime)

	p := NewDefaultPipeline()
	p.normalizePaths(combined, cfg)
	if combined.ProjectName == "" {
		combined.ProjectName = moduleName(cfg.TargetDir)
	}

	return combined, nil
}
