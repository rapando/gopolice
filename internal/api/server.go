package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/cache"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/fixer"
	"github.com/rapando/gopolice/internal/history"
	"github.com/rapando/gopolice/internal/model"
	"github.com/rapando/gopolice/internal/scanner"
)

type Server struct {
	store       *Store
	broadcaster  *SSEBroadcaster
	config      *config.Config
	projectDir  string
	mux         *http.ServeMux
	server      *http.Server
	uiFS        fs.FS
	version     string
}

func NewServer(cfg *config.Config, uiFS fs.FS, version string) *Server {
	return newServer(cfg, uiFS, nil, version)
}

func NewServerWithResult(cfg *config.Config, uiFS fs.FS, result *model.ScanResult, version string) *Server {
	return newServer(cfg, uiFS, result, version)
}

func newServer(cfg *config.Config, uiFS fs.FS, result *model.ScanResult, version string) *Server {
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}
	absDir, _ := filepath.Abs(projectDir)

	store := NewStore()
	if result != nil {
		store.Set(result)
	}

	s := &Server{
		store:       store,
		broadcaster: NewSSEBroadcaster(),
		config:      cfg,
		projectDir:  absDir,
		mux:         http.NewServeMux(),
		uiFS:        uiFS,
		version:     version,
	}
	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /api/version", s.handleVersion)
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("POST /api/scan", s.handleScan)
	s.mux.HandleFunc("GET /api/scan/status", s.handleScanStatus)
	s.mux.HandleFunc("GET /api/results", s.handleGetResults)
	s.mux.HandleFunc("GET /api/results/issues", s.handleListIssues)
	s.mux.HandleFunc("GET /api/results/issues/{id}", s.handleGetIssue)
	s.mux.HandleFunc("GET /api/results/tests", s.handleGetTests)
	s.mux.HandleFunc("GET /api/results/benchmarks", s.handleGetBenchmarks)
	s.mux.HandleFunc("GET /api/results/git", s.handleGetGit)
	s.mux.HandleFunc("GET /api/results/deps", s.handleGetDeps)
	s.mux.HandleFunc("GET /api/config", s.handleGetMergedConfig)
	s.mux.HandleFunc("GET /api/config/global", s.handleGetGlobalConfig)
	s.mux.HandleFunc("PUT /api/config/global", s.handleUpdateGlobalConfig)
	s.mux.HandleFunc("POST /api/fix/{id}", s.handleApplyFix)
	s.mux.HandleFunc("POST /api/fix/{id}/undo", s.handleUndoFix)
	s.mux.HandleFunc("GET /api/snippet", s.handleSnippet)
	s.mux.HandleFunc("GET /api/history", s.handleHistoryList)
	s.mux.HandleFunc("GET /api/history/entry/{id}", s.handleHistoryGet)
	s.mux.HandleFunc("GET /api/history/diff", s.handleHistoryDiff)
	s.mux.HandleFunc("DELETE /api/history/entry/{id}", s.handleHistoryDelete)
	s.mux.HandleFunc("GET /", s.handleStatic)
}

func (s *Server) Start(port int) error {
	s.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: corsMiddleware(s.mux),
	}
	log.Printf("gopolice UI available at http://localhost:%d", port)
	return s.server.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server != nil {
		return s.server.Shutdown(ctx)
	}
	return nil
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	jsonResponse(w, status, map[string]string{"error": msg})
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"version": s.version})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	go s.runScan(context.Background())
	jsonResponse(w, http.StatusAccepted, map[string]string{"status": "scan_started"})
}

func (s *Server) runScan(ctx context.Context) {
	start := time.Now()
	s.broadcaster.Broadcast(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusStarted, Message: "Starting scan"})

	p := scanner.NewDefaultPipeline()
	progress := make(chan scanner.ProgressEvent, 100)
	done := make(chan *model.ScanResult, 1)

	go func() {
		result, err := p.Run(ctx, s.config, progress)
		if err != nil {
			s.broadcaster.Broadcast(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusFailed, Message: err.Error()})
			return
		}
		done <- result
	}()

	for {
		select {
		case event := <-progress:
			s.broadcaster.Broadcast(event)
		case result := <-done:
			result.ScanTime = start
			result.Duration = time.Since(start)
			s.store.Set(result)

			cachePath := cache.ResultPath(s.projectDir)
			if err := cache.Save(result, cachePath); err != nil {
				log.Printf("cache save: %v", err)
			}
			if err := history.Save(s.projectDir, result); err != nil {
				log.Printf("history save: %v", err)
			}

			s.broadcaster.Broadcast(scanner.ProgressEvent{
				Scanner: "pipeline",
				Status:  scanner.StatusCompleted,
				Message: fmt.Sprintf("Scan complete: %d issues found, took %v", len(result.Issues), result.Duration),
			})
			return
		case <-ctx.Done():
			s.broadcaster.Broadcast(scanner.ProgressEvent{Scanner: "pipeline", Status: scanner.StatusFailed, Message: "scan cancelled"})
			return
		}
	}
}

