package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Port int `yaml:"port" json:"port"`

	TargetDir string `yaml:"-" json:"-"`
}

func DefaultConfig() *Config {
	return &Config{
		Port: 9393,
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

func DefaultLoadConfig() (*Config, error) {
	cfg := DefaultConfig()
	if data, err := os.ReadFile(GlobalConfigPath()); err == nil {
		var fc Config
		if err := yaml.Unmarshal(data, &fc); err == nil {
			if fc.Port != 0 {
				cfg.Port = fc.Port
			}
		}
	}
	return cfg, nil
}
