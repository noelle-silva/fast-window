package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	runtimeDirName        = "everything-runtime"
	runtimeBinDirName     = "runtime-bin"
	runtimeReadyTimeout   = 30 * time.Second
	runtimeProbeTimeout   = 5 * time.Second
	runtimeStatusTimeout  = 1500 * time.Millisecond
	runtimeProbeInterval  = 250 * time.Millisecond
	runtimeCommandTimeout = 20 * time.Second
	serviceQueryTimeout   = 5 * time.Second
)

type runtimeStatus struct {
	Ready        bool   `json:"ready"`
	InstanceName string `json:"instanceName"`
	Mode         string `json:"mode"`
	Version      string `json:"version,omitempty"`
	ConfigPath   string `json:"configPath"`
	DatabasePath string `json:"databasePath"`
	Error        string `json:"error,omitempty"`
}

type globalServiceOps interface {
	Exists(name string) (bool, error)
	EnsureRunning(name string) error
	UsesExecutable(name, expectedExe string) (bool, error)
}

type windowsGlobalServiceOps struct{}

func (windowsGlobalServiceOps) Exists(name string) (bool, error) {
	return windowsServiceExists(name)
}

func (windowsGlobalServiceOps) EnsureRunning(name string) error {
	return ensureWindowsServiceRunning(name)
}

func (windowsGlobalServiceOps) UsesExecutable(name, expectedExe string) (bool, error) {
	return windowsServiceUsesExecutable(name, expectedExe)
}

func (svc *service) runtimeDir() string {
	return filepath.Join(svc.dataDir, runtimeDirName)
}

func (svc *service) runtimeBinDir() string {
	return filepath.Join(svc.runtimeDir(), runtimeBinDirName)
}

func (svc *service) runtimeEverythingExePath() string {
	return filepath.Join(svc.runtimeBinDir(), "Everything.exe")
}

func (svc *service) runtimeEsExePath() string {
	return filepath.Join(svc.runtimeBinDir(), "es.exe")
}

func (svc *service) runtimeConfigPath() string {
	return filepath.Join(svc.runtimeDir(), "Everything.ini")
}

func (svc *service) runtimeDatabasePath() string {
	return filepath.Join(svc.runtimeDir(), "Everything.db")
}

func (svc *service) startRuntimeLocked() error {
	setup, _, err := svc.readSetupStateWithFlagLocked()
	if err != nil {
		return err
	}
	serviceConfigured, err := svc.globalServiceConfiguredLocked()
	if err != nil {
		return err
	}
	if !serviceConfigured {
		return fmt.Errorf("Everything global indexing is not enabled")
	}
	if err := svc.syncRuntimeCLILocked(); err != nil {
		return err
	}
	if err := svc.writeRuntimeConfigLocked(setup); err != nil {
		return err
	}
	if err := svc.serviceOps.EnsureRunning(serviceName); err != nil {
		return err
	}
	_ = svc.stopRuntimeLocked()
	args := []string{
		"-instance", instanceName,
		"-config", svc.runtimeConfigPath(),
		"-db", svc.runtimeDatabasePath(),
		"-startup",
	}
	if err := runDetached(svc.runtimeEverythingExePath(), args...); err != nil {
		return fmt.Errorf("start Everything runtime failed: %w", err)
	}
	return svc.waitRuntimeReadyLocked()
}

func (svc *service) restartRuntimeLocked() (runtimeStatus, error) {
	if err := svc.restartRuntimeOnlyLocked(); err != nil {
		return svc.runtimeStatusLocked(defaultSetupState()), err
	}
	setup, _ := svc.readSetupStateLocked()
	return svc.runtimeStatusLocked(setup), nil
}

func (svc *service) restartRuntimeOnlyLocked() error {
	_ = svc.stopRuntimeLocked()
	err := svc.startRuntimeLocked()
	if err != nil {
		svc.runtimeStartupError = err.Error()
		return err
	}
	svc.runtimeStartupError = ""
	return nil
}

func (svc *service) stopRuntimeLocked() error {
	if _, err := runCommandOutput(runtimeCommandTimeout, svc.runtimeEverythingExePath(), "-instance", instanceName, "-exit"); err != nil {
		return fmt.Errorf("stop Everything runtime failed: %w", err)
	}
	return nil
}

