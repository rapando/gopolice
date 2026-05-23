package cache

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/rapando/gopolice/internal/model"
)

func ResultPath(projectDir string) string {
	return filepath.Join(projectDir, ".gopolice", "cache", "result.json")
}

func Save(result *model.ScanResult, path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func Load(path string) (*model.ScanResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var result model.ScanResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func IsStale(path string, maxAge time.Duration) bool {
	info, err := os.Stat(path)
	if err != nil {
		return true
	}
	return time.Since(info.ModTime()) > maxAge
}
