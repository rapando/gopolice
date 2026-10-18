package api

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/rapando/gopolice/internal/auth"
	"github.com/rapando/gopolice/internal/history"
	"github.com/rapando/gopolice/internal/model"
	"github.com/rapando/gopolice/internal/projects"
)

const sessionCookie = "gopolice_session"

// maxBody caps JSON request bodies on the auth endpoints.
const maxBody = 64 << 10

func (s *Server) registerAuthRoutes() {
	s.mux.HandleFunc("POST /api/auth/setup", s.handleSetup)
	s.mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	s.mux.HandleFunc("POST /api/auth/os/biometric", s.handleBiometricLogin)
	s.mux.HandleFunc("POST /api/auth/password", s.handleChangePassword)
	s.mux.HandleFunc("POST /api/auth/passkey/login/begin", s.handlePasskeyLoginBegin)
	s.mux.HandleFunc("POST /api/auth/passkey/login/finish", s.handlePasskeyLoginFinish)
	s.mux.HandleFunc("POST /api/auth/passkey/register/begin", s.handlePasskeyRegisterBegin)
	s.mux.HandleFunc("POST /api/auth/passkey/register/finish", s.handlePasskeyRegisterFinish)
	s.mux.HandleFunc("GET /api/auth/passkeys", s.handlePasskeyList)
	s.mux.HandleFunc("DELETE /api/auth/passkeys/{id}", s.handlePasskeyDelete)
}

func (s *Server) registerProjectRoutes() {
	s.mux.HandleFunc("GET /api/projects", s.handleProjectList)
	s.mux.HandleFunc("POST /api/projects", s.handleProjectAdd)
	s.mux.HandleFunc("DELETE /api/projects/{pid}", s.handleProjectRemove)
	s.mux.HandleFunc("POST /api/projects/{pid}/open", s.handleProjectOpen)
	s.mux.HandleFunc("GET /api/fs/browse", s.handleBrowse)
}

// publicPath reports whether the path is reachable without a session: the UI
// itself (it renders the login screen), and the endpoints that create one.
func publicPath(path string) bool {
	if !strings.HasPrefix(path, "/api/") {
		return true
	}
	switch path {
	case "/api/health", "/api/session",
		"/api/auth/setup", "/api/auth/login", "/api/auth/os/biometric",
		"/api/auth/passkey/login/begin", "/api/auth/passkey/login/finish":
		return true
	}
	return false
}

func (s *Server) requireLogin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if publicPath(r.URL.Path) || s.currentUser(r) != nil {
			next.ServeHTTP(w, r)
			return
		}
		jsonError(w, http.StatusUnauthorized, "login required")
	})
}

func (s *Server) currentUser(r *http.Request) *auth.User {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	return s.auth.UserForSession(c.Value)
}

func relyingParty(r *http.Request) auth.RelyingParty {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return auth.RelyingParty{ID: hostOnly(r.Host), Origin: scheme + "://" + r.Host}
}

func clientKey(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user *auth.User) {
	token, expires := s.auth.NewSession(user)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
	})
}

type sessionInfo struct {
	// Mode is "service" (login, many repos) or "single" (one repo, no login).
	Mode          string `json:"mode"`
	AuthRequired  bool   `json:"auth_required"`
	Authenticated bool   `json:"authenticated"`
	SetupRequired bool   `json:"setup_required"`
	// SetupTokenRequired is true when first-run setup needs the token the
	// service printed on startup.
	SetupTokenRequired bool   `json:"setup_token_required,omitempty"`
	Username           string `json:"username,omitempty"`
	Version            string `json:"version"`
	// OSMode means the operating system verifies logins (macOS password or
	// Touch ID) and there are no app accounts, passkeys or app passwords.
	OSMode     bool   `json:"os_mode,omitempty"`
	OSUsername string `json:"os_username,omitempty"`
	// TouchID is offered only to requests coming from the machine itself,
	// because the prompt appears on its screen.
	TouchID bool `json:"touch_id,omitempty"`
}

