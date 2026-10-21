package scanner

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/rapando/gopolice/internal/model"
)

func TestSecurityScannerReportsToolStatus(t *testing.T) {
	progress := make(chan ProgressEvent, 100)
	drainProgress(progress)
	defer close(progress)

	r, err := NewSecurityScanner().Run(context.Background(), testConfig(filepath.Join("testdata", "simple")), progress)
	if err != nil {
		t.Fatal(err)
	}
	tools, ok := r.Data.([]model.ToolStatus)
	if !ok || len(tools) != 2 {
		t.Fatalf("Data = %#v, want two tool statuses", r.Data)
	}
	for _, ts := range tools {
		switch ts.Status {
		case model.ToolRan, model.ToolMissing, model.ToolFailed:
		default:
			t.Errorf("%s: unexpected status %q", ts.Tool, ts.Status)
		}
		if ts.Install == "" || ts.Scanner != "security" {
			t.Errorf("%s: install hint or scanner missing: %+v", ts.Tool, ts)
		}
	}
}

func TestMergeToolStatus(t *testing.T) {
	a := []model.ToolStatus{{Tool: "gosec", Status: model.ToolRan, Findings: 2}, {Tool: "govulncheck", Status: model.ToolRan}}
	b := []model.ToolStatus{{Tool: "gosec", Status: model.ToolRan, Findings: 3}, {Tool: "govulncheck", Status: model.ToolMissing}}
	got := model.MergeToolStatus(a, b)
	if len(got) != 2 || got[0].Findings != 5 || got[0].Status != model.ToolRan || got[1].Status != model.ToolMissing {
		t.Errorf("merged = %+v", got)
	}
}
