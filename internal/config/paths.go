package config

import (
	"os"
	"path/filepath"
)

func GlobalConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".config", "gopolice")
	}
	return filepath.Join(home, ".config", "gopolice")
}

func GlobalConfigPath() string {
	return filepath.Join(GlobalConfigDir(), "config.yaml")
}

func IsInsideGoProject() bool {
	root := findGoProjectRoot()
	return root != ""
}

func FindProjectRoot() string {
	root := findGoProjectRoot()
	if root == "" {
		cwd, _ := os.Getwd()
		return cwd
	}
	return root
}

func findGoProjectRoot() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := cwd
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
