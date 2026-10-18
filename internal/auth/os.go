package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"time"
)

// OSBackend verifies logins with the operating system instead of the app's
// own account file.
type OSBackend struct {
	user *User

	// VerifyPassword checks an OS account password.
	VerifyPassword func(ctx context.Context, username, password string) (bool, error)
	// Biometric asks the person at the machine to approve (Touch ID). Nil if
	// the platform has no such prompt.
	Biometric func(ctx context.Context, reason string) (bool, error)

	// prompt serialises Touch ID prompts so concurrent requests cannot stack
	// dialogs on the screen.
	prompt sync.Mutex
}

var (
	// ErrBiometricUnavailable means the OS prompt is not offered here.
	ErrBiometricUnavailable = errors.New("biometric sign-in is not available")
	ErrOSMode               = errors.New("accounts are managed by the operating system")
)

// EnableOS switches the manager to OS authentication for username, the only
// account that may sign in.
func (m *Manager) EnableOS(username string, b *OSBackend) {
	id := sha256.Sum256([]byte("os-user:" + username))
	b.user = &User{ID: id[:], Username: username}
	m.mu.Lock()
	m.os = b
	m.mu.Unlock()
}

// OSMode reports whether logins are verified by the operating system.
func (m *Manager) OSMode() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.os != nil
}

// OSUsername is the OS account allowed to sign in, or "".
func (m *Manager) OSUsername() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.os == nil {
		return ""
	}
	return m.os.user.Username
}

// BiometricAvailable reports whether the Touch ID prompt can be offered.
func (m *Manager) BiometricAvailable() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.os != nil && m.os.Biometric != nil
}

// LoginOS checks the OS account password. username must be the service's own
// OS account.
func (m *Manager) LoginOS(ctx context.Context, username, password, clientKey string) (*User, error) {
	m.mu.Lock()
	b := m.os
	if b == nil {
		m.mu.Unlock()
		return nil, ErrOSMode
	}
	if m.throttled(clientKey) {
		m.mu.Unlock()
		return nil, ErrTooManyAttempts
	}
	m.mu.Unlock()

	ok := false
	if username == b.user.Username {
		var err error
		ok, err = b.VerifyPassword(ctx, username, password)
		if err != nil {
			ok = false
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !ok {
		m.recordFailure(clientKey)
		return nil, ErrInvalidCredentials
	}
	delete(m.failures, clientKey)
	return b.user, nil
}

// LoginBiometric shows the OS Touch ID prompt on the machine. Callers must
// only allow it for requests from that machine.
func (m *Manager) LoginBiometric(ctx context.Context, clientKey string) (*User, error) {
	m.mu.Lock()
	b := m.os
	if b == nil || b.Biometric == nil {
		m.mu.Unlock()
		return nil, ErrBiometricUnavailable
	}
	if m.throttled(clientKey) {
		m.mu.Unlock()
		return nil, ErrTooManyAttempts
	}
	m.mu.Unlock()

	b.prompt.Lock()
	defer b.prompt.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 65*time.Second)
	defer cancel()
	ok, err := b.Biometric(ctx, "sign in to gopolice")

	m.mu.Lock()
	defer m.mu.Unlock()
	if err != nil || !ok {
		m.recordFailure(clientKey)
		return nil, ErrInvalidCredentials
	}
	delete(m.failures, clientKey)
	return b.user, nil
}
