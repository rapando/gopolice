package config

import "gopkg.in/yaml.v3"

func LoadConfigFromYAML(data string) (*Config, error) {
	var cfg Config
	if err := yaml.Unmarshal([]byte(data), &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
