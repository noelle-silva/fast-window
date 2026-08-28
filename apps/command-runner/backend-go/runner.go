package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const createNewConsoleFlag = 0x00000010

type runPlan struct {
	shell            shellDef
	wrapperPath      string
	scriptPath       string
	keepOpen         bool
	countdown        int
	runMode          string
	processOwnership string
}

// resolveRunPlan 按三级继承链解析出一条命令的完整执行方案。
// 运行模式与进程归属均为配置语义（内置空间固定挂载进程树），
// 进程归属仅被外部窗口模式消费，由启动载体按需使用。
func (svc *service) resolveRunPlan(cmd command, repo repo) (runPlan, error) {
	shell, err := svc.resolveShell(cmd.ShellID, repo.ShellID)
	if err != nil {
		return runPlan{}, err
	}

	settings, err := svc.readSettings()
	if err != nil {
		return runPlan{}, err
	}

	closeMode := cmd.CloseMode
	if closeMode == "" {
		closeMode = repo.CloseMode
	}
	if closeMode == "" {
		closeMode = settings.DefaultCloseMode
	}
	if closeMode == "" {
		closeMode = defaultCloseMode
	}
	if !validCloseMode(closeMode) {
		return runPlan{}, fmt.Errorf("未知关闭策略: %s", closeMode)
	}

	plan := runPlan{
		shell:            shell,
		runMode:          resolveRunMode(cmd.RunMode, repo.RunMode, settings.DefaultRunMode),
		processOwnership: resolveProcessOwnership(cmd.ProcessOwnership, repo.ProcessOwnership, settings.DefaultProcessOwnership),
	}
	switch closeMode {
	case closeModeKeepOpen:
		plan.keepOpen = true
	case closeModeCountdown:
		plan.countdown = cmd.CountdownSeconds
		if plan.countdown == 0 {
			plan.countdown = repo.CountdownSeconds
		}
		if plan.countdown == 0 {
			plan.countdown = settings.DefaultCountdownSeconds
		}
		if plan.countdown < minCountdownSeconds || plan.countdown > maxCountdownSeconds {
			return runPlan{}, fmt.Errorf("倒计时秒数必须在 %d-%d 之间", minCountdownSeconds, maxCountdownSeconds)
		}
	}
	return plan, nil
}

// resolveRunMode 按 命令级 > 仓库级 > 全局默认 > console 兜底解析运行模式。
func resolveRunMode(commandLevel, repoLevel, globalLevel string) string {
	for _, level := range []string{commandLevel, repoLevel, globalLevel} {
		if validRunMode(level) && level != "" {
			return level
		}
	}
	return defaultRunMode
}

// resolveProcessOwnership 按 命令级 > 仓库级 > 全局默认 > detached 兜底解析进程归属。
func resolveProcessOwnership(commandLevel, repoLevel, globalLevel string) string {
	for _, level := range []string{commandLevel, repoLevel, globalLevel} {
		if validProcessOwnership(level) && level != "" {
			return level
		}
	}
	return defaultProcessOwnership
}

// runCommandByMode 按命令配置的运行模式分流执行。
func (svc *service) runCommandByMode(id string) (map[string]any, error) {
	cmdItem, target, err := svc.locateCommand(id)
	if err != nil {
		return nil, err
	}
	if info, err := os.Stat(target.Path); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("仓库目录不存在: %s", target.Path)
	}
	plan, err := svc.resolveRunPlan(cmdItem, target)
	if err != nil {
		return nil, err
	}
	if !plan.shell.available {
		return nil, fmt.Errorf("终端不可用: %s", plan.shell.name)
	}
	if plan.runMode == runModeEmbedded {
		return svc.runEmbeddedCommand(cmdItem, target, plan)
	}
	return svc.runConsoleCommand(cmdItem, target, plan)
}

func (svc *service) runConsoleCommand(cmdItem command, target repo, plan runPlan) (map[string]any, error) {
	if err := svc.launchInNewConsole(cmdItem, target, plan); err != nil {
		return nil, err
	}
	return map[string]any{"started": true}, nil
}