func (svc *service) runtimeStatusLocked(setup setupState) runtimeStatus {
	status := runtimeStatus{
		InstanceName: instanceName,
		Mode:         setup.Mode,
		ConfigPath:   svc.runtimeConfigPath(),
		DatabasePath: svc.runtimeDatabasePath(),
	}
	version, err := svc.everythingVersionLocked(runtimeStatusTimeout)
	if err != nil {
		if svc.runtimeStartupError != "" {
			status.Error = svc.runtimeStartupError + "; current probe: " + err.Error()
		} else {
			status.Error = err.Error()
		}
		return status
	}
	status.Ready = true
	status.Version = version
	return status
}

func (svc *service) waitRuntimeReadyLocked() error {
	deadline := time.Now().Add(runtimeReadyTimeout)
	var lastErr error
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		probeTimeout := minDuration(runtimeProbeTimeout, remaining)
		if _, err := svc.everythingVersionLocked(probeTimeout); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if sleep := minDuration(runtimeProbeInterval, time.Until(deadline)); sleep > 0 {
			time.Sleep(sleep)
		}
	}
	if lastErr != nil {
		return fmt.Errorf("Everything runtime not ready: %w", lastErr)
	}
	return fmt.Errorf("Everything runtime not ready")
}

func (svc *service) everythingVersionLocked(timeout time.Duration) (string, error) {
	text, err := runCommandOutput(commandTimeoutWithGrace(timeout), svc.runtimeEsExePath(), everythingVersionArgs(timeout)...)
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return "", fmt.Errorf("empty Everything version response")
	}
	return text, nil
}

func everythingVersionArgs(timeout time.Duration) []string {
	return []string{"-instance", instanceName, "-timeout", strconv.FormatInt(timeoutMilliseconds(timeout), 10), "-get-everything-version"}
}

func (svc *service) writeRuntimeConfigLocked(setup setupState) error {
	if err := os.MkdirAll(svc.runtimeDir(), 0o755); err != nil {
		return err
	}
	lines := []string{
		"[Everything]",
		"app_data=0",
		"run_as_admin=0",
		"run_in_background=1",
		"show_tray_icon=0",
		"check_for_updates_on_startup=0",
		"allow_multiple_windows=0",
		"allow_http_server=0",
		"db_location=" + iniValue(svc.runtimeDir()),
	}
	return os.WriteFile(svc.runtimeConfigPath(), []byte(strings.Join(lines, "\r\n")+"\r\n"), 0o644)
}

func (svc *service) syncRuntimeBinariesLocked() error {
	if _, err := svc.validateVendorLocked(); err != nil {
		return err
	}
	if err := syncRuntimeBinary(svc.vendorEverythingExePath(), svc.runtimeEverythingExePath()); err != nil {
		return fmt.Errorf("sync Everything runtime failed: %w", err)
	}
	return svc.syncRuntimeCLILocked()
}

func (svc *service) syncRuntimeCLILocked() error {
	if _, err := svc.validateVendorLocked(); err != nil {
		return err
	}
	if err := syncRuntimeBinary(svc.vendorEsExePath(), svc.runtimeEsExePath()); err != nil {
		return fmt.Errorf("sync Everything CLI failed: %w", err)
	}
	return nil
}

func syncRuntimeBinary(src, dst string) error {
	srcHash, err := sha256File(src)
	if err != nil {
		return err
	}
	if dstHash, err := sha256File(dst); err == nil && dstHash == srcHash {
		return nil
	}
	return copyFileExact(src, dst, 0o755)
}

func (svc *service) installOrValidateGlobalServiceLocked() error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("Everything global indexing is only supported on Windows")
	}
	if err := svc.syncRuntimeBinariesLocked(); err != nil {
		return err
	}
	if err := svc.writeRuntimeConfigLocked(defaultSetupState()); err != nil {
		return err
	}
	exists, err := svc.serviceOps.Exists(serviceName)
	if err != nil {
		return err
	}
	if exists {
		if err := svc.validateGlobalServiceLocked(); err != nil {
			return err
		}
		if err := svc.syncRuntimeCLILocked(); err != nil {
			return err
		}
		if err := svc.writeRuntimeConfigLocked(defaultSetupState()); err != nil {
			return err
		}
		return svc.serviceOps.EnsureRunning(serviceName)
	}
	_ = svc.stopRuntimeLocked()
	_, err = runCommandOutput(runtimeCommandTimeout, svc.runtimeEverythingExePath(),
		"-instance", instanceName,
		"-install-service",
	)
	if err != nil {
		return fmt.Errorf("enable Everything global indexing failed: %w", err)
	}
	if err := svc.validateGlobalServiceLocked(); err != nil {
		return err
	}
	return svc.serviceOps.EnsureRunning(serviceName)
}

