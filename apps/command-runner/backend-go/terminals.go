package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type shellInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Builtin      bool   `json:"builtin"`
	Available    bool   `json:"available"`
	ExePath      string `json:"exePath"`
	ArgsTemplate string `json:"argsTemplate,omitempty"`
}

type shellDef struct {
	id           string
	name         string
	builtin      bool
	exePath      string
	available    bool
	argsTemplate string
	scriptExt    string
	scriptLF     bool
	scriptBOM    bool
}

func systemRoot() string {
	return strings.TrimSpace(os.Getenv("SystemRoot"))
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func resolveBuiltinShells() []shellDef {
	root := systemRoot()
	lookup := func(name string) (string, bool) {
		path, err := exec.LookPath(name)
		if err != nil || !fileExists(path) {
			return "", false
		}
		return path, true
	}

	cmdPath := ""
	if root != "" {
		candidate := filepath.Join(root, "System32", "cmd.exe")
		if fileExists(candidate) {
			cmdPath = candidate
		}
	}

	powershellPath := ""
	if root != "" {
		candidate := filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
		if fileExists(candidate) {
			powershellPath = candidate
		}
	}

	pwshPath, pwshOK := lookup("pwsh.exe")

	gitBashPath := resolveGitBashPath()

	wslPath := ""
	if root != "" {
		candidate := filepath.Join(root, "System32", "wsl.exe")
		if fileExists(candidate) {
			wslPath = candidate
		}
	}

	return []shellDef{
		{id: "cmd", name: "Command Prompt (cmd)", builtin: true, exePath: cmdPath, available: cmdPath != "", scriptExt: ".cmd"},
		{id: "powershell", name: "Windows PowerShell", builtin: true, exePath: powershellPath, available: powershellPath != "", scriptExt: ".ps1", scriptBOM: true},
		{id: "pwsh", name: "PowerShell 7 (pwsh)", builtin: true, exePath: pwshPath, available: pwshOK, scriptExt: ".ps1", scriptBOM: true},
		{id: "git-bash", name: "Git Bash (bash)", builtin: true, exePath: gitBashPath, available: gitBashPath != "", scriptExt: ".sh", scriptLF: true},
		{id: "wsl", name: "WSL (bash)", builtin: true, exePath: wslPath, available: wslPath != "", scriptExt: ".sh", scriptLF: true},
	}
}

func isKnownShellID(id string) bool {
	if id == "" {
		return false
	}
	if strings.HasPrefix(id, "custom-") {
		return true
	}
	for _, def := range resolveBuiltinShells() {
		if def.id == id {
			return true
		}
	}
	return false
}

func (svc *service) listTerminals() (map[string]any, error) {
	shells := []shellInfo{}
	for _, def := range resolveBuiltinShells() {
		shells = append(shells, shellInfo{
			ID:        def.id,
			Name:      def.name,
			Builtin:   true,
			Available: def.available,
			ExePath:   def.exePath,
		})
	}
	settings, err := svc.readSettings()
	if err != nil {
		return nil, err
	}
	for _, custom := range settings.CustomShells {
		shells = append(shells, shellInfo{
			ID:           custom.ID,
			Name:         custom.Name,
			Builtin:      false,
			Available:    fileExists(custom.ExePath),
			ExePath:      custom.ExePath,
			ArgsTemplate: custom.ArgsTemplate,
		})
	}
	return map[string]any{"shells": shells}, nil
}

func (svc *service) addCustomShell(name, exePath, argsTemplate string) (appSettings, error) {
	name = strings.TrimSpace(name)
	exePath = strings.TrimSpace(exePath)
	argsTemplate = strings.TrimSpace(argsTemplate)
	if name == "" {
		return appSettings{}, fmt.Errorf("终端名称不能为空")
	}
	if exePath == "" {
		return appSettings{}, fmt.Errorf("终端程序路径不能为空")
	}
	if !fileExists(exePath) {
		return appSettings{}, fmt.Errorf("终端程序不存在: %s", exePath)
	}
	if argsTemplate == "" {
		argsTemplate = "{command}"
	}
	if !strings.Contains(argsTemplate, "{command}") {
		return appSettings{}, fmt.Errorf("参数模板必须包含 {command} 占位符")
	}

	settings, err := svc.readSettings()
	if err != nil {
		return appSettings{}, err
	}
	for _, existing := range settings.CustomShells {
		if strings.EqualFold(existing.ExePath, exePath) {
			return appSettings{}, fmt.Errorf("该终端程序已存在: %s", existing.Name)
		}
	}
	custom := customShell{
		ID:           newID("custom"),
		Name:         name,
		ExePath:      exePath,
		ArgsTemplate: argsTemplate,
	}
	settings.CustomShells = append(settings.CustomShells, custom)
	if err := svc.writeSettings(settings); err != nil {
		return appSettings{}, err
	}
	return settings, nil
}

func (svc *service) removeCustomShell(id string) (appSettings, error) {
	settings, err := svc.readSettings()
	if err != nil {
		return appSettings{}, err
	}
	kept := make([]customShell, 0, len(settings.CustomShells))
	removed := false
	for _, custom := range settings.CustomShells {
		if custom.ID == id {
			removed = true
			continue
		}
		kept = append(kept, custom)
	}
	if !removed {
		return appSettings{}, fmt.Errorf("未找到自定义终端: %s", id)
	}
	settings.CustomShells = kept
	if err := svc.writeSettings(settings); err != nil {
		return appSettings{}, err
	}
	return settings, nil
}

// resolveShell 按命令级 > 仓库级 > 全局默认的优先级解析终端。
func (svc *service) resolveShell(commandShellID, repoShellID string) (shellDef, error) {
	settings, err := svc.readSettings()
	if err != nil {
		return shellDef{}, err
	}

	customByID := make(map[string]customShell, len(settings.CustomShells))
	for _, custom := range settings.CustomShells {
		customByID[custom.ID] = custom
	}

	for _, id := range []string{commandShellID, repoShellID, settings.DefaultShellID, defaultShellID} {
		if id == "" {
			continue
		}
		if custom, ok := customByID[id]; ok {
			return shellDef{
				id:           custom.ID,
				name:         custom.Name,
				exePath:      custom.ExePath,
				available:    fileExists(custom.ExePath),
				argsTemplate: custom.ArgsTemplate,
			}, nil
		}
		for _, def := range resolveBuiltinShells() {
			if def.id == id {
				return def, nil
			}
		}
	}
	return shellDef{}, fmt.Errorf("未找到可用的命令行终端")
}
