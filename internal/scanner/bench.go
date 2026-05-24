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

func (s *BenchmarkScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Running benchmarks"}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "go", "test", "-bench=.", "-benchmem", "-count=1", "./...")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: "No benchmark output (no test files?)", Elapsed: time.Since(start)}
			return &Result{
				ScannerName: s.Name(),
				Duration:    time.Since(start),
				Data:        []model.BenchmarkResult{},
			}, nil
		}
	}

	results := parseBenchOutput(string(output))

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d benchmarks", len(results)), Elapsed: time.Since(start)}
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
