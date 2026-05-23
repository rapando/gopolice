package cmd_test

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rapando/gopolice/cmd"
	"github.com/rapando/gopolice/internal/config"
)

func executeCommand(args ...string) (string, error) {
	root := cmd.NewRootCommand()
	buf := new(bytes.Buffer)
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs(args)
	err := root.Execute()
	return buf.String(), err
}

// chdirTemp changes to a temp directory and returns a restore function.
func chdirTemp(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	orig, _ := os.Getwd()
	os.Chdir(dir)
	t.Cleanup(func() { os.Chdir(orig) })
	return dir
}

func TestVersionCommand(t *testing.T) {
	output, err := executeCommand("version")
	if err != nil {
		t.Fatalf("version command failed: %v", err)
	}
	output = strings.TrimSpace(output)
	if output == "" {
		t.Errorf("expected non-empty version, got empty")
	}
}

func TestHelpCommand(t *testing.T) {
	output, err := executeCommand("--help")
	if err != nil {
		t.Fatalf("help command failed: %v", err)
	}
	if !strings.Contains(output, "gopolice") {
		t.Errorf("help output should contain 'gopolice'")
	}
}

func TestConfigHelp(t *testing.T) {
	output, err := executeCommand("config", "--help")
	if err != nil {
		t.Fatalf("config help failed: %v", err)
	}
	if !strings.Contains(output, "init") || !strings.Contains(output, "show") {
		t.Errorf("config help should mention init and show")
	}
}

func TestConfigInitCmd(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	output, err := executeCommand("config", "init")
	if err != nil {
		t.Fatalf("config init failed: %v", err)
	}

	if !strings.Contains(output, "Global config initialized") {
		t.Errorf("output should mention global config init, got: %s", output)
	}

	expected := filepath.Join(tmpHome, ".config", "gopolice", "config.yaml")
	if _, err := os.Stat(expected); os.IsNotExist(err) {
		t.Fatal("global config was not created")
	}
}

func TestConfigInitIdempotent(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	_, err := executeCommand("config", "init")
	if err != nil {
		t.Fatal(err)
	}

	_, err = executeCommand("config", "init")
	if err != nil {
		t.Fatalf("second init should succeed: %v", err)
	}
}

func TestConfigLoadDirect(t *testing.T) {
	tmpDir := t.TempDir()
	globalPath := filepath.Join(tmpDir, "config.yaml")

	cfgYAML := `ui:
  theme: dark
  port: 8888
`
	os.WriteFile(globalPath, []byte(cfgYAML), 0644)

	cfg, err := config.LoadConfig(globalPath, filepath.Join(tmpDir, "nonexistent.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.UI.Theme != "dark" {
		t.Errorf("theme: expected 'dark', got '%s'", cfg.UI.Theme)
	}
	if cfg.UI.Port != 8888 {
		t.Errorf("port: expected 8888, got %d", cfg.UI.Port)
	}
}

func TestConfigShowCmd(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	cfgYAML := `
ui:
  theme: dark
  port: 8888
`
	os.MkdirAll(filepath.Join(tmpHome, ".config", "gopolice"), 0755)
	os.WriteFile(filepath.Join(tmpHome, ".config", "gopolice", "config.yaml"), []byte(cfgYAML), 0644)

	output, err := executeCommand("config", "show")
	if err != nil {
		t.Fatalf("config show failed: %v", err)
	}

	if !strings.Contains(output, "dark") {
		t.Errorf("output should contain 'dark', got: %s", output)
	}
	if !strings.Contains(output, "8888") {
		t.Errorf("output should contain '8888', got: %s", output)
	}
}

func TestConfigShowDefaults(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	output, err := executeCommand("config", "show")
	if err != nil {
		t.Fatalf("config show failed: %v", err)
	}

	if !strings.Contains(output, "9393") {
		t.Errorf("output should contain default port 9393, got: %s", output)
	}
	if !strings.Contains(output, "system") {
		t.Errorf("output should contain default theme 'system', got: %s", output)
	}
}

func TestConfigShow_YAMLValidity(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	output, err := executeCommand("config", "show")
	if err != nil {
		t.Fatalf("config show failed: %v", err)
	}
	output = strings.TrimSpace(output)
	if output == "" {
		t.Fatal("config show produced empty output")
	}

	lines := strings.Split(output, "\n")
	if len(lines) < 3 {
		t.Fatalf("expected at least 3 lines of YAML output, got %d", len(lines))
	}
}

func TestConfigInitWithProject(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	tmpProject := chdirTemp(t)
	os.WriteFile(filepath.Join(tmpProject, "go.mod"), []byte("module test\n"), 0644)

	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpProject)

	output, err := executeCommand("config", "init")
	if err != nil {
		t.Fatalf("config init failed: %v", err)
	}

	if !strings.Contains(output, "Project config initialized") {
		t.Errorf("output should mention project config init, got: %s", output)
	}

	expected := filepath.Join(tmpProject, ".gopolice", "config.yaml")
	if _, err := os.Stat(expected); os.IsNotExist(err) {
		t.Fatal("project config was not created")
	}
}
