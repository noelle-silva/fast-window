package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultSearchLimit   = 120
	maxSearchLimit       = 500
	searchConnectTimeout = 5 * time.Second
	searchTimeout        = 30 * time.Second
)

type searchResult struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	FullPath   string `json:"fullPath"`
	Kind       string `json:"kind"`
	Size       string `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

type searchResponse struct {
	Query     string         `json:"query"`
	Limit     int            `json:"limit"`
	ScopePath string         `json:"scopePath"`
	Results   []searchResult `json:"results"`
}

func (svc *service) searchLocked(params json.RawMessage) (searchResponse, error) {
	var payload struct {
		Query     string `json:"query"`
		Limit     int    `json:"limit"`
		ScopePath string `json:"scopePath"`
	}
	if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
		return searchResponse{}, fmt.Errorf("invalid search payload: %w", err)
	}
	query := strings.TrimSpace(payload.Query)
	scopePath, err := normalizeSearchScopePath(payload.ScopePath)
	if err != nil {
		return searchResponse{}, err
	}
	if query == "" {
		return searchResponse{Query: query, Limit: normalizeLimit(payload.Limit), ScopePath: scopePath, Results: []searchResult{}}, nil
	}
	if err := svc.ensureRuntimeReadyForSearchLocked(); err != nil {
		return searchResponse{}, err
	}
	limit := normalizeLimit(payload.Limit)
	text, err := runEverythingSearchCSV(searchTimeout, svc.runtimeEsExePath(), svc.identity.InstanceName, query, limit, scopePath)
	if err != nil {
		return searchResponse{}, fmt.Errorf("Everything search failed: %w", err)
	}
	results, err := parseSearchCSV(text)
	if err != nil {
		return searchResponse{}, err
	}
	return searchResponse{Query: query, Limit: limit, ScopePath: scopePath, Results: results}, nil
}

func runEverythingSearchCSV(timeout time.Duration, esPath string, instance string, query string, limit int, scopePath string) (string, error) {
	file, err := os.CreateTemp("", "everything-search-*.csv")
	if err != nil {
		return "", fmt.Errorf("create Everything search export failed: %w", err)
	}
	csvPath := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(csvPath)
		return "", fmt.Errorf("close Everything search export failed: %w", err)
	}
	defer os.Remove(csvPath)

	args := everythingSearchArgs(instance, query, limit, csvPath, scopePath)
	if _, err := runCommandOutput(timeout, esPath, args...); err != nil {
		return "", err
	}
	content, err := os.ReadFile(csvPath)
	if err != nil {
		return "", fmt.Errorf("read Everything search export failed: %w", err)
	}
	return string(content), nil
}

func everythingSearchArgs(instance string, query string, limit int, csvPath string, scopePath string) []string {
	args := []string{
		"-instance", instance,
		"-timeout", strconv.FormatInt(timeoutMilliseconds(searchConnectTimeout), 10),
		"-export-csv", csvPath,
		"-utf8-bom",
		"-no-header",
		"-name",
		"-path-column",
		"-size",
		"-date-modified",
		"-n", strconv.Itoa(limit),
	}
	if strings.TrimSpace(scopePath) != "" {
		args = append(args, "-path", scopePath)
	}
	return append(args, query)
}

func normalizeSearchScopePath(value string) (string, error) {
	path := strings.TrimSpace(value)
	if path == "" {
		return "", nil
	}
	return normalizeExistingLocalPath(path, "search scope path", true)
}

func (svc *service) ensureRuntimeReadyForSearchLocked() error {
	setup, err := svc.readSetupStateLocked()
	if err != nil {
		return err
	}
	status := svc.runtimeStatusLocked(setup)
	if status.Ready {
		return nil
	}
	message := strings.TrimSpace(status.Error)
	if message == "" {
		message = "Everything runtime is not ready"
	}
	return fmt.Errorf("Everything runtime is not ready: %s", message)
}

func parseSearchCSV(text string) ([]searchResult, error) {
	text = strings.TrimPrefix(text, "\ufeff")
	if strings.TrimSpace(text) == "" {
		return []searchResult{}, nil
	}
	reader := csv.NewReader(strings.NewReader(text))
	reader.FieldsPerRecord = -1
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("parse Everything search output failed: %w", err)
	}
	results := make([]searchResult, 0, len(records))
	for _, record := range records {
		if len(record) < 4 {
			return nil, fmt.Errorf("Everything search output column mismatch")
		}
		name := record[0]
		path := record[1]
		fullPath := filepath.Join(path, name)
		results = append(results, searchResult{
			Name:       name,
			Path:       path,
			FullPath:   fullPath,
			Kind:       resultKind(fullPath),
			Size:       record[2],
			ModifiedAt: record[3],
		})
	}
	return results, nil
}

func resultKind(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return "unknown"
	}
	if info.IsDir() {
		return "folder"
	}
	return "file"
}

func normalizeLimit(value int) int {
	if value <= 0 {
		return defaultSearchLimit
	}
	if value > maxSearchLimit {
		return maxSearchLimit
	}
	return value
}
