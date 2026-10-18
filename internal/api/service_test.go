package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/rapando/gopolice/internal/auth"
	"github.com/rapando/gopolice/internal/config"
	"github.com/rapando/gopolice/internal/projects"
)

type svc struct {
	t       *testing.T
	h       http.Handler
	cookies []*http.Cookie
}

func newSvc(t *testing.T) *svc {
	t.Helper()
	dir := t.TempDir()
	am, err := auth.NewManager(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	reg, err := projects.Open(filepath.Join(dir, "projects.json"))
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(config.DefaultConfig(), nil, "test", ServiceOptions{Auth: am, Registry: reg})
	return &svc{t: t, h: s.handler()}
}

func (c *svc) do(method, path string, body any) *httptest.ResponseRecorder {
	c.t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Host = "localhost:9393"
	req.RemoteAddr = "127.0.0.1:5000"
	for _, ck := range c.cookies {
		req.AddCookie(ck)
	}
	rec := httptest.NewRecorder()
	c.h.ServeHTTP(rec, req)
	if cs := rec.Result().Cookies(); len(cs) > 0 {
		c.cookies = cs
	}
	return rec
}

func TestServiceRequiresLogin(t *testing.T) {
	c := newSvc(t)

	for _, p := range []string{"/api/projects", "/api/fs/browse", "/api/projects/abc/results", "/api/config/global", "/api/version"} {
		if rec := c.do("GET", p, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s without login: got %d, want 401", p, rec.Code)
		}
	}
	if rec := c.do("POST", "/api/projects/abc/scan", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("scan without login: got %d", rec.Code)
	}

	var info sessionInfo
	rec := c.do("GET", "/api/session", nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if !info.SetupRequired || info.Authenticated || info.Mode != "service" {
		t.Fatalf("unexpected session info: %+v", info)
	}
}

func TestServiceSetupLoginProjects(t *testing.T) {
	c := newSvc(t)

	// Passkey login is meaningless before an account exists.
	if rec := c.do("POST", "/api/auth/passkey/login/begin", nil); rec.Code != http.StatusConflict {
		t.Errorf("passkey begin before setup: got %d", rec.Code)
	}

	rec := c.do("POST", "/api/auth/setup", map[string]string{"username": "sam", "password": "correct horse"})
	if rec.Code != http.StatusOK {
		t.Fatalf("setup: %d %s", rec.Code, rec.Body)
	}
	if rec := c.do("POST", "/api/auth/setup", map[string]string{"username": "x", "password": "correct horse"}); rec.Code != http.StatusConflict {
		t.Errorf("second setup: got %d", rec.Code)
	}

	// Logged in via the setup cookie.
	if rec := c.do("GET", "/api/projects", nil); rec.Code != http.StatusOK || rec.Body.String() != "[]\n" {
		t.Fatalf("projects: %d %q", rec.Code, rec.Body)
	}

	// Log out, then back in with the password.
	c.do("POST", "/api/auth/logout", nil)
	c.cookies = nil
	if rec := c.do("GET", "/api/projects", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("after logout: %d", rec.Code)
	}
	if rec := c.do("POST", "/api/auth/login", map[string]string{"username": "sam", "password": "bad"}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad login: %d", rec.Code)
	}
	if rec := c.do("POST", "/api/auth/login", map[string]string{"username": "sam", "password": "correct horse"}); rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}

	// Opening a non-Go folder is refused; a Go repo is saved.
	if rec := c.do("POST", "/api/projects", map[string]string{"path": t.TempDir()}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("non-go dir: got %d", rec.Code)
	}
	if rec := c.do("POST", "/api/projects", map[string]string{"path": "relative/path"}); rec.Code != http.StatusBadRequest {
		t.Errorf("relative path: got %d", rec.Code)
	}
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "go.mod"), []byte("module demo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec = c.do("POST", "/api/projects", map[string]string{"path": repo})
	if rec.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	var added projectView
	_ = json.Unmarshal(rec.Body.Bytes(), &added)

	// Project-scoped routes resolve; results are empty until a scan runs.
	if rec := c.do("GET", "/api/projects/"+added.ID+"/results", nil); rec.Code != http.StatusNotFound {
		t.Errorf("results before scan: got %d", rec.Code)
	}
	if rec := c.do("GET", "/api/projects/nope/results", nil); rec.Code != http.StatusNotFound {
		t.Errorf("unknown project: got %d", rec.Code)
	}
	// Un-prefixed routes have no default project in service mode.
	if rec := c.do("GET", "/api/results", nil); rec.Code != http.StatusNotFound {
		t.Errorf("default project: got %d", rec.Code)
	}

	// Browse lists sub-directories and flags Go projects.
	parent := filepath.Dir(repo)
	rec = c.do("GET", "/api/fs/browse?path="+parent, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("browse: %d %s", rec.Code, rec.Body)
	}
	var br struct {
		Entries []browseEntry `json:"entries"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &br)
	found := false
	for _, e := range br.Entries {
		if e.Path == repo && e.GoProject {
			found = true
		}
	}
	if !found {
		t.Errorf("browse did not list the go repo %s: %+v", repo, br.Entries)
	}

	if rec := c.do("DELETE", "/api/projects/"+added.ID, nil); rec.Code != http.StatusOK {
		t.Errorf("remove: %d", rec.Code)
	}
	if rec := c.do("GET", "/api/projects/"+added.ID+"/results", nil); rec.Code != http.StatusNotFound {
		t.Errorf("removed project still resolves: %d", rec.Code)
	}
}

func TestSingleModeNeedsNoLogin(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.TargetDir = t.TempDir()
	s := NewServer(cfg, nil, "test")
	h := s.handler()

	req := httptest.NewRequest("GET", "/api/session", nil)
	req.Host = "localhost:9393"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var info sessionInfo
	_ = json.Unmarshal(rec.Body.Bytes(), &info)
	if info.Mode != "single" || !info.Authenticated || info.AuthRequired {
		t.Fatalf("unexpected: %+v", info)
	}

	req = httptest.NewRequest("GET", "/api/results", nil)
	req.Host = "localhost:9393"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound { // no scan yet, but not 401
		t.Fatalf("got %d", rec.Code)
	}
}

func TestHostGuardAllowedHosts(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := hostGuard([]string{"gopolice.lan"}, ok)
	for host, want := range map[string]int{
		"gopolice.lan:9393": http.StatusOK,
		"localhost:9393":    http.StatusOK,
		"evil.example:9393": http.StatusForbidden,
	} {
		req := httptest.NewRequest("GET", "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("%s: got %d, want %d", host, rec.Code, want)
		}
	}
}

func newOSSvc(t *testing.T, biometricOK bool) *svc {
	t.Helper()
	dir := t.TempDir()
	am, err := auth.NewManager(filepath.Join(dir, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	am.EnableOS("sam", &auth.OSBackend{
		VerifyPassword: func(_ context.Context, user, pw string) (bool, error) {
			return user == "sam" && pw == "mac password", nil
		},
		Biometric: func(context.Context, string) (bool, error) { return biometricOK, nil },
	})
	reg, err := projects.Open(filepath.Join(dir, "projects.json"))
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(config.DefaultConfig(), nil, "test", ServiceOptions{Auth: am, Registry: reg})
	return &svc{t: t, h: s.handler()}
}

func TestOSModePasswordLogin(t *testing.T) {
	c := newOSSvc(t, true)

	var info sessionInfo
	_ = json.Unmarshal(c.do("GET", "/api/session", nil).Body.Bytes(), &info)
	if !info.OSMode || info.OSUsername != "sam" || info.SetupRequired || info.Authenticated || !info.TouchID {
		t.Fatalf("unexpected session: %+v", info)
	}

	if rec := c.do("GET", "/api/projects", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d", rec.Code)
	}
	// No app accounts exist in OS mode.
	if rec := c.do("POST", "/api/auth/setup", map[string]string{"username": "x", "password": "long enough pw"}); rec.Code != http.StatusConflict {
		t.Errorf("setup in os mode: %d", rec.Code)
	}
	if rec := c.do("POST", "/api/auth/login", map[string]string{"username": "sam", "password": "wrong"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong password: %d", rec.Code)
	}
	// Only the service's own OS account may sign in.
	if rec := c.do("POST", "/api/auth/login", map[string]string{"username": "root", "password": "mac password"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("other user: %d", rec.Code)
	}
	if rec := c.do("POST", "/api/auth/login", map[string]string{"username": "sam", "password": "mac password"}); rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	if rec := c.do("GET", "/api/projects", nil); rec.Code != http.StatusOK {
		t.Errorf("authenticated: %d", rec.Code)
	}
	// App-account management is disabled.
	for _, p := range []string{"/api/auth/passkey/register/begin", "/api/auth/password", "/api/auth/passkey/login/begin"} {
		if rec := c.do("POST", p, nil); rec.Code != http.StatusConflict {
			t.Errorf("POST %s in os mode: %d, want 409", p, rec.Code)
		}
	}
}

func TestOSModeBiometric(t *testing.T) {
	// httptest requests come from 192.0.2.1 unless set; make them local.
	do := func(c *svc, mutate func(*http.Request)) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/auth/os/biometric", nil)
		req.Host = "localhost:9393"
		mutate(req)
		rec := httptest.NewRecorder()
		c.h.ServeHTTP(rec, req)
		return rec
	}

	c := newOSSvc(t, true)
	if rec := do(c, func(r *http.Request) { r.RemoteAddr = "127.0.0.1:5000" }); rec.Code != http.StatusOK {
		t.Errorf("local approve: %d %s", rec.Code, rec.Body)
	}
	if rec := do(c, func(r *http.Request) { r.RemoteAddr = "10.0.0.5:5000" }); rec.Code != http.StatusForbidden {
		t.Errorf("remote client: %d, want 403", rec.Code)
	}
	if rec := do(c, func(r *http.Request) {
		r.RemoteAddr = "127.0.0.1:5000"
		r.Header.Set("X-Forwarded-For", "203.0.113.9")
	}); rec.Code != http.StatusForbidden {
		t.Errorf("proxied client: %d, want 403", rec.Code)
	}

	denied := newOSSvc(t, false)
	if rec := do(denied, func(r *http.Request) { r.RemoteAddr = "127.0.0.1:5000" }); rec.Code != http.StatusUnauthorized {
		t.Errorf("local deny: %d, want 401", rec.Code)
	}
}
