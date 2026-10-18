package projects

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func goRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAddListRemovePersist(t *testing.T) {
	file := filepath.Join(t.TempDir(), "projects.json")
	r, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	repo := goRepo(t)

	p, err := r.Add(repo)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	again, err := r.Add(repo)
	if err != nil || again.ID != p.ID {
		t.Fatalf("re-adding should return the same entry: %v %v", again, err)
	}
	if got := len(r.List()); got != 1 {
		t.Fatalf("got %d projects, want 1", got)
	}

	r2, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := r2.Get(p.ID); err != nil || got.Path != p.Path {
		t.Fatalf("not persisted: %v %v", got, err)
	}

	if err := r2.Remove(p.ID); err != nil {
		t.Fatal(err)
	}
	if err := r2.Remove(p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

func TestAddRejectsNonGo(t *testing.T) {
	r, _ := Open(filepath.Join(t.TempDir(), "projects.json"))
	if _, err := r.Add(t.TempDir()); !errors.Is(err, ErrNotGoRepo) {
		t.Fatalf("got %v, want ErrNotGoRepo", err)
	}
	if _, err := r.Add(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("expected error for missing dir")
	}
}
