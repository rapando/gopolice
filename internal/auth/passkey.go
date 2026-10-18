package auth

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

const ceremonyTTL = 5 * time.Minute

type ceremony struct {
	data    webauthn.SessionData
	userID  string // set for registrations
	expires time.Time
}

// RelyingParty identifies the site a passkey is bound to. A passkey only works
// for the host it was registered on, so this is derived from the request.
type RelyingParty struct {
	ID     string // host name without port, e.g. "localhost"
	Origin string // scheme://host[:port]
}

func (m *Manager) webauthn(rp RelyingParty) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID:          rp.ID,
		RPDisplayName: "gopolice",
		RPOrigins:     []string{rp.Origin},
	})
}

func (m *Manager) putCeremony(c ceremony) string {
	id := RandomToken()
	c.expires = time.Now().Add(ceremonyTTL)
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for k, v := range m.ceremonies {
		if now.After(v.expires) {
			delete(m.ceremonies, k)
		}
	}
	m.ceremonies[id] = c
	return id
}

// takeCeremony removes and returns a ceremony; each may be finished once.
func (m *Manager) takeCeremony(id string) (ceremony, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.ceremonies[id]
	delete(m.ceremonies, id)
	if !ok || time.Now().After(c.expires) {
		return ceremony{}, false
	}
	return c, true
}

// BeginPasskeyRegistration starts adding a passkey to user. The returned
// options go to navigator.credentials.create(); the ceremony ID comes back to
// FinishPasskeyRegistration.
func (m *Manager) BeginPasskeyRegistration(rp RelyingParty, user *User) (*protocol.CredentialCreation, string, error) {
	wa, err := m.webauthn(rp)
	if err != nil {
		return nil, "", err
	}
	m.mu.Lock()
	exclude := make([]protocol.CredentialDescriptor, 0, len(user.Passkeys))
	for _, p := range user.Passkeys {
		exclude = append(exclude, p.Credential.Descriptor())
	}
	m.mu.Unlock()

	creation, session, err := wa.BeginRegistration(user,
		// Discoverable credentials let the login page work without typing a
		// username, and a platform authenticator means the OS prompt
		// (Touch ID, Windows Hello, device PIN).
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			AuthenticatorAttachment: protocol.Platform,
			RequireResidentKey:      protocol.ResidentKeyRequired(),
			ResidentKey:             protocol.ResidentKeyRequirementRequired,
			UserVerification:        protocol.VerificationRequired,
		}),
		webauthn.WithExclusions(exclude),
	)
	if err != nil {
		return nil, "", err
	}
	id := m.putCeremony(ceremony{data: *session, userID: string(user.ID)})
	return creation, id, nil
}

// FinishPasskeyRegistration verifies the authenticator's response (the HTTP
// request body) and stores the new passkey under name.
func (m *Manager) FinishPasskeyRegistration(rp RelyingParty, user *User, ceremonyID, name string, r *http.Request) error {
	c, ok := m.takeCeremony(ceremonyID)
	if !ok || c.userID != string(user.ID) {
		return errors.New("passkey registration expired, try again")
	}
	wa, err := m.webauthn(rp)
	if err != nil {
		return err
	}
	cred, err := wa.FinishRegistration(user, c.data, r)
	if err != nil {
		return fmt.Errorf("verify passkey: %w", err)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Passkey"
	}
	if len(name) > 64 {
		name = name[:64]
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range user.Passkeys {
		if bytes.Equal(p.Credential.ID, cred.ID) {
			return errors.New("this passkey is already registered")
		}
	}
	user.Passkeys = append(user.Passkeys, Passkey{Name: name, AddedAt: time.Now().UTC(), Credential: *cred})
	if err := m.saveLocked(); err != nil {
		user.Passkeys = user.Passkeys[:len(user.Passkeys)-1]
		return fmt.Errorf("save passkey: %w", err)
	}
	return nil
}

// BeginPasskeyLogin starts a usernameless (discoverable) login.
func (m *Manager) BeginPasskeyLogin(rp RelyingParty) (*protocol.CredentialAssertion, string, error) {
	wa, err := m.webauthn(rp)
	if err != nil {
		return nil, "", err
	}
	assertion, session, err := wa.BeginDiscoverableLogin(
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		return nil, "", err
	}
	return assertion, m.putCeremony(ceremony{data: *session}), nil
}

// FinishPasskeyLogin verifies the assertion in r's body and returns the account.
func (m *Manager) FinishPasskeyLogin(rp RelyingParty, ceremonyID, clientKey string, r *http.Request) (*User, error) {
	m.mu.Lock()
	throttled := m.throttled(clientKey)
	m.mu.Unlock()
	if throttled {
		return nil, ErrTooManyAttempts
	}
	c, ok := m.takeCeremony(ceremonyID)
	if !ok {
		return nil, errors.New("passkey login expired, try again")
	}
	wa, err := m.webauthn(rp)
	if err != nil {
		return nil, err
	}

	var matched *User
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		m.mu.Lock()
		defer m.mu.Unlock()
		for _, u := range m.users {
			if !bytes.Equal(u.ID, userHandle) {
				continue
			}
			for _, p := range u.Passkeys {
				if bytes.Equal(p.Credential.ID, rawID) {
					matched = u
					return u, nil
				}
			}
		}
		return nil, ErrPasskeyNotFound
	}

	_, cred, err := wa.FinishPasskeyLogin(handler, c.data, r)
	if err != nil || matched == nil {
		m.mu.Lock()
		m.recordFailure(clientKey)
		m.mu.Unlock()
		return nil, errors.New("passkey login failed")
	}

	// Persist the updated signature counter and last-used time.
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.failures, clientKey)
	for i := range matched.Passkeys {
		if bytes.Equal(matched.Passkeys[i].Credential.ID, cred.ID) {
			matched.Passkeys[i].Credential = *cred
			matched.Passkeys[i].LastUsedAt = time.Now().UTC()
		}
	}
	_ = m.saveLocked()
	return matched, nil
}
