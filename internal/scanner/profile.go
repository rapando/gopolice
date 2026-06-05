package scanner

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type ProfileScanner struct{}

func NewProfileScanner() *ProfileScanner {
	return &ProfileScanner{}
}

func (s *ProfileScanner) Name() string {
	return "profile"
}

var pprofEntryRe = regexp.MustCompile(`^\s+([\d.]+)\S*\s+([\d.]+)%\s+[\d.]+%\s+([\d.]+)\S*\s+([\d.]+)%\s+(.+)$`)

func (s *ProfileScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Profiling (CPU + memory)"}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	pkgs, err := listBenchmarkablePackages(ctx, projectDir)
	if err != nil {
		return nil, fmt.Errorf("list packages: %w", err)
	}
	if len(pkgs) == 0 {
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: "No packages with test files to profile", Elapsed: time.Since(start)}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
	}

	data := &model.ProfileData{}

	for _, pkg := range pkgs {
		select {
		case <-ctx.Done():
			return &Result{ScannerName: s.Name(), Duration: time.Since(start), Data: data}, ctx.Err()
		default:
		}

		tmpDir, err := os.MkdirTemp("", "gopolice-profile-*")
		if err != nil {
			continue
		}

		cpuProfile := filepath.Join(tmpDir, "cpu.pprof")
		memProfile := filepath.Join(tmpDir, "mem.pprof")

		cmd := exec.CommandContext(ctx, "go", "test", "-bench=.", "-cpuprofile="+cpuProfile, "-memprofile="+memProfile, "-count=1", pkg)
		cmd.Dir = projectDir
		_, _ = cmd.CombinedOutput()

		if entries, err := parsePprofOutput(ctx, cpuProfile); err == nil && len(entries) > 0 {
			data.CPU = append(data.CPU, entries...)
		}

		if entries, err := parsePprofOutput(ctx, memProfile); err == nil && len(entries) > 0 {
			data.Mem = append(data.Mem, entries...)
		}

		_ = os.RemoveAll(tmpDir)
	}

	data.CPU = mergeProfileEntries(data.CPU)
	data.Mem = mergeProfileEntries(data.Mem)

	count := len(data.CPU) + len(data.Mem)
	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Profiled %d functions (CPU: %d, Mem: %d)", count, len(data.CPU), len(data.Mem)), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data:        data,
	}, nil
}

func mergeProfileEntries(entries []model.ProfileEntry) []model.ProfileEntry {
	merged := make(map[string]*model.ProfileEntry)
	for _, e := range entries {
		if existing, ok := merged[e.Function]; ok {
			existing.Flat += e.Flat
			existing.FlatPct += e.FlatPct
			existing.Cum += e.Cum
			existing.CumPct += e.CumPct
		} else {
			merged[e.Function] = &model.ProfileEntry{
				Function: e.Function,
				Flat:     e.Flat,
				FlatPct:  e.FlatPct,
				Cum:      e.Cum,
				CumPct:   e.CumPct,
			}
		}
	}
	result := make([]model.ProfileEntry, 0, len(merged))
	for _, e := range merged {
		result = append(result, *e)
	}
	return result
}

func listBenchmarkablePackages(ctx context.Context, projectDir string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "go", "list", "-f", "{{.ImportPath}}\t{{.TestGoFiles}}\t{{.XTestGoFiles}}", "./...")
	cmd.Dir = projectDir
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var pkgs []string
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		importPath := parts[0]
		testFiles := strings.Trim(parts[1], "[] ")
		xtestFiles := strings.Trim(parts[2], "[] ")
		if testFiles != "" || xtestFiles != "" {
			pkgs = append(pkgs, importPath)
		}
	}
	return pkgs, nil
}

func parsePprofOutput(ctx context.Context, profilePath string) ([]model.ProfileEntry, error) {
	cmd := exec.CommandContext(ctx, "go", "tool", "pprof", "-top", "-nodecount=100", profilePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("pprof: %w", err)
	}

	return parsePprofText(string(output)), nil
}

func parsePprofText(output string) []model.ProfileEntry {
	var entries []model.ProfileEntry
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		matches := pprofEntryRe.FindStringSubmatch(line)
		if matches == nil {
			continue
		}
		flat, _ := strconv.ParseFloat(matches[1], 64)
		flatPct, _ := strconv.ParseFloat(matches[2], 64)
		cum, _ := strconv.ParseFloat(matches[3], 64)
		cumPct, _ := strconv.ParseFloat(matches[4], 64)
		fn := strings.TrimSpace(matches[5])

		entries = append(entries, model.ProfileEntry{
			Function: fn,
			Flat:     flat,
			FlatPct:  flatPct,
			Cum:      cum,
			CumPct:   cumPct,
		})
	}
	return entries
}
