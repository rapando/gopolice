package api

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/rapando/gopolice/internal/auth"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/fixer"
	"github.com/rapando/gopolice/internal/history"
	"github.com/rapando/gopolice/internal/model"
	"github.com/rapando/gopolice/internal/projects"
	"github.com/rapando/gopolice/internal/watcher"
)

// Server serves the web UI and API. It runs in one of two modes:
//
//   - single-project (gopolice scan / serve): one repository, no login, the
//     API lives at /api/...;
//   - service (gopolice service): any number of saved repositories, behind
//     a login, with project APIs at /api/projects/{id}/....
type Server struct {
	cfg     *config.Config
	mux     *http.ServeMux
	server  *http.Server
	uiFS    fs.FS
	version string

	listeners []net.Listener
	tlsConfig *tls.Config
	// allowedHosts are Host header values accepted in addition to loopback
	// names; set when the service is deliberately exposed on a network.
	allowedHosts []string

	// def is the project served at the un-prefixed /api/... routes
	// (single-project mode).
	def *project

	// Service mode only.
	auth     *auth.Manager
	registry *projects.Registry
	mu       sync.Mutex
	projects map[string]*project
}

// ServiceOptions configures service mode.
type ServiceOptions struct {
	Auth     *auth.Manager
	Registry *projects.Registry
	// AllowedHosts lists extra Host names (without port) the service answers to.
	AllowedHosts []string
	TLS          *tls.Config
}

func NewServer(cfg *config.Config, uiFS fs.FS, version string) *Server {
	return newServer(cfg, uiFS, nil, version)
}

func NewServerWithResult(cfg *config.Config, uiFS fs.FS, result *model.ScanResult, version string) *Server {
	return newServer(cfg, uiFS, result, version)
}

// NewService creates a multi-project server that requires login.
func NewService(cfg *config.Config, uiFS fs.FS, version string, opts ServiceOptions) *Server {
	s := &Server{
		cfg:          cfg,
		mux:          http.NewServeMux(),
		uiFS:         uiFS,
		version:      version,
		auth:         opts.Auth,
		registry:     opts.Registry,
		allowedHosts: opts.AllowedHosts,
		tlsConfig:    opts.TLS,
		projects:     make(map[string]*project),
	}
	s.registerRoutes()
	return s
}

func newServer(cfg *config.Config, uiFS fs.FS, result *model.ScanResult, version string) *Server {
	projectDir := cfg.TargetDir
	if projectDir == "" {
		projectDir = "."
	}
	absDir, _ := filepath.Abs(projectDir)

	def := newProject(projects.ID(absDir), filepath.Base(absDir), absDir, cfg)
	if result != nil {
		def.store.Set(result)
	}

	s := &Server{
		cfg:     cfg,
		mux:     http.NewServeMux(),
		uiFS:    uiFS,
		version: version,
		def:     def,
	}
	s.registerRoutes()
	return s
}

// route registers a project-scoped handler at the un-prefixed path (the
// default project) and under /api/projects/{pid}/.
func (s *Server) route(pattern string, h func(*project, http.ResponseWriter, *http.Request)) {
	method, path, _ := strings.Cut(pattern, " ")
	serve := func(w http.ResponseWriter, r *http.Request) {
		p := s.projectFor(r)
		if p == nil {
			if r.PathValue("pid") != "" {
				jsonError(w, http.StatusNotFound, "project not found")
			} else {
				jsonError(w, http.StatusNotFound, "no project selected")
			}
			return
		}
		h(p, w, r)
	}
	s.mux.HandleFunc(method+" "+path, serve)
	s.mux.HandleFunc(method+" /api/projects/{pid}"+strings.TrimPrefix(path, "/api"), serve)
}

// projectFor resolves the project a request addresses.
func (s *Server) projectFor(r *http.Request) *project {
	pid := r.PathValue("pid")
	if pid == "" {
		return s.def
	}
	return s.getProject(pid)
}

// getProject returns the live state for a saved project, creating it (and
// loading its cached result) on first use.
func (s *Server) getProject(id string) *project {
	if s.registry == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.projects[id]; ok {
		return p
	}
	saved, err := s.registry.Get(id)
	if err != nil {
		return nil
	}
	p := newProject(saved.ID, saved.Name, saved.Path, s.cfg)
	p.loadCached()
	s.projects[id] = p
	return p
}

