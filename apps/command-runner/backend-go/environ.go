package main

import (
	"os"
	"strings"
)

// freshEnv 返回命令执行使用的工作环境。
//
// 语义：透明代理——以当前会话环境为基线（与用户在外部终端拿到的环境同源），
// 仅剥除 App / 运行时注入的私有污染变量。命令行为和外部终端保持一致。
func freshEnv() []string {
	return normalizeEnv(filterAppEnv(os.Environ()))
}

// filterAppEnv 从环境列表剔除以 App 私有前缀与运行时注入键标识的污染项。
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

// appPrivateEnvKey 判定是否为 App 私有污染变量（环境净化机制的过滤清单）。
// FW_ 是 fast-window 生态命名空间（宿主能力服务 FW_HOST_*、各 App 后端
// FW_APP_* 等）；CR_ 为 Command Runner 历史注入前缀。Windows 环境变量
// 大小写不敏感，按 upper 匹配前缀。
func appPrivateEnvKey(key string) bool {
	upper := strings.ToUpper(key)
	return strings.HasPrefix(upper, "FW_") ||
		strings.HasPrefix(upper, "CR_") ||
		strings.HasPrefix(upper, "ELECTRON_") ||
		strings.HasPrefix(upper, "CHROME_") ||
		upper == "NODE_OPTIONS" ||
		upper == "NODE_PATH"
}

// normalizeEnv 将环境键值表转为按键排序的键值对切片，输出稳定有序。
func normalizeEnv(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sortStrings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+env[key])
	}
	return result
}

func sortStrings(values []string) {
	for idx := 1; idx < len(values); idx++ {
		for jdx := idx; jdx > 0 && values[jdx-1] > values[jdx]; jdx-- {
			values[jdx-1], values[jdx] = values[jdx], values[jdx-1]
		}
	}
}
