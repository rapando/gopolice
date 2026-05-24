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

type DepGraphScanner struct{}

func NewDepGraphScanner() *DepGraphScanner {
	return &DepGraphScanner{}
}

func (s *DepGraphScanner) Name() string {
	return "depgraph"
}

func (s *DepGraphScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Building dependency graph"}

	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "go", "mod", "graph")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: "No go.mod found", Elapsed: time.Since(start)}
			return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
		}
		progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("go mod graph failed: %v", err), Elapsed: time.Since(start)}
		return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
	}

	graph := parseModGraph(string(output))
	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: fmt.Sprintf("Found %d dependency edges", len(graph.Edges)), Elapsed: time.Since(start)}
	return &Result{
		ScannerName: s.Name(),
		Duration:    time.Since(start),
		Data:        graph,
	}, nil
}

func parseModGraph(output string) *model.DepGraph {
	var edges []model.DepEdge
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		edges = append(edges, model.DepEdge{
			From: parts[0],
			To:   parts[1],
		})
	}
	return &model.DepGraph{Edges: edges}
}
