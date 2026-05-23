package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rapando/gopolice/internal/config"
)

func TestDefaultConfig(t *testing.T) {
	cfg := config.DefaultConfig()
	if cfg.UI.Port != 9393 {
		t.Errorf("expected port 9393, got %d", cfg.UI.Port)
	}
	if cfg.UI.Theme != "system" {
		t.Errorf("expected theme 'system', got %s", cfg.UI.Theme)
	}
	if cfg.UI.OpenBrowser != true {
		t.Errorf("expected OpenBrowser true, got %v", cfg.UI.OpenBrowser)
	}
	if cfg.Export.Format != "json" {
		t.Errorf("expected export format 'json', got %s", cfg.Export.Format)
	}
	if cfg.Project.Path != "." {
		t.Errorf("expected project path '.', got %s", cfg.Project.Path)
	}
	if cfg.Scan.Scanners.Lint != true {
		t.Errorf("expected lint scanner enabled, got %v", cfg.Scan.Scanners.Lint)
	}
	if cfg.Scan.Scanners.Profile != false {
		t.Errorf("expected profile scanner disabled, got %v", cfg.Scan.Scanners.Profile)
	}
}

func TestSaveAndLoadConfigFile(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg := config.DefaultConfig()
	cfg.UI.Theme = "dark"
	cfg.UI.Port = 9090
	cfg.Scan.Scanners.Lint = false

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

	if loaded.UI.Theme != "dark" {
		t.Errorf("expected theme 'dark', got %s", loaded.UI.Theme)
	}
	if loaded.UI.Port != 9090 {
		t.Errorf("expected port 9090, got %d", loaded.UI.Port)
	}
	if loaded.Scan.Scanners.Lint != false {
		t.Errorf("expected lint false, got %v", loaded.Scan.Scanners.Lint)
	}
}

func TestLoadConfigFile_NotFound(t *testing.T) {
	_, err := config.LoadConfigFile("/nonexistent/path/config.yaml")
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}

