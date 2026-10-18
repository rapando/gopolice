// Package projects keeps the list of repositories a gopolice service has
// opened, so they survive restarts.
package projects

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	ErrNotFound  = errors.New("project not found")
	ErrNotGoRepo = errors.New("not a Go project: no go.mod or go.work found")
)

// Project is a saved repository.
type Project struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	AddedAt  time.Time `json:"added_at"`
	OpenedAt time.Time `json:"opened_at,omitzero"`
}

// Registry is a JSON file of saved projects.
type Registry struct {
	path string

	mu       sync.Mutex
	projects []Project
}

// Open loads the registry at path; a missing file is an empty registry.
func Open(path string) (*Registry, error) {
	r := &Registry{path: path}
	data, err := os.ReadFile(path) //nolint:gosec // path is the app's own registry file
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(data, &r.projects); err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
	}
	return r, nil
}

// ID returns the stable identifier for a project directory.
func ID(dir string) string {
	h := sha256.Sum256([]byte(dir))
	return hex.EncodeToString(h[:8])
}

// IsGoProject reports whether dir looks like a Go module or workspace root.
func IsGoProject(dir string) bool {
	for _, f := range []string{"go.mod", "go.work"} {
		if info, err := os.Stat(filepath.Join(dir, f)); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

func (r *Registry) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(r.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(r.projects, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}

// List returns the saved projects, most recently opened first.
func (r *Registry) List() []Project {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := append([]Project(nil), r.projects...)
	last := func(p Project) time.Time {
		if p.OpenedAt.After(p.AddedAt) {
			return p.OpenedAt
		}
		return p.AddedAt
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && last(out[j]).After(last(out[j-1])); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// Get returns a project by ID.
func (r *Registry) Get(id string) (Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range r.projects {
		if p.ID == id {
			return p, nil
		}
	}
	return Project{}, ErrNotFound
}

// Add saves the repository at path. Adding a repo that is already saved
// returns the existing entry.
func (r *Registry) Add(path string) (Project, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Project{}, err
	}
	// Canonicalise so the same repo reached via a symlink is one entry.
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Project{}, fmt.Errorf("open %s: %w", abs, err)
	}
	if !info.IsDir() {
		return Project{}, fmt.Errorf("%s is not a directory", abs)
	}
	if !IsGoProject(abs) {
		return Project{}, ErrNotGoRepo
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	id := ID(abs)
	for _, p := range r.projects {
		if p.ID == id {
			return p, nil
		}
	}
	p := Project{ID: id, Name: filepath.Base(abs), Path: abs, AddedAt: time.Now().UTC()}
	r.projects = append(r.projects, p)
	if err := r.saveLocked(); err != nil {
		r.projects = r.projects[:len(r.projects)-1]
		return Project{}, err
	}
	return p, nil
}

// Touch records that a project was just opened.
func (r *Registry) Touch(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.projects {
		if r.projects[i].ID == id {
			r.projects[i].OpenedAt = time.Now().UTC()
			_ = r.saveLocked()
			return
		}
	}
}

// Remove forgets a project. The repository itself is untouched.
func (r *Registry) Remove(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, p := range r.projects {
		if p.ID == id {
			old := append([]Project(nil), r.projects...)
			r.projects = append(r.projects[:i], r.projects[i+1:]...)
			if err := r.saveLocked(); err != nil {
				r.projects = old
				return err
			}
			return nil
		}
	}
	return ErrNotFound
}
