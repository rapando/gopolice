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

	tmpDir, err := os.MkdirTemp("", "gopolice-profile-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cpuProfile := filepath.Join(tmpDir, "cpu.pprof")
	memProfile := filepath.Join(tmpDir, "mem.pprof")

	cmd := exec.CommandContext(ctx, "go", "test", "-cpuprofile="+cpuProfile, "-memprofile="+memProfile, "-count=1", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: "No test files to profile", Elapsed: time.Since(start)}
			return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
		}
	}

	data := &model.ProfileData{}

	if _, err := os.Stat(cpuProfile); err == nil {
		entries, err := parsePprofOutput(ctx, cpuProfile)
		if err == nil {
			data.CPU = entries
		}
	}

	if _, err := os.Stat(memProfile); err == nil {
		entries, err := parsePprofOutput(ctx, memProfile)
		if err == nil {
			data.Mem = entries
		}
	}

	count := len(data.CPU) + len(data.Mem)
	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Profiled %d functions (CPU: %d, Mem: %d)", count, len(data.CPU), len(data.Mem)), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data:        data,
	}, nil
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
