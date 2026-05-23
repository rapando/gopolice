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

type GitInfo struct {
	Branch       string `json:"branch"`
	Commit       string `json:"commit"`
	CommitTime   time.Time `json:"commit_time"`
	AuthorCount  int    `json:"author_count"`
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
