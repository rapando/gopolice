package scanner

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type BenchmarkScanner struct{}

func NewBenchmarkScanner() *BenchmarkScanner {
	return &BenchmarkScanner{}
}

func (s *BenchmarkScanner) Name() string {
	return "benchmarks"
}

var benchRe = regexp.MustCompile(`^Benchmark(\S+)\s+(\d+)\s+([\d.]+)\s+ns/op\s*(?:(\d+)\s+B/op)?\s*(?:(\d+)\s+allocs/op)?`)

var benchPkgLineRe = regexp.MustCompile(`^pkg:\s+(\S+)`)

func (s *BenchmarkScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	t := newTracker(progress, s.Name())
	t.started("Running benchmarks")

	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	inv := inventoryTests(projectDir)
	if inv.Benchmarks == 0 {
		t.completed("No benchmarks found")
		return &Result{ScannerName: s.Name(), Duration: time.Since(start), Data: []model.BenchmarkResult{}}, nil
	}
	t.step(0, inv.Benchmarks, "benchmarks", fmt.Sprintf("Found %d benchmarks", inv.Benchmarks), "")

	cmd := exec.CommandContext(ctx, "go", "test", "-run=^$", "-bench=.", "-benchmem", "-count=1", "./...")
	cmd.Dir = projectDir

	// A benchmark's line is printed when it finishes; the "pkg:" header tells
	// which package is running before its first result appears.
	done, total := 0, inv.Benchmarks
	output, err := streamOutput(cmd, func(line string) {
		line = strings.TrimSpace(line)
		if m := benchPkgLineRe.FindStringSubmatch(line); m != nil {
			t.tick(done, total, "benchmarks", m[1], true)
			return
		}
		if m := benchRe.FindStringSubmatch(line); m != nil {
			done++
			if done > total {
				total = done
			}
			t.tick(done, total, "benchmarks", "Benchmark"+m[1], done == total)
		}
	})
	if err != nil && len(output) == 0 {
		t.completed("No benchmark output (no test files?)")
		return &Result{
			ScannerName: s.Name(),
			Duration:    time.Since(start),
			Data:        []model.BenchmarkResult{},
		}, nil
	}

	results := parseBenchOutput(string(output))

	t.completedf("Found %d benchmarks", len(results))
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data:        results,
	}, nil
}

func parseBenchOutput(output string) []model.BenchmarkResult {
	var results []model.BenchmarkResult
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		matches := benchRe.FindStringSubmatch(line)
		if matches == nil {
			continue
		}

		name := matches[1]
		iterations, _ := strconv.Atoi(matches[2])
		nsPerOp, _ := strconv.ParseFloat(matches[3], 64)

		r := model.BenchmarkResult{
			Name:       name,
			Iterations: iterations,
			TimePerOp:  time.Duration(nsPerOp) * time.Nanosecond,
		}

		if matches[4] != "" {
			r.BytesPerOp, _ = strconv.ParseInt(matches[4], 10, 64)
		}
		if matches[5] != "" {
			r.AllocsPerOp, _ = strconv.ParseInt(matches[5], 10, 64)
		}

		results = append(results, r)
	}
	return results
}
