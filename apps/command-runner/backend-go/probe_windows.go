//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// resolveGitBashPath 探测 Git Bash 安装位置。
// 优先读取 Git for Windows 官方安装器写入的注册表信息（支持任意安装盘符），
// 再回退标准安装路径与 PATH 查找；System32 下的 bash.exe 是 WSL 入口，必须排除。
func resolveGitBashPath() string {
	if path := gitBashFromRegistry(); path != "" {
		return path
	}
	for _, candidate := range gitBashStandardPaths() {
		if fileExists(candidate) {
			return candidate
		}
	}
	if path, err := exec.LookPath("bash.exe"); err == nil && fileExists(path) && !isWslBash(path) {
		return path
	}
	return ""
}

func gitBashFromRegistry() string {
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		installKey, err := registry.OpenKey(root, `SOFTWARE\GitForWindows`, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		installPath, _, err := installKey.GetStringValue("InstallPath")
		_ = installKey.Close()
		if err != nil || strings.TrimSpace(installPath) == "" {
			continue
		}
		candidate := filepath.Join(installPath, "bin", "bash.exe")
		if fileExists(candidate) {
			return candidate
		}
	}
	return ""
}

func gitBashStandardPaths() []string {
	return []string{
		filepath.Join(osProgramFiles(), "Git", "bin", "bash.exe"),
		filepath.Join(osProgramFilesX86(), "Git", "bin", "bash.exe"),
		filepath.Join(osLocalAppData(), "Programs", "Git", "bin", "bash.exe"),
	}
}

func isWslBash(path string) bool {
	return strings.Contains(strings.ToLower(path), "system32")
}

func osProgramFiles() string {
	return strings.TrimSpace(os.Getenv("ProgramFiles"))
}

func osProgramFilesX86() string {
	return strings.TrimSpace(os.Getenv("ProgramFiles(x86)"))
}

func osLocalAppData() string {
	return strings.TrimSpace(os.Getenv("LocalAppData"))
}
