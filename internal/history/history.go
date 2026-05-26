package history

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/model"
)

const tsFormat = "20060102T150405Z"

type Entry struct {
	ID          string            `json:"id"`
	Timestamp   time.Time         `json:"timestamp"`
	ProjectID   string            `json:"project_id"`
	ProjectName string            `json:"project_name"`
	TotalIssues int               `json:"total_issues"`
	TotalTests  int               `json:"total_tests"`
	Duration    time.Duration     `json:"duration"`
	Grade       string            `json:"grade,omitempty"`
	ScanResult  *model.ScanResult `json:"-"`
}

func gradeFromIssues(issues []model.Issue) string {
	var score int
	for _, iss := range issues {
		switch iss.Severity {
		case model.SeverityError:
			score += 10
		case model.SeverityWarning:
			score += 3
		default:
			score += 1
		}
	}
	switch {
	case score == 0:
		return "A"
	case score <= 15:
		return "B"
	case score <= 40:
		return "C"
	case score <= 80:
		return "D"
	default:
		return "F"
	}
}

type DiffResult struct {
	From      string        `json:"from"`
	To        string        `json:"to"`
	Resolved  []model.Issue `json:"resolved"`
	New       []model.Issue `json:"new"`
	Unchanged []model.Issue `json:"unchanged"`
}

func projectID(dir string) string {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "unknown"
	}
	h := sha256.Sum256([]byte(abs))
	return hex.EncodeToString(h[:12])
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return os.TempDir()
	}
	return home
}

func basePath(projectDir string) string {
	return filepath.Join(homeDir(), ".local", "share", "gopolice", projectID(projectDir))
}

func encodeTimestamp(t time.Time) string {
	return t.UTC().Format(tsFormat)
}

func decodeTimestamp(s string) (time.Time, error) {
	return time.Parse(tsFormat, s)
}

func Save(projectDir string, result *model.ScanResult) error {
	dir := basePath(projectDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create history dir: %w", err)
	}
	ts := encodeTimestamp(result.ScanTime)
	path := filepath.Join(dir, ts+".json")
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	return nil
}

func List(projectDir string) ([]Entry, error) {
	dir := basePath(projectDir)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read history dir: %w", err)
	}
	var result []Entry
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		ts, err := decodeTimestamp(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var sr model.ScanResult
		if err := json.Unmarshal(data, &sr); err != nil {
			continue
		}
		totalTests := 0
		if sr.TestResults != nil {
			totalTests = sr.TestResults.Total.Total
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		result = append(result, Entry{
			ID:          id,
			Timestamp:   ts,
			ProjectName: sr.ProjectName,
			TotalIssues: len(sr.Issues),
			TotalTests:  totalTests,
			Duration:    sr.Duration,
			Grade:       gradeFromIssues(sr.Issues),
			ScanResult:  &sr,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp.After(result[j].Timestamp)
	})
	return result, nil
}

func Load(projectDir string, ts string) (*model.ScanResult, error) {
	dir := basePath(projectDir)
	path := filepath.Join(dir, ts+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	var sr model.ScanResult
	if err := json.Unmarshal(data, &sr); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &sr, nil
}

func Delete(projectDir string, ts string) error {
	path := filepath.Join(basePath(projectDir), ts+".json")
	return os.Remove(path)
}

func GetTrends(projectDir string) (*model.TrendsData, error) {
	entries, err := List(projectDir)
	if err != nil {
		return nil, err
	}
	points := make([]model.TrendPoint, 0, len(entries))
	for _, e := range entries {
		if e.ScanResult == nil {
			continue
		}
		sr := e.ScanResult

		var errors, warnings, infos int
		for _, iss := range sr.Issues {
			switch iss.Severity {
			case model.SeverityError:
				errors++
			case model.SeverityWarning:
				warnings++
			default:
				infos++
			}
		}

		var coverage float64
		var covCount int
		if sr.TestResults != nil {
			for _, pkg := range sr.TestResults.Packages {
				if pkg.Coverage > 0 {
					coverage += pkg.Coverage
					covCount++
				}
			}
			if covCount > 0 {
				coverage /= float64(covCount)
			}
		}

		var benchNSOp float64
		if len(sr.Benchmarks) > 0 {
			var total float64
			for _, b := range sr.Benchmarks {
				total += float64(b.TimePerOp)
			}
			benchNSOp = total / float64(len(sr.Benchmarks))
		}

		points = append(points, model.TrendPoint{
			Timestamp: e.Timestamp,
			Errors:    errors,
			Warnings:  warnings,
			Infos:     infos,
			Grade:     e.Grade,
			Coverage:  coverage,
			BenchNSOp: benchNSOp,
		})
	}
	sort.Slice(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})
	return &model.TrendsData{Points: points}, nil
}

func Diff(from, to *model.ScanResult) *DiffResult {
	fromIDs := make(map[string]bool, len(from.Issues))
	for _, issue := range from.Issues {
		fromIDs[issue.ID] = true
	}
	toIDs := make(map[string]bool, len(to.Issues))
	for _, issue := range to.Issues {
		toIDs[issue.ID] = true
	}
	var resolved, newIssues, unchanged []model.Issue
	for _, issue := range from.Issues {
		if !toIDs[issue.ID] {
			resolved = append(resolved, issue)
		}
	}
	for _, issue := range to.Issues {
		if !fromIDs[issue.ID] {
			newIssues = append(newIssues, issue)
		} else {
			unchanged = append(unchanged, issue)
		}
	}
	return &DiffResult{
		Resolved:  resolved,
		New:       newIssues,
		Unchanged: unchanged,
	}
}
