package config

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Project ProjectConfig `yaml:"project"`
	Scan    ScanConfig    `yaml:"scan"`
	UI      UIConfig      `yaml:"ui"`
	Export  ExportConfig  `yaml:"export"`
}

type ProjectConfig struct {
	Path        string   `yaml:"path"`
	ExcludeDirs []string `yaml:"exclude_dirs"`
}

type ScanConfig struct {
	Quick    bool           `yaml:"quick"`
	Profile  bool           `yaml:"profile"`
	Bench    bool           `yaml:"bench"`
	Scanners ScannerToggles `yaml:"scanners"`
}

type ScannerToggles struct {
	Lint       bool `yaml:"lint"`
	Security   bool `yaml:"security"`
	Tests      bool `yaml:"tests"`
	Profile    bool `yaml:"profile"`
	Git        bool `yaml:"git"`
	Complexity bool `yaml:"complexity"`
}

type UIConfig struct {
	Port        int    `yaml:"port"`
	OpenBrowser bool   `yaml:"open_browser"`
	Theme       string `yaml:"theme"`
}

type ExportConfig struct {
	Format string `yaml:"format"`
	Output string `yaml:"output"`
}

func DefaultConfig() *Config {
	return &Config{
		Project: ProjectConfig{
			Path:        ".",
			ExcludeDirs: []string{"vendor", "node_modules"},
		},
		Scan: ScanConfig{
			Quick:   false,
			Profile: false,
			Bench:   false,
			Scanners: ScannerToggles{
				Lint:       true,
				Security:   true,
				Tests:      true,
				Profile:    false,
				Git:        true,
				Complexity: true,
			},
		},
		UI: UIConfig{
			Port:        9393,
			OpenBrowser: true,
			Theme:       "system",
		},
		Export: ExportConfig{
			Format: "json",
			Output: "report.json",
		},
	}
}

func Marshal(cfg *Config) ([]byte, error) {
	return yaml.Marshal(cfg)
}

func SaveConfigFile(cfg *Config, path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func LoadConfigFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func InitGlobalConfig() error {
	path := GlobalConfigPath()
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	if err := os.MkdirAll(GlobalConfigDir(), 0755); err != nil {
		return err
	}
	return SaveConfigFile(DefaultConfig(), path)
}

func InitProjectConfig() error {
	dir := ProjectConfigDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	path := ProjectConfigPath()
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	return SaveConfigFile(DefaultConfig(), path)
}

func DefaultLoadConfig() (*Config, error) {
	return LoadConfig(GlobalConfigPath(), ProjectConfigPath())
}

func LoadConfig(globalPath, projectPath string) (*Config, error) {
	merged := make(map[string]interface{})

	defaultData, err := yaml.Marshal(DefaultConfig())
	if err != nil {
		return nil, fmt.Errorf("marshal defaults: %w", err)
	}
	var defMap map[string]interface{}
	if err := yaml.Unmarshal(defaultData, &defMap); err != nil {
		return nil, fmt.Errorf("unmarshal defaults: %w", err)
	}
	deepMerge(merged, defMap)

	if data, err := os.ReadFile(globalPath); err == nil {
		var m map[string]interface{}
		if err := yaml.Unmarshal(data, &m); err != nil {
			return nil, fmt.Errorf("global config: %w", err)
		}
		deepMerge(merged, m)
	}

	if data, err := os.ReadFile(projectPath); err == nil {
		var m map[string]interface{}
		if err := yaml.Unmarshal(data, &m); err != nil {
			return nil, fmt.Errorf("project config: %w", err)
		}
		deepMerge(merged, m)
	}

	out, err := yaml.Marshal(merged)
	if err != nil {
		return nil, fmt.Errorf("marshal merged: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(out, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal merged: %w", err)
	}
	return &cfg, nil
}

func deepMerge(dst, src map[string]interface{}) {
	for k, v := range src {
		if vm, ok := v.(map[string]interface{}); ok {
			if dm, ok := dst[k].(map[string]interface{}); ok {
				deepMerge(dm, vm)
				dst[k] = dm
			} else {
				dst[k] = vm
			}
		} else {
			dst[k] = v
		}
	}
}