func (s *Server) sessionInfo(r *http.Request) sessionInfo {
	if s.auth == nil {
		return sessionInfo{Mode: "single", Authenticated: true, Version: s.version}
	}
	info := sessionInfo{Mode: "service", AuthRequired: true, Version: s.version}
	if s.auth.OSMode() {
		info.OSMode = true
		info.OSUsername = s.auth.OSUsername()
		info.TouchID = s.auth.BiometricAvailable() && isLocalClient(r)
	}
	if s.auth.NeedsSetup() {
		info.SetupRequired = true
		info.SetupTokenRequired = s.auth.SetupToken != ""
		return info
	}
	if u := s.currentUser(r); u != nil {
		info.Authenticated = true
		info.Username = u.Username
	}
	return info
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, s.sessionInfo(r))
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		SetupToken string `json:"setup_token"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	user, err := s.auth.Setup(req.Username, req.Password, req.SetupToken)
	switch {
	case errors.Is(err, auth.ErrSetupDone):
		jsonError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, auth.ErrBadSetupToken):
		jsonError(w, http.StatusForbidden, err.Error())
		return
	case err != nil:
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.startSession(w, r, user)
	jsonResponse(w, http.StatusOK, s.sessionInfoFor(user))
}

func (s *Server) sessionInfoFor(u *auth.User) sessionInfo {
	return sessionInfo{
		Mode: "service", AuthRequired: true, Authenticated: true, Username: u.Username, Version: s.version,
		OSMode: s.auth.OSMode(), OSUsername: s.auth.OSUsername(),
	}
}

// isLocalClient reports whether the request comes from this machine
// directly. A proxy hop (X-Forwarded-For) disqualifies it, since the real
// client may be remote.
func isLocalClient(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") != "" || r.Header.Get("Forwarded") != "" {
		return false
	}
	ip := net.ParseIP(clientKey(r))
	return ip != nil && ip.IsLoopback()
}

// rejectInOSMode refuses account-management calls when the OS owns accounts.
func (s *Server) rejectInOSMode(w http.ResponseWriter) bool {
	if s.auth.OSMode() {
		jsonError(w, http.StatusConflict, "accounts are managed by the operating system")
		return true
	}
	return false
}

func (s *Server) handleBiometricLogin(w http.ResponseWriter, r *http.Request) {
	if !isLocalClient(r) {
		jsonError(w, http.StatusForbidden, "Touch ID is only available from the machine running the service")
		return
	}
	user, err := s.auth.LoginBiometric(r.Context(), clientKey(r))
	switch {
	case errors.Is(err, auth.ErrBiometricUnavailable):
		jsonError(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, auth.ErrTooManyAttempts):
		jsonError(w, http.StatusTooManyRequests, err.Error())
		return
	case err != nil:
		jsonError(w, http.StatusUnauthorized, "Touch ID was not approved")
		return
	}
	s.startSession(w, r, user)
	jsonResponse(w, http.StatusOK, s.sessionInfoFor(user))
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	var user *auth.User
	var err error
	if s.auth.OSMode() {
		user, err = s.auth.LoginOS(r.Context(), req.Username, req.Password, clientKey(r))
	} else {
		user, err = s.auth.Login(req.Username, req.Password, clientKey(r))
	}
	switch {
	case errors.Is(err, auth.ErrTooManyAttempts):
		jsonError(w, http.StatusTooManyRequests, err.Error())
		return
	case err != nil:
		jsonError(w, http.StatusUnauthorized, err.Error())
		return
	}
	s.startSession(w, r, user)
	jsonResponse(w, http.StatusOK, s.sessionInfoFor(user))
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.auth.EndSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	jsonResponse(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if s.rejectInOSMode(w) {
		return
	}
	user := s.currentUser(r)
	if user == nil {
		jsonError(w, http.StatusUnauthorized, "login required")
		return
	}
	var req struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if err := s.auth.ChangePassword(user, req.Current, req.New); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, auth.ErrInvalidCredentials) {
			status = http.StatusForbidden
		}
		jsonError(w, status, err.Error())
		return
	}
	// ChangePassword signs every session out, including this one.
	s.startSession(w, r, user)
	jsonResponse(w, http.StatusOK, map[string]string{"status": "changed"})
}

func (s *Server) handlePasskeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	if s.rejectInOSMode(w) {
		return
	}
	if s.auth.NeedsSetup() {
		jsonError(w, http.StatusConflict, "no account exists yet")
		return
	}
	options, id, err := s.auth.BeginPasskeyLogin(relyingParty(r))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"ceremony": id, "options": options})
}

func (s *Server) handlePasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	user, err := s.auth.FinishPasskeyLogin(relyingParty(r), r.URL.Query().Get("ceremony"), clientKey(r), r)
	switch {
	case errors.Is(err, auth.ErrTooManyAttempts):
		jsonError(w, http.StatusTooManyRequests, err.Error())
		return
	case err != nil:
		jsonError(w, http.StatusUnauthorized, err.Error())
		return
	}
	s.startSession(w, r, user)
	jsonResponse(w, http.StatusOK, s.sessionInfoFor(user))
}

func (s *Server) handlePasskeyRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if s.rejectInOSMode(w) {
		return
	}
	user := s.currentUser(r)
	if user == nil {
		jsonError(w, http.StatusUnauthorized, "login required")
		return
	}
	options, id, err := s.auth.BeginPasskeyRegistration(relyingParty(r), user)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"ceremony": id, "options": options})
}

func (s *Server) handlePasskeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if s.rejectInOSMode(w) {
		return
	}
	user := s.currentUser(r)
	if user == nil {
		jsonError(w, http.StatusUnauthorized, "login required")
		return
	}
	q := r.URL.Query()
	if err := s.auth.FinishPasskeyRegistration(relyingParty(r), user, q.Get("ceremony"), q.Get("name"), r); err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonResponse(w, http.StatusOK, s.auth.Passkeys(user))
}

func (s *Server) handlePasskeyList(w http.ResponseWriter, r *http.Request) {
	if s.rejectInOSMode(w) {
		return
	}
	user := s.currentUser(r)
	if user == nil {
		jsonError(w, http.StatusUnauthorized, "login required")
		return
	}
	jsonResponse(w, http.StatusOK, s.auth.Passkeys(user))
}

func (s *Server) handlePasskeyDelete(w http.ResponseWriter, r *http.Request) {
	if s.rejectInOSMode(w) {
		return
	}
	user := s.currentUser(r)
	if user == nil {
		jsonError(w, http.StatusUnauthorized, "login required")
		return
	}
	switch err := s.auth.DeletePasskey(user, r.PathValue("id")); {
	case errors.Is(err, auth.ErrPasskeyNotFound):
		jsonError(w, http.StatusNotFound, err.Error())
	case err != nil:
		jsonError(w, http.StatusInternalServerError, err.Error())
	default:
		jsonResponse(w, http.StatusOK, s.auth.Passkeys(user))
	}
}

// projectView is a saved project plus a summary of its latest scan.
type projectView struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	AddedAt   time.Time `json:"added_at"`
	OpenedAt  time.Time `json:"opened_at,omitzero"`
	Missing   bool      `json:"missing,omitempty"`
	Scanning  bool      `json:"scanning"`
	HasResult bool      `json:"has_result"`
	Issues    int       `json:"issues"`
	Errors    int       `json:"errors"`
	Grade     string    `json:"grade,omitempty"`
	ScanTime  time.Time `json:"scan_time,omitzero"`
	Branch    string    `json:"branch,omitempty"`
}

func (s *Server) projectView(saved projects.Project) projectView {
	v := projectView{ID: saved.ID, Name: saved.Name, Path: saved.Path, AddedAt: saved.AddedAt, OpenedAt: saved.OpenedAt}
	if info, err := os.Stat(saved.Path); err != nil || !info.IsDir() {
		v.Missing = true
		return v
	}
	p := s.getProject(saved.ID)
	if p == nil {
		return v
	}
	v.Scanning = p.scanning()
	if res := p.store.Get(); res != nil {
		v.HasResult = true
		v.Issues = len(res.Issues)
		for _, iss := range res.Issues {
			if iss.Severity == model.SeverityError {
				v.Errors++
			}
		}
		v.Grade = history.Grade(res.Issues)
		v.ScanTime = res.ScanTime
		if res.GitInfo != nil {
			v.Branch = res.GitInfo.Branch
		}
		if res.ProjectName != "" {
			v.Name = res.ProjectName
		}
	}
	return v
}

func (s *Server) handleProjectList(w http.ResponseWriter, r *http.Request) {
	saved := s.registry.List()
	views := make([]projectView, 0, len(saved))
	for _, p := range saved {
		views = append(views, s.projectView(p))
	}
	jsonResponse(w, http.StatusOK, views)
}

func (s *Server) handleProjectAdd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	path := strings.TrimSpace(req.Path)
	if path == "" {
		jsonError(w, http.StatusBadRequest, "path is required")
		return
	}
	if strings.HasPrefix(path, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	if !filepath.IsAbs(path) {
		jsonError(w, http.StatusBadRequest, "path must be absolute")
		return
	}
	saved, err := s.registry.Add(path)
	switch {
	case errors.Is(err, projects.ErrNotGoRepo):
		jsonError(w, http.StatusUnprocessableEntity, err.Error())
		return
	case err != nil:
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.registry.Touch(saved.ID)
	if saved, err = s.registry.Get(saved.ID); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonResponse(w, http.StatusCreated, s.projectView(saved))
}

func (s *Server) handleProjectOpen(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("pid")
	saved, err := s.registry.Get(id)
	if err != nil {
		jsonError(w, http.StatusNotFound, "project not found")
		return
	}
	s.registry.Touch(id)
	if touched, err := s.registry.Get(id); err == nil {
		saved = touched
	}
	jsonResponse(w, http.StatusOK, s.projectView(saved))
}

func (s *Server) handleProjectRemove(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("pid")
	if err := s.registry.Remove(id); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, projects.ErrNotFound) {
			status = http.StatusNotFound
		}
		jsonError(w, status, err.Error())
		return
	}
	s.dropProject(id)
	jsonResponse(w, http.StatusOK, map[string]string{"status": "removed"})
}

type browseEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	GoProject bool   `json:"go_project"`
}

// handleBrowse lists the sub-directories of a directory so the UI can offer a
// folder picker; the browser itself cannot reveal filesystem paths.
func (s *Server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = string(filepath.Separator)
		}
		path = home
	}
	if !filepath.IsAbs(path) {
		jsonError(w, http.StatusBadRequest, "path must be absolute")
		return
	}
	path = filepath.Clean(path)
	showHidden := r.URL.Query().Get("hidden") == "1"

	dirents, err := os.ReadDir(path)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "cannot read directory: "+filepath.Base(path))
		return
	}
	entries := make([]browseEntry, 0, len(dirents))
	for _, d := range dirents {
		if !showHidden && strings.HasPrefix(d.Name(), ".") {
			continue
		}
		full := filepath.Join(path, d.Name())
		isDir := d.IsDir()
		if d.Type()&os.ModeSymlink != 0 {
			if info, err := os.Stat(full); err == nil {
				isDir = info.IsDir()
			}
		}
		if !isDir {
			continue
		}
		entries = append(entries, browseEntry{Name: d.Name(), Path: full, GoProject: projects.IsGoProject(full)})
	}
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"path":       path,
		"parent":     parent,
		"go_project": projects.IsGoProject(path),
		"entries":    entries,
	})
}
