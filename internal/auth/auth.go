// Package auth implements account storage, password hashing, login sessions
// and passkey (WebAuthn) credentials for service mode.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"golang.org/x/crypto/bcrypt"
)

const (
	// SessionTTL is how long a login stays valid.
	SessionTTL = 7 * 24 * time.Hour

	minPasswordLen = 8
	// bcrypt silently ignores bytes past 72, so longer passwords are rejected
	// rather than truncated.
	maxPasswordLen = 72

	maxFailures   = 5
	failureWindow = time.Minute
)

// bcryptCost is a variable so tests can lower it.
var bcryptCost = 12

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrSetupDone          = errors.New("an account already exists")
	ErrBadSetupToken      = errors.New("invalid setup token")
	ErrTooManyAttempts    = errors.New("too many failed attempts, try again in a minute")
	ErrPasskeyNotFound    = errors.New("passkey not found")
)

// Passkey is a WebAuthn credential registered by a user.
type Passkey struct {
	Name       string              `json:"name"`
	AddedAt    time.Time           `json:"added_at"`
	LastUsedAt time.Time           `json:"last_used_at,omitzero"`
	Credential webauthn.Credential `json:"credential"`
}

// User is a gopolice account. It implements webauthn.User.
type User struct {
	ID           []byte    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash []byte    `json:"password_hash"`
	CreatedAt    time.Time `json:"created_at"`
	Passkeys     []Passkey `json:"passkeys,omitempty"`
}

func (u *User) WebAuthnID() []byte          { return u.ID }
func (u *User) WebAuthnName() string        { return u.Username }
func (u *User) WebAuthnDisplayName() string { return u.Username }
func (u *User) WebAuthnCredentials() []webauthn.Credential {
	creds := make([]webauthn.Credential, len(u.Passkeys))
	for i, p := range u.Passkeys {
		creds[i] = p.Credential
	}
	return creds
}

type session struct {
	userID  string
	expires time.Time
}

type failure struct {
	count int
	reset time.Time
}

// Manager owns the account file and the in-memory sessions.
type Manager struct {
	path string

	mu       sync.Mutex
	users    []*User
	sessions map[string]session // sha256(token) -> session
	failures map[string]*failure
	// ceremonies holds in-flight WebAuthn registrations/logins.
	ceremonies map[string]ceremony

	// os, when set, replaces local accounts: the only account is the OS user
	// the service runs as, verified by the operating system.
	os *OSBackend

	// SetupToken, when non-empty, must accompany the first-run account
	// creation. It is used when the service is reachable beyond loopback so
	// that nobody else can claim the instance first.
	SetupToken string
}

// NewManager loads the account file at path (creating nothing on disk until
// the first account is made).
func NewManager(path string) (*Manager, error) {
	m := &Manager{
		path:       path,
		sessions:   make(map[string]session),
		failures:   make(map[string]*failure),
		ceremonies: make(map[string]ceremony),
	}
	data, err := os.ReadFile(path) //nolint:gosec // path is the app's own account file
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, fmt.Errorf("read accounts: %w", err)
	default:
		if err := json.Unmarshal(data, &m.users); err != nil {
			return nil, fmt.Errorf("parse accounts %s: %w", path, err)
		}
	}
	return m, nil
}

// NeedsSetup reports whether no account exists yet. It is never true in OS
// mode, where there are no app accounts to create.
func (m *Manager) NeedsSetup() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.os == nil && len(m.users) == 0
}

func (m *Manager) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(m.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m.users, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand: %v", err))
	}
	return b
}

// RandomToken returns a URL-safe random string with 256 bits of entropy.
func RandomToken() string {
	return base64.RawURLEncoding.EncodeToString(randomBytes(32))
}

func tokenKey(token string) string {
	h := sha256.Sum256([]byte(token))
	return string(h[:])
}

func validatePassword(pw string) error {
	if len(pw) < minPasswordLen {
		return fmt.Errorf("password must be at least %d characters", minPasswordLen)
	}
	if len(pw) > maxPasswordLen {
		return fmt.Errorf("password must be at most %d bytes", maxPasswordLen)
	}
	return nil
}

// Setup creates the first account. It fails once any account exists.
func (m *Manager) Setup(username, password, token string) (*User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}
	if err := validatePassword(password); err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.os != nil || len(m.users) > 0 {
		return nil, ErrSetupDone
	}
	if m.SetupToken != "" && subtle.ConstantTimeCompare([]byte(token), []byte(m.SetupToken)) != 1 {
		return nil, ErrBadSetupToken
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return nil, err
	}
	u := &User{
		ID:           randomBytes(32),
		Username:     username,
		PasswordHash: hash,
		CreatedAt:    time.Now().UTC(),
	}
	m.users = append(m.users, u)
	if err := m.saveLocked(); err != nil {
		m.users = nil
		return nil, fmt.Errorf("save account: %w", err)
	}
	return u, nil
}

