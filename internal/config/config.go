package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// DefaultPort is the web UI port used when none is configured.
const DefaultPort = 9393

type Config struct {
	Port int `yaml:"port" json:"port"`

	// DisabledScanners lists scanner names (e.g. "benchmarks", "profile") to skip.
	DisabledScanners []string `yaml:"disabled_scanners,omitempty" json:"disabled_scanners,omitempty"`

	TargetDir string `yaml:"-" json:"-"`
}

func DefaultConfig() *Config {
	return &Config{
		Port: DefaultPort,
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
	return os.WriteFile(path, data, 0600)
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

func DefaultLoadConfig() (*Config, error) {
	cfg := DefaultConfig()
	if data, err := os.ReadFile(GlobalConfigPath()); err == nil {
		var fc Config
		if err := yaml.Unmarshal(data, &fc); err == nil {
			if fc.Port != 0 {
				cfg.Port = fc.Port
			}
			cfg.DisabledScanners = fc.DisabledScanners
		}
	}
	return cfg, nil
}

// ScannerEnabled reports whether the named scanner is not disabled.
func (c *Config) ScannerEnabled(name string) bool {
	for _, d := range c.DisabledScanners {
		if d == name {
			return false
		}
	}
	return true
}