func (s *Server) dropProject(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.projects, id)
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /api/version", s.handleVersion)
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.route("POST /api/scan", (*project).handleScan)
	s.route("GET /api/scan/status", (*project).handleScanStatus)
	s.route("GET /api/scan/progress", (*project).handleScanProgress)
	s.route("GET /api/results", (*project).handleGetResults)
	s.route("GET /api/results/issues", (*project).handleGetIssue)
	s.route("GET /api/results/tests", (*project).handleGetTests)
	s.route("GET /api/results/benchmarks", (*project).handleGetBenchmarks)
	s.route("GET /api/results/profile", (*project).handleGetProfile)
	s.route("GET /api/results/git", (*project).handleGetGit)
	s.route("GET /api/results/deps", (*project).handleGetDeps)
	s.route("GET /api/results/deps/graph", (*project).handleGetDepGraph)
	s.route("GET /api/config", (*project).handleGetMergedConfig)
	s.mux.HandleFunc("GET /api/config/global", s.handleGetGlobalConfig)
	s.mux.HandleFunc("PUT /api/config/global", s.handleUpdateGlobalConfig)
	s.route("POST /api/fix/batch", (*project).handleBatchFix)
	s.route("POST /api/fix/{id}", (*project).handleApplyFix)
	s.route("POST /api/fix/{id}/undo", (*project).handleUndoFix)
	s.route("GET /api/snippet", (*project).handleSnippet)
	s.route("GET /api/history", (*project).handleHistoryList)
	s.route("GET /api/history/trends", (*project).handleHistoryTrends)
	s.route("GET /api/history/entry/{id}", (*project).handleHistoryGet)
	s.route("GET /api/history/diff", (*project).handleHistoryDiff)
	s.route("DELETE /api/history/entry/{id}", (*project).handleHistoryDelete)

	if s.auth != nil {
		s.registerAuthRoutes()
	}
	if s.registry != nil {
		s.registerProjectRoutes()
	}
	s.mux.HandleFunc("GET /api/session", s.handleSession)
	s.mux.HandleFunc("GET /", s.handleStatic)
}

// Listen binds the UI to the loopback interfaces, starting at port and trying
// successive ports if it is taken. It returns the port actually bound; call
// Serve afterwards to start handling requests.
func (s *Server) Listen(port int) (int, error) {
	return s.ListenHost("", port)
}

// ListenHost is Listen on a specific host. An empty host means loopback only
// (both 127.0.0.1 and ::1).
func (s *Server) ListenHost(host string, port int) (int, error) {
	if port == 0 {
		port = config.DefaultPort
	}
	maxAttempts := 100
	for attempt := range maxAttempts {
		var listeners []net.Listener
		var err error
		if host == "" {
			listeners, err = listenLoopback(port + attempt)
		} else {
			var l net.Listener
			l, err = net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port+attempt)))
			if err == nil {
				listeners = []net.Listener{l}
			}
		}
		if err == nil {
			if s.tlsConfig != nil {
				for i, l := range listeners {
					listeners[i] = tls.NewListener(l, s.tlsConfig)
				}
			}
			s.listeners = listeners
			s.server = &http.Server{
				Handler:           s.handler(),
				ReadHeaderTimeout: 10 * time.Second,
			}
			return port + attempt, nil
		}
		if !isAddrInUse(err) {
			return 0, err
		}
	}
	return 0, fmt.Errorf("no available port found after %d attempts", maxAttempts)
}

// handler wraps the mux with the host/origin guard and, in service mode, the
// login requirement.
func (s *Server) handler() http.Handler {
	h := http.Handler(s.mux)
	if s.auth != nil {
		h = s.requireLogin(h)
	}
	return hostGuard(s.allowedHosts, h)
}

// listenLoopback binds port on both 127.0.0.1 and ::1, since "localhost" may
// resolve to either. Binding only one would let another process holding the
// other address (or a wildcard bind, which some platforms allow alongside a
// specific one) answer requests meant for us. ::1 is skipped if the host has
// no IPv6 loopback.
func listenLoopback(port int) ([]net.Listener, error) {
	p := strconv.Itoa(port)
	v4, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", p))
	if err != nil {
		return nil, err
	}
	v6, err := net.Listen("tcp", net.JoinHostPort("::1", p))
	if err != nil {
		if isAddrInUse(err) {
			_ = v4.Close()
			return nil, err
		}
		return []net.Listener{v4}, nil
	}
	return []net.Listener{v4, v6}, nil
}

// Serve handles requests on the listeners bound by Listen until Shutdown is
// called, in which case it returns nil.
func (s *Server) Serve() error {
	if len(s.listeners) == 0 {
		return errors.New("server not listening: call Listen first")
	}
	errCh := make(chan error, len(s.listeners))
	for _, l := range s.listeners {
		go func() { errCh <- s.server.Serve(l) }()
	}
	var firstErr error
	for range s.listeners {
		if err := <-errCh; !errors.Is(err, http.ErrServerClosed) && firstErr == nil {
			firstErr = err
			_ = s.server.Close()
		}
	}
	return firstErr
}

