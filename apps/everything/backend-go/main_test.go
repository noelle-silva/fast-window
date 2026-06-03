package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateVendorManifest(t *testing.T) {
	svc := testService(t)
	files := map[string]string{
		"Everything.exe":         "runtime",
		"es.exe":                 "cli",
		"License.txt":            "license",
		"THIRD_PARTY_NOTICES.md": "notices",
	}
	writeVendor(t, svc.vendorDir(), files)

	status, err := svc.vendorStatusLocked()
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.RuntimeVersion != "test-runtime" || status.CLIVersion != "test-cli" {
		t.Fatalf("unexpected vendor status: %+v", status)
	}
}

func TestParseSearchCSV(t *testing.T) {
	results, err := parseSearchCSV("file.txt,C:\\Temp,12,2026-01-02 03:04\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Name != "file.txt" || results[0].Path != "C:\\Temp" {
		t.Fatalf("unexpected results: %+v", results)
	}
}

func TestParseSearchCSVRemovesUTF8BOM(t *testing.T) {
	results, err := parseSearchCSV("\ufeff\"@Danm龙 百变手鞠 2K.mp4\",\"D:\\edgedownload\\douyin\",10262384,2026/05/03 08:30\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1", len(results))
	}
	if results[0].Name != "@Danm龙 百变手鞠 2K.mp4" || results[0].Path != "D:\\edgedownload\\douyin" {
		t.Fatalf("unexpected UTF-8 result: %+v", results[0])
	}
}

func TestSetupStateRoundTrip(t *testing.T) {
	svc := testService(t)
	state := svc.defaultSetupState()
	state.EnabledAt = nowText()
	if err := writeJSON(svc.setupPath(), state); err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.readSetupStateLocked()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Mode != setupModeGlobal || loaded.ServiceName != svc.identity.ServiceName {
		t.Fatalf("unexpected setup state: %+v", loaded)
	}
}

func TestIdentityForChannelSeparatesDevAndRelease(t *testing.T) {
	dev, err := identityForChannel(channelDev)
	if err != nil {
		t.Fatal(err)
	}
	release, err := identityForChannel(channelRelease)
	if err != nil {
		t.Fatal(err)
	}
	if dev.InstanceName == release.InstanceName || dev.ServiceName == release.ServiceName || dev.RuntimeDirName == release.RuntimeDirName || dev.SetupFile == release.SetupFile {
		t.Fatalf("dev and release identities must not share system roots: dev=%+v release=%+v", dev, release)
	}
	if !containsAll(dev.InstanceName, "dev") || !containsAll(dev.ServiceName, "dev") {
		t.Fatalf("dev identity must be visibly marked as dev: %+v", dev)
	}
	if !containsAll(release.InstanceName, "release") || !containsAll(release.ServiceName, "release") {
		t.Fatalf("release identity must be visibly marked as release: %+v", release)
	}
}

func TestSetupInfoExposesOnlyGlobalMode(t *testing.T) {
	svc := testService(t)
	info, err := svc.setupInfoLocked()
	if err != nil {
		t.Fatal(err)
	}
	if info.Configured {
		t.Fatal("fresh setup must be unconfigured")
	}
	if len(info.AvailableModes) != 1 || info.AvailableModes[0] != setupModeGlobal {
		t.Fatalf("available modes = %+v, want global only", info.AvailableModes)
	}
	if len(info.RequiresConsent) != 1 || info.RequiresConsent[0] != setupModeGlobal {
		t.Fatalf("requires consent = %+v, want global", info.RequiresConsent)
	}
}

func TestSetupInfoReusesExistingGlobalService(t *testing.T) {
	svc := testService(t)
	writeVendor(t, svc.vendorDir(), map[string]string{
		"Everything.exe":         "runtime",
		"es.exe":                 "cli",
		"License.txt":            "license",
		"THIRD_PARTY_NOTICES.md": "notices",
	})
	svc.serviceOps = fakeGlobalServiceOps{exists: true, executable: svc.runtimeEverythingExePath()}
	info, err := svc.setupInfoLocked()
	if err != nil {
		t.Fatal(err)
	}
	if !info.Configured || info.State.InstanceName != svc.identity.InstanceName || info.State.ServiceName != svc.identity.ServiceName {
		t.Fatalf("unexpected setup info: %+v", info)
	}
}