func (s *Server) handleScanStatus(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		jsonError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := s.broadcaster.Subscribe()
	defer s.broadcaster.Unsubscribe(ch)

	for {
		select {
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleGetResults(w http.ResponseWriter, r *http.Request) {
	result := s.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results available")
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func (s *Server) handleListIssues(w http.ResponseWriter, r *http.Request) {
	result := s.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results available")
		return
	}

	scannerFilter := r.URL.Query().Get("scanner")
	severityFilter := r.URL.Query().Get("severity")
	categoryFilter := r.URL.Query().Get("category")
	fileFilter := r.URL.Query().Get("file")

	issues := result.Issues
	if scannerFilter != "" {
		var filtered []model.Issue
		for _, issue := range issues {
			if issue.Scanner == scannerFilter {
				filtered = append(filtered, issue)
			}
		}
		issues = filtered
	}
	if severityFilter != "" {
		var filtered []model.Issue
		for _, issue := range issues {
			if string(issue.Severity) == severityFilter {
				filtered = append(filtered, issue)
			}
		}
		issues = filtered
	}
	if categoryFilter != "" {
		var filtered []model.Issue
		for _, issue := range issues {
			if string(issue.Category) == categoryFilter {
				filtered = append(filtered, issue)
			}
		}
		issues = filtered
	}
	if fileFilter != "" {
		var filtered []model.Issue
		for _, issue := range issues {
			if strings.Contains(issue.File, fileFilter) {
				filtered = append(filtered, issue)
			}
		}
		issues = filtered
	}

	if issues == nil {
		issues = []model.Issue{}
	}
	jsonResponse(w, http.StatusOK, issues)
}

func (s *Server) handleGetIssue(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result := s.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results available")
		return
	}
	for _, issue := range result.Issues {
		if issue.ID == id {
			jsonResponse(w, http.StatusOK, issue)
			return
		}
	}
	jsonError(w, http.StatusNotFound, "issue not found")
}

func (s *Server) handleGetTests(w http.ResponseWriter, r *http.Request) {
	result := s.store.Get()
	if result == nil || result.TestResults == nil {
		jsonError(w, http.StatusNotFound, "no test results available")
		return
	}
	jsonResponse(w, http.StatusOK, result.TestResults)
}

func (s *Server) handleGetBenchmarks(w http.ResponseWriter, r *http.Request) {
	result := s.store.Get()
	if result == nil || result.Benchmarks == nil {
		jsonError(w, http.StatusNotFound, "no benchmark results available")
		return
	}
	jsonResponse(w, http.StatusOK, result.Benchmarks)
}

func (s *Server) handleGetGit(w http.ResponseWriter, r *http.Request) {
	result := s.store.Get()
	if result == nil || result.GitInfo == nil {
		jsonError(w, http.StatusNotFound, "no git info available")
		return
	}
	jsonResponse(w, http.StatusOK, result.GitInfo)
}

func (s *Server) handleGetDeps(w http.ResponseWriter, r *http.Request) {
	result := s.store.Get()
	if result == nil || result.Deps == nil {
		jsonError(w, http.StatusNotFound, "no dependency info available")
		return
	}
	jsonResponse(w, http.StatusOK, result.Deps)
}

func (s *Server) handleGetMergedConfig(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, s.config)
}

func (s *Server) handleGetGlobalConfig(w http.ResponseWriter, r *http.Request) {
	path := config.GlobalConfigPath()
	cfg, err := config.LoadConfigFile(path)
	if err != nil {
		jsonResponse(w, http.StatusOK, config.DefaultConfig())
		return
	}
	jsonResponse(w, http.StatusOK, cfg)
}

func (s *Server) handleUpdateGlobalConfig(w http.ResponseWriter, r *http.Request) {
	var cfg config.Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		jsonError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON: %v", err))
		return
	}
	if err := config.SaveConfigFile(&cfg, config.GlobalConfigPath()); err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("save failed: %v", err))
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (s *Server) handleApplyFix(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result := s.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results")
		return
	}

	var issue *model.Issue
	for _, iss := range result.Issues {
		if iss.ID == id {
			issue = &iss
			break
		}
	}
	if issue == nil {
		jsonError(w, http.StatusNotFound, "issue not found")
		return
	}

	fixResult, err := fixer.ApplyFix(issue, s.projectDir)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, fixResult)
}

func (s *Server) handleUndoFix(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result := s.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results")
		return
	}

	var issue *model.Issue
	for _, iss := range result.Issues {
		if iss.ID == id {
			issue = &iss
			break
		}
	}
	if issue == nil {
		jsonError(w, http.StatusNotFound, "issue not found")
		return
	}

	if err := fixer.UndoFix(issue, s.projectDir); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "undone"})
}