// writeScriptFile 将命令脚本写入临时目录，返回脚本路径。
func (svc *service) writeScriptFile(cmd command, shell shellDef) (string, error) {
	dir := svc.runTmpPath()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建运行临时目录失败: %w", err)
	}
	name := fmt.Sprintf("%s-%s%s", cmd.ID, newID("t")[:10], shell.scriptExt)
	path := filepath.Join(dir, name)

	content := cmd.Script
	if shell.scriptLF {
		content = strings.ReplaceAll(content, "\r\n", "\n")
	} else {
		if !strings.Contains(content, "\r\n") {
			content = strings.ReplaceAll(content, "\n", "\r\n")
		}
	}
	if shell.scriptBOM {
		content = "\xEF\xBB\xBF" + content
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("写入命令脚本失败: %w", err)
	}
	return path, nil
}

// inlineCmdLiteral 把路径内联进批处理行：整体引号包裹，% 转义为 %%，
// 并剥离结尾反斜杠（杜绝 "\"" 引号吞并歧义）。
func inlineCmdLiteral(path string) string {
	path = strings.TrimRight(path, `\`)
	path = strings.ReplaceAll(path, "%", "%%")
	return `"` + path + `"`
}

func (svc *service) buildWrapperScript(plan runPlan, workDir string) string {
	var b strings.Builder
	b.WriteString("@echo off\r\n")
	b.WriteString("chcp 65001 >nul\r\n")
	b.WriteString("title Command Runner\r\n")
	b.WriteString(fmt.Sprintf("cd /d %s\r\n", inlineCmdLiteral(workDir)))
	b.WriteString(buildWrapperShellLineWithWorkDir(plan.shell, plan.scriptPath, workDir))
	b.WriteString("\r\n")
	if plan.countdown > 0 {
		b.WriteString("echo.\r\n")
		b.WriteString(fmt.Sprintf("echo [Command Runner] Auto close in %d seconds. Press Ctrl+C to cancel.\r\n", plan.countdown))
		b.WriteString(fmt.Sprintf("timeout /t %d >nul\r\n", plan.countdown))
	}
	return b.String()
}

// buildWrapperShellLineWithWorkDir 生成调用终端的一行命令，路径以内联字面量传递。
func buildWrapperShellLineWithWorkDir(shell shellDef, scriptPath, workDir string) string {
	quotedScript := inlineCmdLiteral(scriptPath)
	switch shell.id {
	case "cmd":
		return fmt.Sprintf(`call %s`, quotedScript)
	case "powershell", "pwsh":
		return fmt.Sprintf(`%s -NoProfile -ExecutionPolicy Bypass -File %s`, inlineCmdLiteral(shell.exePath), quotedScript)
	case "wsl":
		return fmt.Sprintf(`wsl.exe --cd %s bash %s`, inlineCmdLiteral(workDir), quotedScript)
	default:
		if shell.argsTemplate != "" {
			args := make([]string, 0)
			for _, token := range splitArgsTemplate(shell.argsTemplate) {
				args = append(args, strings.ReplaceAll(token, "{command}", quotedScript))
			}
			return fmt.Sprintf(`%s %s`, inlineCmdLiteral(shell.exePath), strings.Join(args, " "))
		}
		return fmt.Sprintf(`%s %s`, inlineCmdLiteral(shell.exePath), quotedScript)
	}
}

func splitArgsTemplate(template string) []string {
	var args []string
	var current strings.Builder
	inQuote := false
	for _, r := range template {
		switch {
		case r == '"':
			inQuote = !inQuote
		case r == ' ' && !inQuote:
			if current.Len() > 0 {
				args = append(args, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}

func cleanRunTmp(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("创建运行临时目录失败: %w", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取运行临时目录失败: %w", err)
	}
	for _, entry := range entries {
		_ = os.RemoveAll(filepath.Join(dir, entry.Name()))
	}
	return nil
}
