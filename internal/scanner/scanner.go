package scanner

import (
	"context"
	"time"

	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/model"
)

type Status string

const (
	StatusStarted   Status = "started"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
	StatusSkipped   Status = "skipped"
)

type ProgressEvent struct {
	Scanner string `json:"scanner"`
	Status  Status `json:"status"`
	Message string `json:"message,omitempty"`
	Error   error  `json:"error,omitempty"`
	Elapsed time.Duration `json:"elapsed,omitempty"`
}

type Result struct {
	ScannerName string          `json:"scanner_name"`
	Issues      []model.Issue   `json:"issues"`
	Duration    time.Duration   `json:"duration"`
	Error       error           `json:"error,omitempty"`
	Data        interface{}     `json:"data,omitempty"`
}

type Scanner interface {
	Name() string
	Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error)
}
