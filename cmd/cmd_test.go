package cmd_test

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rapando/gopolice/cmd"
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

func chdirTemp(t *testing.T) {
	t.Helper()
	t.Chdir(t.TempDir())
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

func TestConfigShow(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	output, err := executeCommand("config")
	if err != nil {
		t.Fatalf("config command failed: %v", err)
	}
	if !strings.Contains(output, "9393") {
		t.Errorf("output should contain default port 9393, got: %s", output)
	}
}

func TestConfigShowCmd(t *testing.T) {
	chdirTemp(t)
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	cfgYAML := `port: 8888
`
	_ = os.MkdirAll(filepath.Join(tmpHome, ".config", "gopolice"), 0755)
	_ = os.WriteFile(filepath.Join(tmpHome, ".config", "gopolice", "config.yaml"), []byte(cfgYAML), 0600)

	output, err := executeCommand("config", "show")
	if err != nil {
		t.Fatalf("config show failed: %v", err)
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
	if len(lines) < 1 {
		t.Fatalf("expected at least 1 line of YAML output, got %d", len(lines))
	}
}
