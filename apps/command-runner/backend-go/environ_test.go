package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

func TestFreshEnvKeepsSessionVars(t *testing.T) {
	env := freshEnv()
	if len(env) == 0 {
		t.Fatal("freshEnv returned empty environment")
	}

	// 会话环境中的标准变量必须原样保留（丢失用户目录 / 缓存定位变量
	// 会让 node / corepack 等全局工具找不到用户目录）
	for _, key := range []string{"SystemRoot", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "Path"} {
		if !envKeyPresent(env, key) {
			t.Fatalf("freshEnv missing session var: %s", key)
		}
	}
}

// envKeyPresent 大小写不敏感地判断环境列表中是否存在指定键
// （Windows 环境变量不区分大小写，键名拼写不保证）。
func envKeyPresent(env []string, want string) bool {
	for _, item := range env {
		equal := strings.Index(item, "=")
		if equal > 0 && strings.EqualFold(item[:equal], want) {
			return true
		}
	}
	return false
}

func TestFreshEnvDropsSessionPrivateVars(t *testing.T) {
	clean := freshEnv()
	// 当前会话中存在的 App 私有污染变量，净化后必须全部消失
	for _, item := range os.Environ() {
		equal := strings.Index(item, "=")
		if equal <= 0 {
			continue
		}
		key := item[:equal]
		if appPrivateEnvKey(key) && envKeyPresent(clean, key) {
			t.Fatalf("freshEnv leaked app private var: %s", key)
		}
	}
}

func TestFreshEnvReflectsSystemRoot(t *testing.T) {
	env := freshEnv()
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "SystemRoot=") {
		t.Fatalf("freshEnv missing SystemRoot: %s", joined)
	}
}

func TestFilterAppEnvDropsPrivateKeys(t *testing.T) {
	env := []string{
		"SystemRoot=C:\\WINDOWS",
		"Path=C:\\Windows\\system32",
		"FW_APP_SESSION_TOKEN=secret",
		"FW_APP_DATA_DIR=C:\\data",
		"FW_HOST_CAPABILITY_TOKEN=host-secret",
		"FW_HYPERCORTEX_LIBRARY_DIR=C:\\library",
		"CR_WORK_DIR=C:\\work",
		"ELECTRON_RUN_AS_NODE=1",
		"CHROME_CRASHPAD_PIPE_NAME=foo",
		"NODE_OPTIONS=--inspect",
		"NODE_PATH=undefined;C:\\tabby\\node_modules",
		"USERPROFILE=C:\\Users\\test",
	}
	filtered := filterAppEnv(env)
	for _, key := range []string{"FW_APP_SESSION_TOKEN", "FW_APP_DATA_DIR", "FW_HOST_CAPABILITY_TOKEN", "FW_HYPERCORTEX_LIBRARY_DIR", "CR_WORK_DIR", "ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "NODE_OPTIONS", "NODE_PATH"} {
		if _, ok := filtered[key]; ok {
			t.Fatalf("%s not filtered", key)
		}
	}
	if filtered["SystemRoot"] != "C:\\WINDOWS" {
		t.Fatalf("SystemRoot lost: %s", filtered["SystemRoot"])
	}
	if filtered["USERPROFILE"] != "C:\\Users\\test" {
		t.Fatalf("USERPROFILE lost: %s", filtered["USERPROFILE"])
	}
}

func TestOSEnvHasNoAppVars(t *testing.T) {
	for _, key := range []string{"FW_APP_SESSION_TOKEN", "FW_APP_DATA_DIR"} {
		if os.Getenv(key) != "" {
			t.Fatalf("test process should not have %s", key)
		}
	}
}

// TestFreshEnvMatchesSessionForPnpm 是环境透明代理的验收用例：
// 同一 pnpm 命令（经 corepack shim）在净化环境与当前会话环境下结果一致。
func TestFreshEnvMatchesSessionForPnpm(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("pnpm 验收仅覆盖 Windows")
	}
	if exec.Command("cmd.exe", "/c", "where", "pnpm").Run() != nil {
		t.Skip("当前环境未安装 pnpm")
	}

	sessionOut := runPnpmVersion(t, os.Environ())
	freshOut := runPnpmVersion(t, freshEnv())
	if sessionOut != freshOut {
		t.Fatalf("freshEnv pnpm output %q != session output %q", freshOut, sessionOut)
	}
}

func runPnpmVersion(t *testing.T, env []string) string {
	t.Helper()
	cmd := exec.Command("cmd.exe", "/c", "pnpm --version")
	cmd.Env = env
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("pnpm --version failed: %v\n%s", err, output)
	}
	return strings.TrimSpace(string(output))
}
