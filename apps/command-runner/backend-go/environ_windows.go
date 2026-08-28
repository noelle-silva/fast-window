//go:build windows

package main

import (
	"os"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// freshEnv 返回操作系统最原始、最纯净的标准环境（用户会话环境块）。
//
// Command Runner 作为"透明代理"，必须保证命令拿到的环境与用户在系统
// 原生窗口（如资源管理器启动的终端）中拿到的环境完全一致，不得携带
// 任何 App 私有污染（FW_APP_* / CR_* / 宿主进程注入的变量等）。
//
// Windows 上通过 CreateEnvironmentBlock 向 userenv.dll 索取当前用户的
// 完整环境块（其中 PATH 已按系统 + 用户合并，与 explorer 原生启动进程
// 同源）。该块不含登录会话级动态变量 USERNAME / USERDOMAIN，此处回补。
func freshEnv() []string {
	env := windowsSessionEnv()
	if env == nil {
		env = filterAppEnv(os.Environ())
	}
	return normalizeEnv(env)
}

// windowsSessionEnv 从 userenv.dll 索取用户环境块；失败返回 nil。
func windowsSessionEnv() map[string]string {
	var block *uint16
	if err := windows.CreateEnvironmentBlock(&block, windows.GetCurrentProcessToken(), false); err != nil {
		return nil
	}
	defer func() { _ = windows.DestroyEnvironmentBlock(block) }()

	values := parseEnvBlock(unsafe.Pointer(block))
	if len(values) == 0 {
		return nil
	}
	// USERNAME / USERDOMAIN 来自登录会话 volatile 环境段，环境块中缺失，回补。
	if !envKeyExists(values, "USERNAME") {
		if user := strings.TrimSpace(os.Getenv("USERNAME")); user != "" {
			values["USERNAME"] = user
		}
	}
	if !envKeyExists(values, "USERDOMAIN") {
		if domain := strings.TrimSpace(os.Getenv("USERDOMAIN")); domain != "" {
			values["USERDOMAIN"] = domain
		}
	}
	return values
}

// envKeyExists 大小写不敏感地检查键是否存在（Windows 环境变量不区分大小写）。
func envKeyExists(env map[string]string, key string) bool {
	for k := range env {
		if strings.EqualFold(k, key) {
			return true
		}
	}
	return false
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
// Windows 环境变量大小写不敏感，按 upper 匹配前缀。
func appPrivateEnvKey(key string) bool {
	upper := strings.ToUpper(key)
	return strings.HasPrefix(upper, "FW_APP_") ||
		strings.HasPrefix(upper, "CR_") ||
		strings.HasPrefix(upper, "ELECTRON_") ||
		strings.HasPrefix(upper, "CHROME_") ||
		upper == "NODE_OPTIONS"
}

// parseEnvBlock 解析双零结尾的 UTF-16 环境块为键值表（保留原始键名，
// Windows 环境变量大小写不敏感，但保留注册表/资源管理器写入的原始拼写
// 如 SystemRoot / Path，保证按字面键读取的工具不受影响）。
func parseEnvBlock(block unsafe.Pointer) map[string]string {
	values := map[string]string{}
	for idx := 0; uint16At(block, idx) != 0; {
		start := idx
		for uint16At(block, idx) != 0 {
			idx++
		}
		text := utf16SliceToString(block, start, idx)
		idx++
		if equal := strings.IndexByte(text, '='); equal > 0 {
			values[text[:equal]] = text[equal+1:]
		}
	}
	return values
}

func uint16At(block unsafe.Pointer, idx int) uint16 {
	return *(*uint16)(unsafe.Add(block, idx*2))
}

func utf16SliceToString(block unsafe.Pointer, start, end int) string {
	buf := make([]uint16, 0, end-start)
	for idx := start; idx < end; idx++ {
		buf = append(buf, uint16At(block, idx))
	}
	return windows.UTF16ToString(buf)
}
