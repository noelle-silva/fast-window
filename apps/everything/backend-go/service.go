package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	dataSchemaVersion = 1
	dataVersion       = 1
	metaFile          = "_meta.json"
)

type service struct {
	dataDir             string
	packageDir          string
	serviceOps          globalServiceOps
	runtimeStartupError string
	mu                  sync.Mutex
}

type metaDoc struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	UpdatedAt     string `json:"updatedAt"`
}

func newService() (*service, error) {
	dataDir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	if dataDir == "" {
		return nil, errors.New("everything backend missing FW_APP_DATA_DIR")
	}
	dataAbs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve data dir failed: %w", err)
	}

	packageDir := strings.TrimSpace(os.Getenv("FW_APP_PACKAGE_DIR"))
	if packageDir == "" {
		return nil, errors.New("everything backend missing FW_APP_PACKAGE_DIR")
	}
	packageAbs, err := filepath.Abs(packageDir)
	if err != nil {
		return nil, fmt.Errorf("resolve package dir failed: %w", err)
	}

	return &service{dataDir: dataAbs, packageDir: packageAbs, serviceOps: windowsGlobalServiceOps{}}, nil
}

func (svc *service) ensureReady() error {
	svc.mu.Lock()
	defer svc.mu.Unlock()

	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		return err
	}
	if err := ensureWritable(svc.dataDir); err != nil {
		return err
	}
	if err := svc.writeDataMetaLocked(); err != nil {
		return err
	}
	if _, err := svc.validateVendorLocked(); err != nil {
		return err
	}
	svc.runtimeStartupError = "Everything runtime has not been started yet"
	return nil
}

func (svc *service) dispatchSafe(method string, params json.RawMessage) (result any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("request handler panic: %v", recovered)
		}
	}()
	return svc.dispatch(method, params)
}

func (svc *service) dispatch(method string, params json.RawMessage) (any, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()

	switch method {
	case "everything.health":
		return svc.healthLocked()
	case "everything.search":
		return svc.searchLocked(params)
	case "everything.setup.get":
		return svc.setupInfoLocked()
	case "everything.setup.enableGlobal":
		return svc.enableGlobalSetupLocked()
	case "everything.runtime.restart":
		return svc.restartRuntimeLocked()
	case "everything.openPath":
		return nil, svc.openPathLocked(params)
	case "everything.copyPath":
		return nil, svc.copyPathLocked(params)
	case "everything.revealPath":
		return nil, svc.revealPathLocked(params)
	default:
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

func (svc *service) healthLocked() (map[string]any, error) {
	setup, configured, setupErr := svc.readSetupStateWithFlagLocked()
	serviceConfigured, serviceErr := svc.globalServiceConfiguredLocked()
	vendor, vendorErr := svc.vendorStatusLocked()
	runtime := svc.runtimeStatusLocked(setup)
	configured = configured || serviceConfigured
	if !configured && setupErr == nil && serviceErr == nil {
		runtime.Ready = false
		runtime.Error = "Everything global indexing is not enabled"
	}
	return map[string]any{
		"ok":         vendorErr == nil && setupErr == nil && serviceErr == nil && configured && runtime.Ready,
		"dataDir":    svc.dataDir,
		"packageDir": svc.packageDir,
		"time":       time.Now().UTC().Format(time.RFC3339),
		"vendor":     vendor,
		"setup":      setup,
		"runtime":    runtime,
		"errors": compactStrings(
			errorString(vendorErr),
			errorString(setupErr),
			errorString(serviceErr),
			runtime.Error,
		),
	}, nil
}

func (svc *service) writeDataMetaLocked() error {
	return writeJSON(filepath.Join(svc.dataDir, metaFile), metaDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, UpdatedAt: nowText()})
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(bytes, '\n'), 0o644)
}

func readJSON(path string, target any) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, target)
}

func ensureWritable(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	testPath := filepath.Join(path, ".fw-everything-write-test")
	if err := os.WriteFile(testPath, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data dir is not writable: %s (%w)", path, err)
	}
	_ = os.Remove(testPath)
	return nil
}

func nowText() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func compactStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}
