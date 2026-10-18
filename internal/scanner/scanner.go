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

// ProgressEvent is one update from a scan. Lifecycle events (started,
// completed, failed, skipped) carry a Message. Ticks (status running with
// Total > 0 and no Message) report item-level progress: Done of Total Unit,
// currently on Detail, e.g. 4 of 100 tests, TestParse.
type ProgressEvent struct {
	Scanner string        `json:"scanner"`
	Status  Status        `json:"status"`
	Message string        `json:"message,omitempty"`
	Error   error         `json:"error,omitempty"`
	Elapsed time.Duration `json:"elapsed,omitempty"`

	Done   int    `json:"done,omitempty"`
	Total  int    `json:"total,omitempty"`
	Unit   string `json:"unit,omitempty"`
	Detail string `json:"detail,omitempty"`
	// Steps lists every scanner the pipeline will run, so a UI can show the
	// pending ones. Sent on the pipeline's own events.
	Steps []string `json:"steps,omitempty"`
	// Seq numbers events within one scan, assigned by whoever records them,
	// so a replayed stream can be de-duplicated.
	Seq int `json:"seq,omitempty"`
}

// IsTick reports whether the event is an item-level progress update rather
// than a lifecycle message.
func (e ProgressEvent) IsTick() bool {
	return e.Status == StatusRunning && e.Message == "" && (e.Total > 0 || e.Detail != "")
}

type Result struct {
	ScannerName string        `json:"scanner_name"`
	Issues      []model.Issue `json:"issues"`
	Duration    time.Duration `json:"duration"`
	Error       error         `json:"error,omitempty"`
	Data        interface{}   `json:"data,omitempty"`
}

type Scanner interface {
	Name() string
	Run(ctx context.Context, cfg *config.Config, progress chan<- ProgressEvent) (*Result, error)
}
