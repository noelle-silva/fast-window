package main

import (
	"os"
	"strings"
	"testing"
)

func TestFreshEnvIsSystemPristine(t *testing.T) {
	env := freshEnv()
	if len(env) == 0 {
		t.Fatal("freshEnv returned empty environment")
	}

	keys := map[string]bool{}
	for _, item := range env {
		equal := strings.Index(item, "=")
		if equal <= 0 {
			t.Fatalf("malformed env item: %q", item)
		}
		keys[item[:equal]] = true
	}

	// 系统必须变量应存在
	for _, key := range []string{"SystemRoot", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "Path"} {
		if !keys[key] {
			t.Fatalf("freshEnv missing system var: %s", key)
		}
	}

	// App 私有污染必须不存在
	for _, item := range env {
		key := item[:strings.Index(item, "=")]
		if strings.HasPrefix(key, "FW_APP_") || strings.HasPrefix(key, "CR_") || strings.HasPrefix(key, "ELECTRON_") || key == "NODE_OPTIONS" {
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
		"CR_WORK_DIR=C:\\work",
		"ELECTRON_RUN_AS_NODE=1",
		"CHROME_CRASHPAD_PIPE_NAME=foo",
		"NODE_OPTIONS=--inspect",
		"USERPROFILE=C:\\Users\\test",
	}
	filtered := filterAppEnv(env)
	if _, ok := filtered["FW_APP_SESSION_TOKEN"]; ok {
		t.Fatal("FW_APP_SESSION_TOKEN not filtered")
	}
	if _, ok := filtered["CR_WORK_DIR"]; ok {
		t.Fatal("CR_WORK_DIR not filtered")
	}
	if _, ok := filtered["ELECTRON_RUN_AS_NODE"]; ok {
		t.Fatal("ELECTRON_RUN_AS_NODE not filtered")
	}
	if _, ok := filtered["NODE_OPTIONS"]; ok {
		t.Fatal("NODE_OPTIONS not filtered")
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
