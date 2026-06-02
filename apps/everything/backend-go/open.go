package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (svc *service) openPathLocked(params json.RawMessage) error {
	path, err := pathFromParams(params)
	if err != nil {
		return err
	}
	return openFileWithDefaultApp(path)
}

func (svc *service) revealPathLocked(params json.RawMessage) error {
	path, err := pathFromParams(params)
	if err != nil {
		return err
	}
	return revealFileInExplorer(path)
}

func pathFromParams(params json.RawMessage) (string, error) {
	var payload struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
		return "", fmt.Errorf("invalid path payload: %w", err)
	}
	path := strings.TrimSpace(payload.Path)
	if path == "" {
		return "", fmt.Errorf("path is required")
	}
	return path, nil
}
