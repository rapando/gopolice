package scanner

import (
	"bufio"
	"context"
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

	t := newTracker(progress, s.Name())
	t.started("Building dependency graph")
	t.step(0, 0, "", "Resolving module graph", "go mod graph")

	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "go", "mod", "graph")
	cmd.Dir = projectDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if len(output) == 0 {
			t.completed("No go.mod found")
			return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
		}
		t.completedf("go mod graph failed: %v", err)
		return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
	}

	graph := parseModGraph(string(output))
	t.completedf("Found %d dependency edges", len(graph.Edges))
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