func TestNormalizeExistingLocalPathRequiresFolder(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(file, []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeExistingLocalPath(dir, "test path", true); err != nil {
		t.Fatalf("folder path should pass: %v", err)
	}
	if _, err := normalizeExistingLocalPath(file, "test path", true); err == nil {
		t.Fatal("file path must fail when folder is required")
	}
	if _, err := normalizeExistingLocalPath(file, "test path", false); err != nil {
		t.Fatalf("existing file path should pass when folder is not required: %v", err)
	}
}

func TestRuntimeConfigUsesGlobalIndexOnly(t *testing.T) {
	svc := testService(t)
	state := svc.defaultSetupState()
	if err := svc.writeRuntimeConfigLocked(state); err != nil {
		t.Fatal(err)
	}
	text, err := os.ReadFile(svc.runtimeConfigPath())
	if err != nil {
		t.Fatal(err)
	}
	config := string(text)
	if !containsAll(config, "app_data=0", "run_as_admin=0", "db_location=") {
		t.Fatalf("runtime config missing global runtime settings:\n%s", config)
	}
	if strings.Contains(config, "folders=") || strings.Contains(config, "service_pipe_name") {
		t.Fatalf("runtime config must not include folder or custom pipe settings:\n%s", config)
	}
}

func TestEnsureReadyPreparesControlPlaneWithoutStartingRuntime(t *testing.T) {
	svc := testService(t)
	writeVendor(t, svc.vendorDir(), map[string]string{
		"Everything.exe":         "runtime",
		"es.exe":                 "cli",
		"License.txt":            "license",
		"THIRD_PARTY_NOTICES.md": "notices",
	})
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if svc.runtimeStartupError == "" {
		t.Fatal("expected runtime startup status to be recorded")
	}
}

func TestEverythingVersionProbeTimeoutBudgetMatchesEsTimeout(t *testing.T) {
	probeTimeout := 5 * time.Second
	args := everythingVersionArgs("everything-test-instance", probeTimeout)
	var cliTimeout string
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "-timeout" {
			cliTimeout = args[i+1]
			break
		}
	}
	if cliTimeout != "5000" {
		t.Fatalf("es timeout = %q, want 5000", cliTimeout)
	}
	if commandTimeoutWithGrace(probeTimeout) <= probeTimeout {
		t.Fatalf("command timeout must outlive es timeout")
	}
}

func TestEverythingSearchArgsUsePathColumn(t *testing.T) {
	args := everythingSearchArgs("everything-test-instance", "everything.exe", 10, `C:\Temp\results.csv`, "")
	if !containsAll(strings.Join(args, "\n"), "-path-column", "everything.exe") {
		t.Fatalf("search args missing expected path output column: %+v", args)
	}
	for _, arg := range args {
		if arg == "-path" {
			t.Fatalf("search args must not use -path search filter for output column: %+v", args)
		}
	}
}

func TestEverythingSearchArgsUseScopePathFilter(t *testing.T) {
	scopePath := `D:\Projects`
	args := everythingSearchArgs("everything-test-instance", "todo.md", 10, `C:\Temp\results.csv`, scopePath)
	joined := strings.Join(args, "\n")
	if !containsAll(joined, "-path-column", "-path", scopePath, "todo.md") {
		t.Fatalf("search args missing scoped search contract: %+v", args)
	}
	for index, arg := range args {
		if arg == "-path" && (index == len(args)-1 || args[index+1] != scopePath) {
			t.Fatalf("search scope path must follow -path: %+v", args)
		}
	}
}

func TestEverythingSearchArgsExportUTF8CSV(t *testing.T) {
	csvPath := `C:\Temp\results.csv`
	args := everythingSearchArgs("everything-test-instance", "中文.mp4", 10, csvPath, "")
	joined := strings.Join(args, "\n")
	if !containsAll(joined, "-export-csv", csvPath, "-utf8-bom", "中文.mp4") {
		t.Fatalf("search args missing UTF-8 export contract: %+v", args)
	}
	for _, arg := range args {
		if arg == "-csv" {
			t.Fatalf("search args must not read console CSV output: %+v", args)
		}
	}
}

func TestSearchTimeoutBudget(t *testing.T) {
	if searchTimeout != 30*time.Second {
		t.Fatalf("search timeout = %s, want 30s", searchTimeout)
	}
	if commandTimeoutWithGrace(searchConnectTimeout) <= searchConnectTimeout {
		t.Fatal("external command timeout must outlive es connection timeout")
	}
}

