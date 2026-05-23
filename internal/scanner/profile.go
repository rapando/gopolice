package scanner

import (
	"context"
	"time"

	"github.com/rapando/gopolice/internal/config"
)

type ProfileScanner struct{}

func NewProfileScanner() *ProfileScanner {
	return &ProfileScanner{}
}

func (s *ProfileScanner) Name() string {
	return "profile"
}

func (s *ProfileScanner) Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error) {
	start := time.Now()
	projectDir := cfg.Project.Path
	if projectDir == "" {
		projectDir = "."
	}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusStarted, Message: "Profiling (not yet implemented — stub)"}

	progress <- ProgressEvent{Scanner: s.Name(), Status: StatusCompleted, Message: "Profile scanning requires --profile flag (stub)", Elapsed: time.Since(start)}
	return &Result{ScannerName: s.Name(), Duration: time.Since(start)}, nil
}

type ProfileData struct {
	CPUProfilePath string   `json:"cpu_profile_path,omitempty"`
	MemProfilePath string   `json:"mem_profile_path,omitempty"`
	TopFunctions   []string `json:"top_functions,omitempty"`
}