func TestMarshalRoundTrip(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.UI.Theme = "light"
	cfg.Scan.Quick = true

	data, err := config.Marshal(cfg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	loaded, err := config.LoadConfigFromYAML(string(data))
	if err != nil {
		t.Fatalf("LoadConfigFromYAML failed: %v", err)
	}

	if loaded.UI.Theme != "light" {
		t.Errorf("expected theme 'light', got %s", loaded.UI.Theme)
	}
	if loaded.Scan.Quick != true {
		t.Errorf("expected Quick true, got %v", loaded.Scan.Quick)
	}
}

func TestLoadConfig_MergePrecedence(t *testing.T) {
	tmpDir := t.TempDir()
	globalPath := filepath.Join(tmpDir, "global", "config.yaml")
	projectPath := filepath.Join(tmpDir, "project", ".gopolice", "config.yaml")

	globalCfg := config.DefaultConfig()
	globalCfg.UI.Theme = "dark"
	globalCfg.Scan.Scanners.Lint = false
	if err := config.SaveConfigFile(globalCfg, globalPath); err != nil {
		t.Fatal(err)
	}

	projectYAML := `
ui:
  theme: light
  port: 8080
`
	if err := os.MkdirAll(filepath.Dir(projectPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(projectPath, []byte(projectYAML), 0644); err != nil {
		t.Fatal(err)
	}

	merged, err := config.LoadConfig(globalPath, projectPath)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if merged.UI.Theme != "light" {
		t.Errorf("expected theme 'light' (project wins), got %s", merged.UI.Theme)
	}
	if merged.UI.Port != 8080 {
		t.Errorf("expected port 8080 (project wins), got %d", merged.UI.Port)
	}
	if merged.Scan.Scanners.Lint != false {
		t.Errorf("expected lint false (global, not overridden by project), got %v", merged.Scan.Scanners.Lint)
	}
	if merged.UI.OpenBrowser != true {
		t.Errorf("expected OpenBrowser true (default), got %v", merged.UI.OpenBrowser)
	}
}

func TestLoadConfig_DefaultsOnly(t *testing.T) {
	tmpDir := t.TempDir()
	globalPath := filepath.Join(tmpDir, "nonexistent-global.yaml")
	projectPath := filepath.Join(tmpDir, "nonexistent-project.yaml")

	cfg, err := config.LoadConfig(globalPath, projectPath)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if cfg.UI.Port != 9393 {
		t.Errorf("expected default port 9393, got %d", cfg.UI.Port)
	}
}

func TestLoadConfig_GlobalOnly(t *testing.T) {
	tmpDir := t.TempDir()
	globalPath := filepath.Join(tmpDir, "global.yaml")
	projectPath := filepath.Join(tmpDir, "nonexistent.yaml")

	globalCfg := config.DefaultConfig()
	globalCfg.UI.Theme = "dark"
	if err := config.SaveConfigFile(globalCfg, globalPath); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.LoadConfig(globalPath, projectPath)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}
	if cfg.UI.Theme != "dark" {
		t.Errorf("expected theme 'dark', got %s", cfg.UI.Theme)
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

func TestInitProjectConfig(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	if err := config.InitProjectConfig(); err != nil {
		t.Fatalf("InitProjectConfig failed: %v", err)
	}

	expected := filepath.Join(tmpDir, ".gopolice", "config.yaml")
	if _, err := os.Stat(expected); os.IsNotExist(err) {
		t.Fatal("project config was not created")
	}

	if err := config.InitProjectConfig(); err != nil {
		t.Fatalf("InitProjectConfig on second call should succeed: %v", err)
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

func TestMarshalRoundTrip_AllFields(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.UI.Theme = "light"
	cfg.UI.Port = 8080
	cfg.UI.OpenBrowser = false
	cfg.Scan.Quick = true
	cfg.Scan.Profile = true
	cfg.Scan.Bench = true
	cfg.Scan.Scanners.Lint = false
	cfg.Scan.Scanners.Security = true
	cfg.Scan.Scanners.Tests = false
	cfg.Scan.Scanners.Profile = true
	cfg.Scan.Scanners.Git = false
	cfg.Scan.Scanners.Complexity = true
	cfg.Export.Format = "html"
	cfg.Export.Output = "report.html"
	cfg.Project.Path = "./myproject"
	cfg.Project.ExcludeDirs = []string{"vendor", "node_modules", "dist"}

	data, err := config.Marshal(cfg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	loaded, err := config.LoadConfigFromYAML(string(data))
	if err != nil {
		t.Fatalf("LoadConfigFromYAML failed: %v", err)
	}

	if loaded.UI.Theme != "light" {
		t.Errorf("theme: expected 'light', got '%s'", loaded.UI.Theme)
	}
	if loaded.UI.Port != 8080 {
		t.Errorf("port: expected 8080, got %d", loaded.UI.Port)
	}
	if loaded.UI.OpenBrowser != false {
		t.Errorf("OpenBrowser: expected false, got %v", loaded.UI.OpenBrowser)
	}
	if loaded.Scan.Quick != true {
		t.Errorf("Quick: expected true, got %v", loaded.Scan.Quick)
	}
	if loaded.Scan.Profile != true {
		t.Errorf("Profile: expected true, got %v", loaded.Scan.Profile)
	}
	if loaded.Scan.Bench != true {
		t.Errorf("Bench: expected true, got %v", loaded.Scan.Bench)
	}
	if loaded.Scan.Scanners.Lint != false {
		t.Errorf("Lint: expected false, got %v", loaded.Scan.Scanners.Lint)
	}
	if loaded.Scan.Scanners.Security != true {
		t.Errorf("Security: expected true, got %v", loaded.Scan.Scanners.Security)
	}
	if loaded.Scan.Scanners.Tests != false {
		t.Errorf("Tests: expected false, got %v", loaded.Scan.Scanners.Tests)
	}
	if loaded.Scan.Scanners.Profile != true {
		t.Errorf("Profile scanner: expected true, got %v", loaded.Scan.Scanners.Profile)
	}
	if loaded.Scan.Scanners.Git != false {
		t.Errorf("Git: expected false, got %v", loaded.Scan.Scanners.Git)
	}
	if loaded.Scan.Scanners.Complexity != true {
		t.Errorf("Complexity: expected true, got %v", loaded.Scan.Scanners.Complexity)
	}
	if loaded.Export.Format != "html" {
		t.Errorf("Export format: expected 'html', got '%s'", loaded.Export.Format)
	}
	if loaded.Export.Output != "report.html" {
		t.Errorf("Export output: expected 'report.html', got '%s'", loaded.Export.Output)
	}
	if loaded.Project.Path != "./myproject" {
		t.Errorf("Project path: expected './myproject', got '%s'", loaded.Project.Path)
	}
	if len(loaded.Project.ExcludeDirs) != 3 || loaded.Project.ExcludeDirs[2] != "dist" {
		t.Errorf("ExcludeDirs: expected [vendor node_modules dist], got %v", loaded.Project.ExcludeDirs)
	}
}

func TestLoadConfig_PartialOverride(t *testing.T) {
	tmpDir := t.TempDir()
	globalPath := filepath.Join(tmpDir, "global.yaml")
	projectPath := filepath.Join(tmpDir, "project.yaml")

	globalYAML := `
ui:
  theme: dark
scan:
  scanners:
    lint: false
`
	if err := os.WriteFile(globalPath, []byte(globalYAML), 0644); err != nil {
		t.Fatal(err)
	}

	projectYAML := `
ui:
  port: 7777
`
	if err := os.WriteFile(projectPath, []byte(projectYAML), 0644); err != nil {
		t.Fatal(err)
	}

	merged, err := config.LoadConfig(globalPath, projectPath)
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	if merged.UI.Theme != "dark" {
		t.Errorf("theme: expected 'dark' (from global), got '%s'", merged.UI.Theme)
	}
	if merged.UI.Port != 7777 {
		t.Errorf("port: expected 7777 (from project), got %d", merged.UI.Port)
	}
	if merged.Scan.Scanners.Lint != false {
		t.Errorf("lint: expected false (from global), got %v", merged.Scan.Scanners.Lint)
	}
	if merged.UI.OpenBrowser != true {
		t.Errorf("OpenBrowser: expected true (default), got %v", merged.UI.OpenBrowser)
	}
}
