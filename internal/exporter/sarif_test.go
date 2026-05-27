package exporter

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/rapando/gopolice/internal/model"
)

func TestExportSARIF_Basic(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	result := &model.ScanResult{
		ProjectName: "test-project",
		ScanTime:    now,
		Duration:    5 * time.Second,
		Issues: []model.Issue{
			{
				ID:       "lint-1",
				Scanner:  "golint",
				Rule:     "exported_comment",
				Severity: model.SeverityError,
				File:     "main.go",
				Line:     10,
				Column:   1,
				Message:  "exported function Foo should have comment or be unexported",
				Category: model.CategoryStyle,
				Solution: "Add a comment to Foo",
			},
			{
				ID:       "sec-1",
				Scanner:  "gosec",
				Rule:     "G101",
				Severity: model.SeverityWarning,
				File:     "internal/auth/token.go",
				Line:     42,
				Message:  "Potential hardcoded credential",
				Category: model.CategorySecurity,
				Module:   "github.com/example/auth",
			},
		},
		TestResults: &model.TestResult{
			Packages: []model.TestPackage{
				{Name: "pkg1", Coverage: 80.5},
				{Name: "pkg2", Coverage: 90.0},
			},
			Total: model.TestSummary{Total: 10, Passed: 8, Failed: 1, Skipped: 1},
		},
	}

	var buf bytes.Buffer
	err := ExportSARIF(result, "v1.0.0", &buf)
	if err != nil {
		t.Fatalf("ExportSARIF: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	if doc["version"] != "2.1.0" {
		t.Errorf("expected version 2.1.0, got %v", doc["version"])
	}

	runs := doc["runs"].([]interface{})
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}

	run := runs[0].(map[string]interface{})
	driver := run["tool"].(map[string]interface{})["driver"].(map[string]interface{})
	if driver["name"] != "gopolice" {
		t.Errorf("expected driver name gopolice, got %v", driver["name"])
	}
	if driver["version"] != "v1.0.0" {
		t.Errorf("expected version v1.0.0, got %v", driver["version"])
	}

	rules := driver["rules"].([]interface{})
	if len(rules) != 2 {
		t.Errorf("expected 2 rules, got %d", len(rules))
	}

	results := run["results"].([]interface{})
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	first := results[0].(map[string]interface{})
	if first["level"] != "error" {
		t.Errorf("expected level error, got %v", first["level"])
	}
	loc := first["locations"].([]interface{})[0].(map[string]interface{})
	phys := loc["physicalLocation"].(map[string]interface{})
	region := phys["region"].(map[string]interface{})
	if region["startLine"] != float64(10) {
		t.Errorf("expected startLine 10, got %v", region["startLine"])
	}
	if region["startColumn"] != float64(1) {
		t.Errorf("expected startColumn 1, got %v", region["startColumn"])
	}

	props := run["properties"].(map[string]interface{})
	if props["project_name"] != "test-project" {
		t.Errorf("expected project_name test-project, got %v", props["project_name"])
	}
	if props["tests_total"] != float64(10) {
		t.Errorf("expected tests_total 10, got %v", props["tests_total"])
	}
	if props["coverage"] != 85.25 {
		t.Errorf("expected coverage 85.25, got %v", props["coverage"])
	}
}