func isAddrInUse(err error) bool {
	if opErr, ok := err.(*net.OpError); ok {
		if sysErr, ok := opErr.Err.(*os.SyscallError); ok {
			return errors.Is(sysErr.Err, syscall.EADDRINUSE)
		}
	}
	return false
}

// Watch re-scans the default project whenever its .go files change
// (single-project mode).
func (s *Server) Watch(debounce time.Duration) (*watcher.Watcher, error) {
	if s.def == nil {
		return nil, errors.New("watch is only available in single-project mode")
	}
	p := s.def
	w, err := watcher.New(p.dir, debounce, func() {
		p.TriggerScan(context.Background())
	})
	if err != nil {
		return nil, err
	}
	w.Start()
	log.Printf("watching .go files in %s (debounce %v)", p.dir, debounce)
	return w, nil
}

// SetResult replaces the default project's result (single-project mode).
func (s *Server) SetResult(result *model.ScanResult) {
	if s.def != nil {
		s.def.store.Set(result)
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server != nil {
		return s.server.Shutdown(ctx)
	}
	return nil
}

// localOnlyMiddleware is hostGuard with no extra allowed hosts.
func localOnlyMiddleware(next http.Handler) http.Handler {
	return hostGuard(nil, next)
}

// hostGuard restricts the API to the embedded UI. The server can modify
// source files (fixes) and run commands (scans), so it must not be reachable
// from other websites the user happens to have open:
//   - the Host header must be a loopback name (or one explicitly allowed),
//     which blocks DNS rebinding;
//   - state-changing requests must not come from a different origin, which
//     blocks cross-site form posts and no-cors fetches.
//
// No CORS headers are sent, so browsers keep their same-origin protections.
func hostGuard(allowed []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackHost(r.Host) && !hostAllowed(allowed, r.Host) {
			jsonError(w, http.StatusForbidden, "forbidden host")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				jsonError(w, http.StatusForbidden, "cross-site request rejected")
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Host != r.Host {
					jsonError(w, http.StatusForbidden, "cross-origin request rejected")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func hostAllowed(allowed []string, hostport string) bool {
	host := hostOnly(hostport)
	for _, a := range allowed {
		if strings.EqualFold(a, host) {
			return true
		}
	}
	return false
}

func hostOnly(hostport string) string {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return strings.Trim(host, "[]")
}

func isLoopbackHost(hostport string) bool {
	host := hostOnly(hostport)
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	jsonResponse(w, status, map[string]string{"error": msg})
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	// project_dir lets the UI build "open in editor" links from relative paths.
	resp := map[string]string{"version": s.version}
	if s.def != nil {
		resp["project_dir"] = s.def.dir
	}
	jsonResponse(w, http.StatusOK, resp)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (p *project) handleScan(w http.ResponseWriter, r *http.Request) {
	go p.runScan(context.Background())
	jsonResponse(w, http.StatusAccepted, map[string]string{"status": "scan_started"})
}

// handleScanProgress returns the current scan's recorded events as JSON, for
// clients that want a snapshot instead of a stream.
func (p *project) handleScanProgress(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]any{
		"scanning": p.scanning(),
		"events":   p.log.snapshot(),
	})
}

func (p *project) handleScanStatus(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		jsonError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Replay what this scan has reported so far, then stream the rest.
	recorded, ch := p.log.attach()
	defer p.log.detach(ch)
	for _, event := range recorded {
		data, _ := json.Marshal(event)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
	}
	flusher.Flush()

	for {
		select {
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (p *project) handleGetResults(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results available")
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func (p *project) handleGetIssue(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id != "" {
		result := p.store.Get()
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
		return
	}

	result := p.store.Get()
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

func (p *project) handleGetTests(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil || result.TestResults == nil {
		jsonError(w, http.StatusNotFound, "no test results available")
		return
	}
	jsonResponse(w, http.StatusOK, result.TestResults)
}

func (p *project) handleGetBenchmarks(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil || result.Benchmarks == nil {
		jsonError(w, http.StatusNotFound, "no benchmark results available")
		return
	}
	jsonResponse(w, http.StatusOK, result.Benchmarks)
}

func (p *project) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil || result.Profile == nil {
		jsonError(w, http.StatusNotFound, "no profile data available")
		return
	}
	jsonResponse(w, http.StatusOK, result.Profile)
}

func (p *project) handleGetGit(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil || result.GitInfo == nil {
		jsonError(w, http.StatusNotFound, "no git info available")
		return
	}
	jsonResponse(w, http.StatusOK, result.GitInfo)
}

func (p *project) handleGetDeps(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil || result.Deps == nil {
		jsonError(w, http.StatusNotFound, "no dependency info available")
		return
	}
	jsonResponse(w, http.StatusOK, result.Deps)
}

func (p *project) handleGetDepGraph(w http.ResponseWriter, r *http.Request) {
	result := p.store.Get()
	if result == nil || result.DepGraph == nil {
		jsonError(w, http.StatusNotFound, "no dependency graph available")
		return
	}
	jsonResponse(w, http.StatusOK, result.DepGraph)
}

func (p *project) handleGetMergedConfig(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, p.cfg)
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

func (p *project) handleApplyFix(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result := p.store.Get()
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

	fixResult, err := fixer.ApplyFix(issue, p.dir)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, fixResult)
}

func (p *project) handleUndoFix(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result := p.store.Get()
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

	if err := fixer.UndoFix(issue, p.dir); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"status": "undone"})
}

type batchFixRequest struct {
	IssueIDs []string `json:"issue_ids"`
}

type batchFixResult struct {
	ID      string `json:"id"`
	Applied bool   `json:"applied"`
	Message string `json:"message"`
}

func (p *project) handleBatchFix(w http.ResponseWriter, r *http.Request) {
	var req batchFixRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result := p.store.Get()
	if result == nil {
		jsonError(w, http.StatusNotFound, "no scan results")
		return
	}

	issueMap := make(map[string]*model.Issue, len(result.Issues))
	for i := range result.Issues {
		issueMap[result.Issues[i].ID] = &result.Issues[i]
	}

	results := make([]batchFixResult, 0, len(req.IssueIDs))
	for _, id := range req.IssueIDs {
		issue, ok := issueMap[id]
		if !ok {
			results = append(results, batchFixResult{ID: id, Applied: false, Message: "issue not found"})
			continue
		}
		fixResult, err := fixer.ApplyFix(issue, p.dir)
		if err != nil {
			results = append(results, batchFixResult{ID: id, Applied: false, Message: err.Error()})
			continue
		}
		results = append(results, batchFixResult{ID: id, Applied: fixResult.Applied, Message: fixResult.Message})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{"results": results})
}

func (p *project) handleSnippet(w http.ResponseWriter, r *http.Request) {
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
	fullPath := filepath.Join(p.dir, file)
	projectRoot := filepath.Clean(p.dir) + string(filepath.Separator)
	if !strings.HasPrefix(fullPath, projectRoot) && fullPath != filepath.Clean(p.dir) {
		jsonError(w, http.StatusBadRequest, "invalid file path")
		return
	}
	data, err := os.ReadFile(fullPath) //nolint:gosec // path validated above
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

	snippet := make([]snippetLine, 0)
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

func (p *project) handleHistoryList(w http.ResponseWriter, r *http.Request) {
	entries, err := history.List(p.dir)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []history.Entry{}
	}
	jsonResponse(w, http.StatusOK, entries)
}

func (p *project) handleHistoryTrends(w http.ResponseWriter, r *http.Request) {
	trends, err := history.GetTrends(p.dir)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if trends == nil {
		trends = &model.TrendsData{Points: []model.TrendPoint{}}
	}
	jsonResponse(w, http.StatusOK, trends)
}

func (p *project) handleHistoryGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result, err := history.Load(p.dir, id)
	if err != nil {
		jsonError(w, http.StatusNotFound, "history entry not found")
		return
	}
	jsonResponse(w, http.StatusOK, result)
}

func (p *project) handleHistoryDiff(w http.ResponseWriter, r *http.Request) {
	fromID := r.URL.Query().Get("from")
	toID := r.URL.Query().Get("to")
	if fromID == "" || toID == "" {
		jsonError(w, http.StatusBadRequest, "from and to query params required")
		return
	}
	from, err := history.Load(p.dir, fromID)
	if err != nil {
		jsonError(w, http.StatusNotFound, "from entry not found")
		return
	}
	to, err := history.Load(p.dir, toID)
	if err != nil {
		jsonError(w, http.StatusNotFound, "to entry not found")
		return
	}
	diff := history.Diff(from, to)
	diff.From = fromID
	diff.To = toID
	jsonResponse(w, http.StatusOK, diff)
}

func (p *project) handleHistoryDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := history.Delete(p.dir, id); err != nil {
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
		_, _ = w.Write(data) //nolint:gosec // data is from embedded UI assets
		return
	}

	diskPath := filepath.Join("ui", "dist", path)
	if data, err := os.ReadFile(diskPath); err == nil { //nolint:gosec // local dev tool, path joined with "ui/dist"
		ct := mimeTypeByExtension(path)
		w.Header().Set("Content-Type", ct)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data) //nolint:gosec // embedded UI asset, not user data
		return
	}

	indexPath := filepath.Join("ui", "dist", "index.html")
	if data, err := os.ReadFile(indexPath); err == nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data) //nolint:gosec // UI asset from disk
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`
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
