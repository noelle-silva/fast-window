package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func normalizeExistingLocalPath(value string, label string, requireFolder bool) (string, error) {
	path := strings.TrimSpace(value)
	if path == "" {
		return "", fmt.Errorf("%s is required", label)
	}
	if strings.ContainsRune(path, '\x00') {
		return "", fmt.Errorf("%s contains null byte", label)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve %s failed: %w", label, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("%s is not available: %s (%w)", label, abs, err)
	}
	if requireFolder && !info.IsDir() {
		return "", fmt.Errorf("%s must be a folder: %s", label, abs)
	}
	return abs, nil
}