func TestExportSARIF_Empty(t *testing.T) {
	result := &model.ScanResult{
		ProjectName: "empty",
		Issues:      []model.Issue{},
	}

	var buf bytes.Buffer
	err := ExportSARIF(result, "dev", &buf)
	if err != nil {
		t.Fatalf("ExportSARIF: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	runs := doc["runs"].([]interface{})
	run := runs[0].(map[string]interface{})
	results := run["results"].([]interface{})
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}

	driver := run["tool"].(map[string]interface{})["driver"].(map[string]interface{})
	if _, ok := driver["rules"]; ok {
		t.Error("expected no rules for empty issues")
	}
}

func TestExportSARIF_SeverityMapping(t *testing.T) {
	result := &model.ScanResult{
		ProjectName: "sev-test",
		Issues: []model.Issue{
			{ID: "e1", Scanner: "s", Rule: "r1", Severity: model.SeverityError, File: "a.go", Line: 1, Message: "err", Category: model.CategoryBug},
			{ID: "w1", Scanner: "s", Rule: "r2", Severity: model.SeverityWarning, File: "b.go", Line: 2, Message: "warn", Category: model.CategoryBug},
			{ID: "i1", Scanner: "s", Rule: "r3", Severity: model.SeverityInfo, File: "c.go", Line: 3, Message: "info", Category: model.CategoryBug},
		},
	}

	var buf bytes.Buffer
	err := ExportSARIF(result, "dev", &buf)
	if err != nil {
		t.Fatalf("ExportSARIF: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	results := doc["runs"].([]interface{})[0].(map[string]interface{})["results"].([]interface{})

	expected := []string{"error", "warning", "note"}
	for i, exp := range expected {
		r := results[i].(map[string]interface{})
		if r["level"] != exp {
			t.Errorf("result %d: expected level %s, got %v", i, exp, r["level"])
		}
	}
}

func TestExportSARIF_RuleDeduplication(t *testing.T) {
	result := &model.ScanResult{
		ProjectName: "dedup",
		Issues: []model.Issue{
			{ID: "a", Scanner: "linter", Rule: "R1", Severity: model.SeverityWarning, File: "a.go", Line: 1, Message: "msg1", Category: model.CategoryStyle},
			{ID: "b", Scanner: "linter", Rule: "R1", Severity: model.SeverityWarning, File: "b.go", Line: 2, Message: "msg2", Category: model.CategoryStyle},
			{ID: "c", Scanner: "linter", Rule: "R2", Severity: model.SeverityWarning, File: "c.go", Line: 3, Message: "msg3", Category: model.CategoryStyle},
		},
	}

	var buf bytes.Buffer
	err := ExportSARIF(result, "dev", &buf)
	if err != nil {
		t.Fatalf("ExportSARIF: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	driver := doc["runs"].([]interface{})[0].(map[string]interface{})["tool"].(map[string]interface{})["driver"].(map[string]interface{})
	rules := driver["rules"].([]interface{})
	if len(rules) != 2 {
		t.Errorf("expected 2 rules (deduplicated), got %d", len(rules))
	}
}

func TestExportSARIF_ModuleInProperties(t *testing.T) {
	result := &model.ScanResult{
		ProjectName: "module-test",
		Issues: []model.Issue{
			{ID: "m1", Scanner: "s", Rule: "r", Severity: model.SeverityError, File: "a.go", Line: 1, Message: "with module", Category: model.CategoryBug, Module: "github.com/example/mod"},
			{ID: "m2", Scanner: "s", Rule: "r", Severity: model.SeverityError, File: "b.go", Line: 2, Message: "no module", Category: model.CategoryBug},
		},
	}

	var buf bytes.Buffer
	err := ExportSARIF(result, "dev", &buf)
	if err != nil {
		t.Fatalf("ExportSARIF: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	results := doc["runs"].([]interface{})[0].(map[string]interface{})["results"].([]interface{})

	r0 := results[0].(map[string]interface{})["properties"].(map[string]interface{})
	if r0["module"] != "github.com/example/mod" {
		t.Errorf("expected module on first result, got %v", r0["module"])
	}

	r1 := results[1].(map[string]interface{})["properties"].(map[string]interface{})
	if _, ok := r1["module"]; ok {
		t.Error("unexpected module on second result")
	}
}

func TestExportSARIF_InvalidOutputFmt(t *testing.T) {
	var buf bytes.Buffer
	if err := ExportSARIF(&model.ScanResult{ProjectName: "x"}, "dev", &buf); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"$schema"`) {
		t.Error("output should start with $schema")
	}
}
