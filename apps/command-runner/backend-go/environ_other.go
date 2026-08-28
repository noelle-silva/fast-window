//go:build !windows

package main

import (
	"os"
	"strings"
)

// freshEnv 非 Windows 平台：以当前进程环境为基础，过滤 App 私有注入变量。
func freshEnv() []string {
	return normalizeEnv(filterAppEnv(os.Environ()))
}

// filterAppEnv 过滤进程环境中的 App 私有变量，保留会话期的标准环境。
func filterAppEnv(env []string) map[string]string {
	filtered := map[string]string{}
	for _, item := range env {
		equal := strings.Index(item, "=")
		if equal <= 0 {
			continue
		}
		key := item[:equal]
		if appPrivateEnvKey(key) {
			continue
		}
		filtered[key] = item[equal+1:]
	}
	return filtered
}

// appPrivateEnvKey 判定是否为 App 私有污染变量（环境纯净机制的豁免清单）。
func appPrivateEnvKey(key string) bool {
	upper := strings.ToUpper(key)
	return strings.HasPrefix(upper, "FW_APP_") ||
		strings.HasPrefix(upper, "CR_") ||
		strings.HasPrefix(upper, "ELECTRON_") ||
		strings.HasPrefix(upper, "CHROME_") ||
		upper == "NODE_OPTIONS"
}