func (svc *service) globalServiceConfiguredLocked() (bool, error) {
	if runtime.GOOS != "windows" {
		return false, nil
	}
	exists, err := svc.serviceOps.Exists(serviceName)
	if err != nil || !exists {
		return false, err
	}
	if err := svc.validateGlobalServiceLocked(); err != nil {
		return false, err
	}
	return true, nil
}

func (svc *service) validateGlobalServiceLocked() error {
	matches, err := svc.serviceOps.UsesExecutable(serviceName, svc.runtimeEverythingExePath())
	if err != nil {
		return err
	}
	if !matches {
		return fmt.Errorf("Everything global indexing service uses a different runtime path")
	}
	return nil
}

func windowsServiceExists(name string) (bool, error) {
	output, err := runCommandOutput(serviceQueryTimeout, "sc.exe", "query", name)
	if err == nil {
		return true, nil
	}
	if isWindowsServiceNotFound(output) || isWindowsServiceNotFound(err.Error()) {
		return false, nil
	}
	return false, fmt.Errorf("query Windows service failed: %w", err)
}

func windowsServiceUsesExecutable(name, expectedExe string) (bool, error) {
	output, err := runCommandOutput(serviceQueryTimeout, "sc.exe", "qc", name)
	if err != nil {
		return false, fmt.Errorf("query Windows service config failed: %w", err)
	}
	actual := windowsServiceBinaryPath(output)
	if actual == "" {
		return false, fmt.Errorf("Windows service binary path missing: %s", name)
	}
	return serviceBinaryPathUsesExecutable(actual, expectedExe), nil
}

func ensureWindowsServiceRunning(name string) error {
	running, err := windowsServiceRunning(name)
	if err != nil {
		return err
	}
	if running {
		return nil
	}
	if _, err := runCommandOutput(runtimeCommandTimeout, "sc.exe", "start", name); err != nil {
		return fmt.Errorf("start Windows service failed: %w", err)
	}
	deadline := time.Now().Add(runtimeCommandTimeout)
	for {
		running, err := windowsServiceRunning(name)
		if err != nil {
			return err
		}
		if running {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Windows service did not reach RUNNING state: %s", name)
		}
		time.Sleep(runtimeProbeInterval)
	}
}

func windowsServiceRunning(name string) (bool, error) {
	output, err := runCommandOutput(serviceQueryTimeout, "sc.exe", "query", name)
	if err != nil {
		return false, fmt.Errorf("query Windows service failed: %w", err)
	}
	return strings.Contains(strings.ToUpper(output), "RUNNING"), nil
}

func windowsServiceBinaryPath(scOutput string) string {
	for _, line := range strings.Split(scOutput, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "BINARY_PATH_NAME") {
			continue
		}
		_, value, found := strings.Cut(trimmed, ":")
		if !found {
			return ""
		}
		return strings.TrimSpace(value)
	}
	return ""
}

func serviceBinaryPathUsesExecutable(binaryPath, expectedExe string) bool {
	actualExe := serviceBinaryExecutablePath(binaryPath)
	if actualExe == "" {
		return false
	}
	actual := strings.ToLower(filepath.Clean(actualExe))
	expected := strings.ToLower(filepath.Clean(expectedExe))
	return actual == expected
}

func serviceBinaryExecutablePath(binaryPath string) string {
	value := strings.TrimSpace(binaryPath)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "\"") {
		end := strings.Index(value[1:], "\"")
		if end < 0 {
			return strings.Trim(value, "\"")
		}
		return value[1 : end+1]
	}
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func isWindowsServiceNotFound(text string) bool {
	lower := strings.ToLower(text)
	return strings.Contains(lower, "1060") || strings.Contains(lower, "does not exist")
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func runDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func iniValue(value string) string {
	return strings.ReplaceAll(value, "\\", "\\\\")
}