func (s *Server) handleSnippet(w http.ResponseWriter, r *http.Request) {
	file := r.URL.Query().Get("file")
	lineStr := r.URL.Query().Get("line")
	ctxLines := 10

	if file == "" || lineStr == "" {
		jsonError(w, http.StatusBadRequest, "file and line parameters required")
		return
	}

	line, err := strconv.Atoi(lineStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "invalid line number")
		return
	}

	// Guard against path traversal (SAST: taint analysis flags user input reaching os.ReadFile).
	// The `file` param comes from client query string. Two checks ensure it cannot escape projectDir:
	//
	// 1. Normalisation check: filepath.Clean resolves "foo/../bar" → "bar" and strips ".//" etc.
	//    If cleaned != original, the path contained traversal segments. We also reject if ".."
	//    appears anywhere, catching patterns like ".." or "...." that survive or bypass Clean.
	//
	// 2. Prefix check: after joining with projectDir, the resolved path must still be within
	//    projectDir. This catches symlink-resolved escapes and edge cases Clean doesn't handle.
	cleaned := filepath.Clean(file)
	if cleaned != file || strings.Contains(file, "..") {
		jsonError(w, http.StatusBadRequest, "invalid file path")
		return
	}
	fullPath := filepath.Join(s.projectDir, file)
	projectRoot := filepath.Clean(s.projectDir) + string(filepath.Separator)
	if !strings.HasPrefix(fullPath, projectRoot) && fullPath != filepath.Clean(s.projectDir) {
		jsonError(w, http.StatusBadRequest, "invalid file path")
		return
	}
	data, err := os.ReadFile(fullPath)
	if err != nil {
		jsonError(w, http.StatusNotFound, fmt.Sprintf("file not found: %s", file))
		return
	}

	lines := strings.Split(string(data), "\n")
	totalLines := len(lines)

	start := line - ctxLines
	if start < 1 {
		start = 1
	}
	end := line + ctxLines
	if end > totalLines {
		end = totalLines
	}

	type snippetLine struct {
		Number  int    `json:"number"`
		Content string `json:"content"`
		IsIssue bool   `json:"is_issue"`
	}

	var snippet []snippetLine
	for i := start; i <= end; i++ {
		snippet = append(snippet, snippetLine{
			Number:  i,
			Content: lines[i-1],
			IsIssue: i == line,
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"file":        file,
		"line":        line,
		"total_lines": totalLines,
		"lines":       snippet,
	})
}

func (s *Server) handleHistoryList(w http.ResponseWriter, r *http.Request) {
	entries, err := history.List(s.projectDir)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []history.Entry{}
	}
	jsonResponse(w, http.StatusOK, entries)
}

func (s *Server) handleHistoryGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result, err := history.Load(s.projectDir, id)
	if err != nil {
		jsonError(w, http.StatusNotFound, "history entry not found")
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func (s *Server) handleHistoryDiff(w http.ResponseWriter, r *http.Request) {
	fromID := r.URL.Query().Get("from")
	toID := r.URL.Query().Get("to")
	if fromID == "" || toID == "" {
		jsonError(w, http.StatusBadRequest, "from and to query params required")
		return
	}
	from, err := history.Load(s.projectDir, fromID)
	if err != nil {
		jsonError(w, http.StatusNotFound, "from entry not found")
		return
	}
	to, err := history.Load(s.projectDir, toID)
	if err != nil {
		jsonError(w, http.StatusNotFound, "to entry not found")
		return
	}
	diff := history.Diff(from, to)
	diff.From = fromID
	diff.To = toID
	jsonResponse(w, http.StatusOK, diff)
}

func (s *Server) handleHistoryDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := history.Delete(s.projectDir, id); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}

	if s.uiFS != nil {
		data, err := fs.ReadFile(s.uiFS, path)
		if err != nil {
			data, err = fs.ReadFile(s.uiFS, "index.html")
			if err != nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
		}
		ct := mimeTypeByExtension(path)
		w.Header().Set("Content-Type", ct)
		w.WriteHeader(http.StatusOK)
		w.Write(data)
		return
	}

	diskPath := filepath.Join("ui", "dist", path)
	if data, err := os.ReadFile(diskPath); err == nil {
		ct := mimeTypeByExtension(path)
		w.Header().Set("Content-Type", ct)
		w.WriteHeader(http.StatusOK)
		w.Write(data)
		return
	}

	indexPath := filepath.Join("ui", "dist", "index.html")
	if data, err := os.ReadFile(indexPath); err == nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write(data)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`
<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2em;max-width:600px;margin:auto;text-align:center">
<h1>gopolice UI</h1>
<p>UI not built yet. Run:</p>
<pre style="background:#f5f5f5;padding:1em;border-radius:8px">
cd ui && npm install && npm run build
</pre>
<p>Then restart gopolice scan.</p>
</body></html>`))
}

func mimeTypeByExtension(path string) string {
	switch {
	case strings.HasSuffix(path, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(path, ".js"):
		return "application/javascript; charset=utf-8"
	case strings.HasSuffix(path, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(path, ".json"):
		return "application/json"
	case strings.HasSuffix(path, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	case strings.HasSuffix(path, ".ico"):
		return "image/x-icon"
	default:
		return "application/octet-stream"
	}
}