func TestSyncRuntimeBinaryCopiesOnlyWhenHashDiffers(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.exe")
	dst := filepath.Join(dir, "runtime", "dst.exe")
	if err := os.WriteFile(src, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncRuntimeBinary(src, dst); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "one" {
		t.Fatalf("runtime copy = %q, want one", string(bytes))
	}
	if err := os.WriteFile(src, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syncRuntimeBinary(src, dst); err != nil {
		t.Fatal(err)
	}
	bytes, err = os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "two" {
		t.Fatalf("runtime copy = %q, want two", string(bytes))
	}
}

func TestWindowsServiceNotFoundDetection(t *testing.T) {
	for _, text := range []string{
		"[SC] EnumQueryServicesStatus:OpenService FAILED 1060:",
		"The specified service does not exist as an installed service.",
	} {
		if !isWindowsServiceNotFound(text) {
			t.Fatalf("expected service-not-found detection for %q", text)
		}
	}
	if isWindowsServiceNotFound("Access is denied") {
		t.Fatal("access denied must not be treated as missing service")
	}
}

func TestWindowsServiceBinaryPathParsing(t *testing.T) {
	text := `[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: Everything (fast-window-everything-release)
        TYPE               : 10  WIN32_OWN_PROCESS
        BINARY_PATH_NAME   : "C:\Data\Everything.exe" -svc -instance "fast-window-everything-release"
        DISPLAY_NAME       : Everything (fast-window-everything-release)
`
	path := windowsServiceBinaryPath(text)
	if path != `"C:\Data\Everything.exe" -svc -instance "fast-window-everything-release"` {
		t.Fatalf("binary path = %q", path)
	}
	if exe := serviceBinaryExecutablePath(path); exe != `C:\Data\Everything.exe` {
		t.Fatalf("service executable = %q", exe)
	}
	if !serviceBinaryPathUsesExecutable(path, `C:\Data\Everything.exe`) {
		t.Fatal("expected service path to match executable")
	}
	if serviceBinaryPathUsesExecutable(path, `C:\Other\Everything.exe`) {
		t.Fatal("unexpected match for different executable")
	}
}

func TestWindowsExplorerSelectArgsSeparatePathFromSwitch(t *testing.T) {
	path := `D:\edgedownload\douyin\@jia601 小咕嘎：妈妈在那儿 2K.mp4`
	args := windowsExplorerSelectArgs(path)
	if len(args) != 2 || args[0] != "/select," || args[1] != path {
		t.Fatalf("explorer select args = %+v", args)
	}
}

func testService(t *testing.T) *service {
	t.Helper()
	identity, err := identityForChannel(channelRelease)
	if err != nil {
		t.Fatal(err)
	}
	return &service{dataDir: t.TempDir(), packageDir: t.TempDir(), identity: identity, serviceOps: fakeGlobalServiceOps{}}
}

type fakeGlobalServiceOps struct {
	exists     bool
	executable string
	running    bool
	err        error
}

func (ops fakeGlobalServiceOps) Exists(string) (bool, error) {
	return ops.exists, ops.err
}

func (ops fakeGlobalServiceOps) EnsureRunning(string) error {
	return ops.err
}

func (ops fakeGlobalServiceOps) UsesExecutable(_, expectedExe string) (bool, error) {
	if ops.err != nil {
		return false, ops.err
	}
	return ops.executable == expectedExe, nil
}

func writeVendor(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := "{\n  \"schemaVersion\": 1,\n  \"name\": \"Everything\",\n  \"architecture\": \"windows-x64\",\n  \"runtimeVersion\": \"test-runtime\",\n  \"cliVersion\": \"test-cli\",\n  \"files\": [\n"
	i := 0
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		if i > 0 {
			manifest += ",\n"
		}
		manifest += fmt.Sprintf("    { \"path\": %q, \"sha256\": %q }", name, sha256Text(body))
		i++
	}
	manifest += "\n  ]\n}\n"
	if err := os.WriteFile(filepath.Join(dir, "vendor-manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
}

func sha256Text(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func containsAll(text string, values ...string) bool {
	for _, value := range values {
		if !strings.Contains(text, value) {
			return false
		}
	}
	return true
}