// dummyHash lets a login for an unknown user cost as much as a real one.
var dummyHash = sync.OnceValue(func() []byte {
	h, _ := bcrypt.GenerateFromPassword([]byte("gopolice-dummy"), bcryptCost)
	return h
})

func (m *Manager) throttled(key string) bool {
	f := m.failures[key]
	if f == nil {
		return false
	}
	if time.Now().After(f.reset) {
		delete(m.failures, key)
		return false
	}
	return f.count >= maxFailures
}

func (m *Manager) recordFailure(key string) {
	f := m.failures[key]
	if f == nil || time.Now().After(f.reset) {
		f = &failure{reset: time.Now().Add(failureWindow)}
		m.failures[key] = f
	}
	f.count++
}

// Login checks a username and password. clientKey (typically the remote IP)
// scopes the failed-attempt throttle.
func (m *Manager) Login(username, password, clientKey string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.os != nil {
		return nil, ErrOSMode
	}
	if m.throttled(clientKey) {
		return nil, ErrTooManyAttempts
	}
	var user *User
	for _, u := range m.users {
		if strings.EqualFold(u.Username, strings.TrimSpace(username)) {
			user = u
			break
		}
	}
	hash := dummyHash()
	if user != nil {
		hash = user.PasswordHash
	}
	err := bcrypt.CompareHashAndPassword(hash, []byte(password))
	if user == nil || err != nil {
		m.recordFailure(clientKey)
		return nil, ErrInvalidCredentials
	}
	delete(m.failures, clientKey)
	return user, nil
}

// ChangePassword replaces the password after verifying the current one.
func (m *Manager) ChangePassword(user *User, current, next string) error {
	if err := validatePassword(next); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if bcrypt.CompareHashAndPassword(user.PasswordHash, []byte(current)) != nil {
		return ErrInvalidCredentials
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(next), bcryptCost)
	if err != nil {
		return err
	}
	old := user.PasswordHash
	user.PasswordHash = hash
	if err := m.saveLocked(); err != nil {
		user.PasswordHash = old
		return err
	}
	// Sign out every other session.
	m.sessions = make(map[string]session)
	return nil
}

// NewSession issues a session token for user.
func (m *Manager) NewSession(user *User) (token string, expires time.Time) {
	token = RandomToken()
	expires = time.Now().Add(SessionTTL)
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for k, s := range m.sessions {
		if now.After(s.expires) {
			delete(m.sessions, k)
		}
	}
	m.sessions[tokenKey(token)] = session{userID: string(user.ID), expires: expires}
	return token, expires
}

// UserForSession returns the account a token belongs to, or nil.
func (m *Manager) UserForSession(token string) *User {
	if token == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[tokenKey(token)]
	if !ok {
		return nil
	}
	if time.Now().After(s.expires) {
		delete(m.sessions, tokenKey(token))
		return nil
	}
	return m.userByIDLocked(s.userID)
}

// EndSession invalidates a token.
func (m *Manager) EndSession(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, tokenKey(token))
}

func (m *Manager) userByIDLocked(id string) *User {
	if m.os != nil && string(m.os.user.ID) == id {
		return m.os.user
	}
	for _, u := range m.users {
		if string(u.ID) == id {
			return u
		}
	}
	return nil
}

// PasskeyInfo is the listing view of a passkey (no key material).
type PasskeyInfo struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	AddedAt    time.Time `json:"added_at"`
	LastUsedAt time.Time `json:"last_used_at,omitzero"`
}

// Passkeys lists user's registered passkeys.
func (m *Manager) Passkeys(user *User) []PasskeyInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]PasskeyInfo, 0, len(user.Passkeys))
	for _, p := range user.Passkeys {
		out = append(out, PasskeyInfo{
			ID:         base64.RawURLEncoding.EncodeToString(p.Credential.ID),
			Name:       p.Name,
			AddedAt:    p.AddedAt,
			LastUsedAt: p.LastUsedAt,
		})
	}
	return out
}

// DeletePasskey removes a passkey by its listing ID.
func (m *Manager) DeletePasskey(user *User, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range user.Passkeys {
		if base64.RawURLEncoding.EncodeToString(p.Credential.ID) == id {
			user.Passkeys = append(user.Passkeys[:i:i], user.Passkeys[i+1:]...)
			return m.saveLocked()
		}
	}
	return ErrPasskeyNotFound
}
