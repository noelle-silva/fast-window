package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const vendorRelDir = "vendor/everything/windows-x64"

var sha256Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type vendorManifest struct {
	SchemaVersion  int          `json:"schemaVersion"`
	Name           string       `json:"name"`
	Architecture   string       `json:"architecture"`
	RuntimeVersion string       `json:"runtimeVersion"`
	CLIVersion     string       `json:"cliVersion"`
	Files          []vendorFile `json:"files"`
}

type vendorFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type vendorStatus struct {
	Ready          bool   `json:"ready"`
	RuntimeVersion string `json:"runtimeVersion"`
	CLIVersion     string `json:"cliVersion"`
	RuntimePath    string `json:"runtimePath"`
	CLIPath        string `json:"cliPath"`
	LicensePath    string `json:"licensePath"`
	Error          string `json:"error,omitempty"`
}

func (svc *service) vendorDir() string {
	return filepath.Join(svc.packageDir, filepath.FromSlash(vendorRelDir))
}

func (svc *service) vendorEverythingExePath() string {
	return filepath.Join(svc.vendorDir(), "Everything.exe")
}

func (svc *service) vendorEsExePath() string {
	return filepath.Join(svc.vendorDir(), "es.exe")
}

func (svc *service) vendorStatusLocked() (vendorStatus, error) {
	manifest, err := svc.validateVendorLocked()
	status := vendorStatus{
		Ready:       err == nil,
		RuntimePath: svc.vendorEverythingExePath(),
		CLIPath:     svc.vendorEsExePath(),
		LicensePath: filepath.Join(svc.vendorDir(), "License.txt"),
	}
	if manifest != nil {
		status.RuntimeVersion = manifest.RuntimeVersion
		status.CLIVersion = manifest.CLIVersion
	}
	if err != nil {
		status.Error = err.Error()
	}
	return status, err
}

func (svc *service) validateVendorLocked() (*vendorManifest, error) {
	manifestPath := filepath.Join(svc.vendorDir(), "vendor-manifest.json")
	bytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("Everything vendor manifest missing: %w", err)
	}

	var manifest vendorManifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return nil, fmt.Errorf("Everything vendor manifest invalid: %w", err)
	}
	if manifest.SchemaVersion != 1 {
		return nil, fmt.Errorf("Everything vendor schemaVersion must be 1")
	}
	if manifest.Name != "Everything" || manifest.Architecture != "windows-x64" {
		return nil, fmt.Errorf("Everything vendor identity mismatch")
	}
	if strings.TrimSpace(manifest.RuntimeVersion) == "" || strings.TrimSpace(manifest.CLIVersion) == "" {
		return nil, fmt.Errorf("Everything vendor versions are required")
	}

	seen := map[string]bool{}
	for _, file := range manifest.Files {
		rel, err := safeVendorFileName(file.Path)
		if err != nil {
			return nil, err
		}
		expected := strings.ToLower(strings.TrimSpace(file.SHA256))
		if !sha256Pattern.MatchString(expected) {
			return nil, fmt.Errorf("Everything vendor sha256 invalid for %s", rel)
		}
		actual, err := sha256File(filepath.Join(svc.vendorDir(), rel))
		if err != nil {
			return nil, fmt.Errorf("Everything vendor file missing: %s (%w)", rel, err)
		}
		if actual != expected {
			return nil, fmt.Errorf("Everything vendor sha256 mismatch for %s", rel)
		}
		seen[rel] = true
	}

	for _, required := range []string{"Everything.exe", "es.exe", "License.txt", "THIRD_PARTY_NOTICES.md"} {
		if !seen[required] {
			return nil, fmt.Errorf("Everything vendor manifest must include %s", required)
		}
	}
	return &manifest, nil
}

func safeVendorFileName(raw string) (string, error) {
	rel := strings.TrimSpace(filepath.ToSlash(raw))
	if rel == "" || strings.Contains(rel, "/") || rel == "." || rel == ".." {
		return "", fmt.Errorf("Everything vendor file name is unsafe: %q", raw)
	}
	return rel, nil
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func copyFileExact(src, dst string, mode os.FileMode) error {
	input, err := os.Open(src)
	if err != nil {
		return err
	}
	defer input.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	output, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}
