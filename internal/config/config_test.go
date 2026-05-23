package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rapando/gopolice/internal/config"
)

func TestDefaultConfig(t *testing.T) {
	cfg := config.DefaultConfig()
	if cfg.Port != 9393 {
		t.Errorf("expected port 9393, got %d", cfg.Port)
	}
}

func TestSaveAndLoadConfigFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg := config.DefaultConfig()
	cfg.Port = 9090

	if err := config.SaveConfigFile(cfg, path); err != nil {
		t.Fatalf("SaveConfigFile failed: %v", err)
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("config file was not created")
	}

	loaded, err := config.LoadConfigFile(path)
	if err != nil {
		t.Fatalf("LoadConfigFile failed: %v", err)
	}

	if loaded.Port != 9090 {
		t.Errorf("expected port 9090, got %d", loaded.Port)
	}
}

func TestLoadConfigFile_NotFound(t *testing.T) {
	_, err := config.LoadConfigFile("/nonexistent/path/config.yaml")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestSaveConfigFile_CreatesDir(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "deep", "nested", "dir", "config.yaml")

	cfg := config.DefaultConfig()
	if err := config.SaveConfigFile(cfg, path); err != nil {
		t.Fatalf("SaveConfigFile failed: %v", err)
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Fatal("config file was not created in nested dir")
	}
}

func TestInitGlobalConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	if err := config.InitGlobalConfig(); err != nil {
		t.Fatalf("InitGlobalConfig failed: %v", err)
	}

	expected := filepath.Join(tmpDir, ".config", "gopolice", "config.yaml")
	if _, err := os.Stat(expected); os.IsNotExist(err) {
		t.Fatal("global config was not created")
	}

	if err := config.InitGlobalConfig(); err != nil {
		t.Fatalf("InitGlobalConfig on second call should succeed: %v", err)
	}
}

func TestConfigPaths(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	expected := filepath.Join(tmpHome, ".config", "gopolice", "config.yaml")
	if got := config.GlobalConfigPath(); got != expected {
		t.Errorf("GlobalConfigPath: expected %s, got %s", expected, got)
	}
}

func TestIsInsideGoProject(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)

	os.Chdir(tmpDir)
	if config.IsInsideGoProject() {
		t.Error("expected false for dir without go.mod")
	}

	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte("module test\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if !config.IsInsideGoProject() {
		t.Error("expected true for dir with go.mod")
	}
}

func TestFindProjectRoot(t *testing.T) {
	tmpDir := t.TempDir()
	subDir := filepath.Join(tmpDir, "a", "b", "c")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte("module test\n"), 0644); err != nil {
		t.Fatal(err)
	}

	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(subDir)

	root := config.FindProjectRoot()
	evalRoot, _ := filepath.EvalSymlinks(root)
	evalTmp, _ := filepath.EvalSymlinks(tmpDir)
	if evalRoot != evalTmp {
		t.Errorf("expected project root %s, got %s", tmpDir, root)
	}
}

func TestDefaultLoadConfig_NoGlobal(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfg, err := config.DefaultLoadConfig()
	if err != nil {
		t.Fatalf("DefaultLoadConfig failed: %v", err)
	}
	if cfg.Port != 9393 {
		t.Errorf("expected default port 9393, got %d", cfg.Port)
	}
}

func TestDefaultLoadConfig_WithGlobal(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfg := config.DefaultConfig()
	cfg.Port = 8888
	os.MkdirAll(filepath.Join(tmpDir, ".config", "gopolice"), 0755)
	config.SaveConfigFile(cfg, config.GlobalConfigPath())

	loaded, err := config.DefaultLoadConfig()
	if err != nil {
		t.Fatalf("DefaultLoadConfig failed: %v", err)
	}
	if loaded.Port != 8888 {
		t.Errorf("expected port 8888, got %d", loaded.Port)
	}
}
