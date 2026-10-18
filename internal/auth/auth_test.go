package auth

import (
	"errors"
	"path/filepath"
	"testing"
)

func init() { bcryptCost = 4 }

func newTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "auth.json")
	m, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	return m, path
}

func TestSetupAndLogin(t *testing.T) {
	m, path := newTestManager(t)
	if !m.NeedsSetup() {
		t.Fatal("fresh manager should need setup")
	}
	if _, err := m.Setup("sam", "short", ""); err == nil {
		t.Fatal("expected short password to be rejected")
	}
	if _, err := m.Setup("", "long-enough-pw", ""); err == nil {
		t.Fatal("expected empty username to be rejected")
	}
	if _, err := m.Setup("sam", "correct horse", ""); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if _, err := m.Setup("other", "correct horse", ""); !errors.Is(err, ErrSetupDone) {
		t.Fatalf("second setup: got %v, want ErrSetupDone", err)
	}

	if _, err := m.Login("sam", "wrong password", "1.1.1.1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password: got %v", err)
	}
	if _, err := m.Login("nobody", "correct horse", "1.1.1.1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("unknown user: got %v", err)
	}
	u, err := m.Login("SAM", "correct horse", "1.1.1.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	// Accounts survive a restart.
	m2, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	if m2.NeedsSetup() {
		t.Fatal("reloaded manager lost the account")
	}
	if _, err := m2.Login("sam", "correct horse", "2.2.2.2"); err != nil {
		t.Fatalf("login after reload: %v", err)
	}
	_ = u
}

func TestSetupToken(t *testing.T) {
	m, _ := newTestManager(t)
	m.SetupToken = "s3cret"
	if _, err := m.Setup("sam", "correct horse", "nope"); !errors.Is(err, ErrBadSetupToken) {
		t.Fatalf("got %v, want ErrBadSetupToken", err)
	}
	if _, err := m.Setup("sam", "correct horse", "s3cret"); err != nil {
		t.Fatalf("setup with token: %v", err)
	}
}

func TestSessions(t *testing.T) {
	m, _ := newTestManager(t)
	u, err := m.Setup("sam", "correct horse", "")
	if err != nil {
		t.Fatal(err)
	}
	if m.UserForSession("") != nil || m.UserForSession("bogus") != nil {
		t.Fatal("unknown token must not authenticate")
	}
	tok, _ := m.NewSession(u)
	if got := m.UserForSession(tok); got == nil || got.Username != "sam" {
		t.Fatalf("session lookup: %v", got)
	}
	m.EndSession(tok)
	if m.UserForSession(tok) != nil {
		t.Fatal("ended session still valid")
	}
}

func TestLoginThrottle(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Setup("sam", "correct horse", ""); err != nil {
		t.Fatal(err)
	}
	for range maxFailures {
		_, _ = m.Login("sam", "wrong password", "9.9.9.9")
	}
	// Even the right password is refused while throttled.
	if _, err := m.Login("sam", "correct horse", "9.9.9.9"); !errors.Is(err, ErrTooManyAttempts) {
		t.Fatalf("got %v, want ErrTooManyAttempts", err)
	}
	// Other clients are unaffected.
	if _, err := m.Login("sam", "correct horse", "8.8.8.8"); err != nil {
		t.Fatalf("other client: %v", err)
	}
}

func TestChangePasswordEndsSessions(t *testing.T) {
	m, _ := newTestManager(t)
	u, _ := m.Setup("sam", "correct horse", "")
	tok, _ := m.NewSession(u)
	if err := m.ChangePassword(u, "wrong", "brand new pw"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("got %v", err)
	}
	if err := m.ChangePassword(u, "correct horse", "brand new pw"); err != nil {
		t.Fatal(err)
	}
	if m.UserForSession(tok) != nil {
		t.Fatal("old session survived a password change")
	}
	if _, err := m.Login("sam", "brand new pw", "1.1.1.1"); err != nil {
		t.Fatalf("login with new password: %v", err)
	}
}
