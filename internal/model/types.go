package model

import "time"

type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityInfo    Severity = "info"
)

type Category string

const (
	CategoryBug        Category = "bug"
	CategorySecurity   Category = "security"
	CategoryStyle      Category = "style"
	CategoryComplexity Category = "complexity"
	CategoryTest       Category = "test"
	CategoryPerf       Category = "performance"
	CategoryDeadCode   Category = "deadcode"
)

type Issue struct {
	ID       string     `json:"id"`
	Scanner  string     `json:"scanner"`
	Rule     string     `json:"rule"`
	Severity Severity   `json:"severity"`
	File     string     `json:"file"`
	Line     int        `json:"line"`
	Column   int        `json:"column"`
	Message  string     `json:"message"`
	Category Category   `json:"category"`
	Solution string     `json:"solution,omitempty"`
	Module   string     `json:"module,omitempty"`
	GitBlame *BlameInfo `json:"git_blame,omitempty"`
	// Value is the measured number behind the issue (cyclomatic complexity),
	// and Threshold the limit it exceeded, so the UI can sort and chart it
	// instead of parsing the message.
	Value     int `json:"value,omitempty"`
	Threshold int `json:"threshold,omitempty"`
}

type BlameInfo struct {
	Author string    `json:"author"`
	Email  string    `json:"email"`
	Commit string    `json:"commit"`
	Date   time.Time `json:"date"`
	Line   int       `json:"line"`
}

type TestResult struct {
	Packages []TestPackage `json:"packages"`
	Total    TestSummary   `json:"total"`
}

type TestPackage struct {
	Name     string        `json:"name"`
	Status   string        `json:"status"`
	Duration time.Duration `json:"duration"`
	Coverage float64       `json:"coverage"`
	Tests    []Test        `json:"tests"`
	Output   string        `json:"output,omitempty"`
}

type Test struct {
	Name     string        `json:"name"`
	Status   string        `json:"status"`
	Duration time.Duration `json:"duration"`
	Output   string        `json:"output,omitempty"`
	File     string        `json:"file,omitempty"`
	Line     int           `json:"line,omitempty"`
}

type TestSummary struct {
	Total   int `json:"total"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Skipped int `json:"skipped"`
}

type Dependency struct {
	Path     string `json:"path"`
	Version  string `json:"version"`
	Indirect bool   `json:"indirect"`
}

type DepEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type DepGraph struct {
	Edges []DepEdge `json:"edges"`
}

type TrendPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Errors    int       `json:"errors"`
	Warnings  int       `json:"warnings"`
	Infos     int       `json:"infos"`
	Grade     string    `json:"grade"`
	Coverage  float64   `json:"coverage"`
	BenchNSOp float64   `json:"bench_ns_op"`
}

type TrendsData struct {
	Points []TrendPoint `json:"points"`
}

type AuthorInfo struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Count int    `json:"count"`
}

type CommitInfo struct {
	Hash     string    `json:"hash"`
	Date     time.Time `json:"date"`
	Author   string    `json:"author"`
	Email    string    `json:"email"`
	Message  string    `json:"message"`
	Verified string    `json:"verified"`
}

type GitInfo struct {
	Branch      string       `json:"branch"`
	Commit      string       `json:"commit"`
	CommitTime  time.Time    `json:"commit_time"`
	AuthorCount int          `json:"author_count"`
	Authors     []AuthorInfo `json:"authors,omitempty"`
	Commits     []CommitInfo `json:"commits,omitempty"`
}

type FileStat struct {
	Path         string `json:"path"`
	Lines        int    `json:"lines"`
	CodeLines    int    `json:"code_lines"`
	CommentLines int    `json:"comment_lines"`
	BlankLines   int    `json:"blank_lines"`
}

type ScanResult struct {
	ProjectName string            `json:"project_name"`
	ScanTime    time.Time         `json:"scan_time"`
	Duration    time.Duration     `json:"duration"`
	Issues      []Issue           `json:"issues"`
	TestResults *TestResult       `json:"test_results,omitempty"`
	Benchmarks  []BenchmarkResult `json:"benchmarks,omitempty"`
	Profile     *ProfileData      `json:"profile,omitempty"`
	DepGraph    *DepGraph         `json:"dep_graph,omitempty"`
	Deps        []Dependency      `json:"deps,omitempty"`
	GitInfo     *GitInfo          `json:"git_info,omitempty"`
	FileStats   []FileStat        `json:"file_stats,omitempty"`
	TotalFiles  int               `json:"total_files"`
	GoFiles     int               `json:"go_files"`
	TotalLines  int               `json:"total_lines"`
	Modules     []string          `json:"modules,omitempty"`
	// Tools records whether each external tool a scanner relies on ran, so
	// "no issues" can be told apart from "nothing was checked".
	Tools []ToolStatus `json:"tools,omitempty"`
}

// Tool status values.
const (
	ToolRan     = "ran"
	ToolMissing = "missing"
	ToolFailed  = "failed"
)

// ToolStatus is one external tool's outcome in a scan.
type ToolStatus struct {
	Scanner  string `json:"scanner"`
	Tool     string `json:"tool"`
	Status   string `json:"status"`
	Findings int    `json:"findings"`
	Error    string `json:"error,omitempty"`
	// Install is the command that would make a missing tool available.
	Install string `json:"install,omitempty"`
}

// MergeToolStatus combines per-module tool outcomes into one entry per tool:
// findings add up, and a failure or a missing tool anywhere wins over ran.
func MergeToolStatus(lists ...[]ToolStatus) []ToolStatus {
	var out []ToolStatus
	index := map[string]int{}
	rank := map[string]int{ToolRan: 0, ToolFailed: 1, ToolMissing: 2}
	for _, list := range lists {
		for _, t := range list {
			i, ok := index[t.Tool]
			if !ok {
				index[t.Tool] = len(out)
				out = append(out, t)
				continue
			}
			out[i].Findings += t.Findings
			if rank[t.Status] > rank[out[i].Status] {
				out[i].Status = t.Status
				out[i].Error = t.Error
			}
		}
	}
	return out
}

type BenchmarkResult struct {
	Name        string        `json:"name"`
	Iterations  int           `json:"iterations"`
	TimePerOp   time.Duration `json:"time_per_op"`
	BytesPerOp  int64         `json:"bytes_per_op"`
	AllocsPerOp int64         `json:"allocs_per_op"`
}

type ProfileData struct {
	CPU []ProfileEntry `json:"cpu,omitempty"`
	Mem []ProfileEntry `json:"mem,omitempty"`
}

type ProfileEntry struct {
	Function string  `json:"function"`
	Flat     float64 `json:"flat"`
	FlatPct  float64 `json:"flat_pct"`
	Cum      float64 `json:"cum"`
	CumPct   float64 `json:"cum_pct"`
}
