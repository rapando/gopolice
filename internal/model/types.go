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
	ID       string   `json:"id"`
	Scanner  string   `json:"scanner"`
	Rule     string   `json:"rule"`
	Severity Severity `json:"severity"`
	File     string   `json:"file"`
	Line     int      `json:"line"`
	Column   int      `json:"column"`
	Message  string   `json:"message"`
	Category Category `json:"category"`
	Solution string   `json:"solution,omitempty"`
	GitBlame *BlameInfo `json:"git_blame,omitempty"`
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
	ProjectName string        `json:"project_name"`
	ScanTime    time.Time     `json:"scan_time"`
	Duration    time.Duration `json:"duration"`
	Issues      []Issue       `json:"issues"`
	TestResults *TestResult   `json:"test_results,omitempty"`
	Benchmarks  []BenchmarkResult `json:"benchmarks,omitempty"`
	Profile     *ProfileData      `json:"profile,omitempty"`
	DepGraph    *DepGraph         `json:"dep_graph,omitempty"`
	Deps        []Dependency  `json:"deps,omitempty"`
	GitInfo     *GitInfo      `json:"git_info,omitempty"`
	FileStats   []FileStat    `json:"file_stats,omitempty"`
	TotalFiles  int           `json:"total_files"`
	GoFiles     int           `json:"go_files"`
	TotalLines  int           `json:"total_lines"`
}

type BenchmarkResult struct {
	Name       string        `json:"name"`
	Iterations int           `json:"iterations"`
	TimePerOp  time.Duration `json:"time_per_op"`
	BytesPerOp int64         `json:"bytes_per_op"`
	AllocsPerOp int64        `json:"allocs_per_op"`
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
