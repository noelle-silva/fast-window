package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const createNewConsoleFlag = 0x00000010

type runPlan struct {
	shell       shellDef
	wrapperPath string
	scriptPath  string
	keepOpen    bool
	countdown   int
}

// resolveRunPlan 按三级继承链解析出一条命令的完整执行方案。
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
		closeMode = settings.DefaultCloseMode
	}
	if closeMode == "" {
		closeMode = defaultCloseMode
	}
	if !validCloseMode(closeMode) {
		return runPlan{}, fmt.Errorf("未知关闭策略: %s", closeMode)
	}

	plan := runPlan{shell: shell}
	switch closeMode {
	case closeModeKeepOpen:
		plan.keepOpen = true
	case closeModeCountdown:
		plan.countdown = cmd.CountdownSeconds
		if plan.countdown == 0 {
			plan.countdown = settings.DefaultCountdownSeconds
		}
		if plan.countdown < minCountdownSeconds || plan.countdown > maxCountdownSeconds {
			return runPlan{}, fmt.Errorf("倒计时秒数必须在 %d-%d 之间", minCountdownSeconds, maxCountdownSeconds)
		}
	}
	return plan, nil
}

func (svc *service) runCommand(id string) (map[string]any, error) {
	commandsDoc, err := svc.loadCommands()
	if err != nil {
		return nil, err
	}
	var cmd command
	found := false
	for _, item := range commandsDoc.Commands {
		if item.ID == id {
			cmd = item
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("未找到命令: %s", id)
	}

	reposDoc, err := svc.loadRepos()
	if err != nil {
		return nil, err
	}
	var target repo
	found = false
	for _, item := range reposDoc.Repos {
		if item.ID == cmd.RepoID {
			target = item
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("命令所属仓库不存在: %s", cmd.RepoID)
	}
	if info, err := os.Stat(target.Path); err != nil || !info.IsDir() {
		return nil, fmt.Errorf("仓库目录不存在: %s", target.Path)
	}

	plan, err := svc.resolveRunPlan(cmd, target)
	if err != nil {
		return nil, err
	}
	if !plan.shell.available {
		return nil, fmt.Errorf("终端不可用: %s", plan.shell.name)
	}

	if err := svc.launchInNewConsole(cmd, target, plan); err != nil {
		return nil, err
	}
	return map[string]any{"started": true}, nil
}

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

// buildWrapperShellLine 生成 wrapper 中调用具体终端的一行命令。
// 路径一律经环境变量与引号传递，规避 cmd 元字符与编码问题。
func buildWrapperShellLine(shell shellDef) string {
	quotedScript := fmt.Sprintf(`"%%%s%%"`, scriptFileVar)
	switch shell.id {
	case "cmd":
		return fmt.Sprintf(`call %s`, quotedScript)
	case "powershell", "pwsh":
		return fmt.Sprintf(`"%%%s%%" -NoProfile -ExecutionPolicy Bypass -File %s`, shellExeVar, quotedScript)
	case "wsl":
		return fmt.Sprintf(`wsl.exe --cd "%%%s%%" bash %s`, workDirVar, quotedScript)
	default:
		if shell.argsTemplate != "" {
			args := make([]string, 0)
			for _, token := range splitArgsTemplate(shell.argsTemplate) {
				args = append(args, strings.ReplaceAll(token, "{command}", quotedScript))
			}
			return fmt.Sprintf(`"%%%s%%" %s`, shellExeVar, strings.Join(args, " "))
		}
		return fmt.Sprintf(`"%%%s%%" %s`, shellExeVar, quotedScript)
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

func buildWrapperScript(plan runPlan) string {
	var b strings.Builder
	b.WriteString("@echo off\r\n")
	b.WriteString("chcp 65001 >nul\r\n")
	b.WriteString("title Command Runner\r\n")
	b.WriteString(fmt.Sprintf("cd /d \"%%%s%%\"\r\n", workDirVar))
	b.WriteString(buildWrapperShellLine(plan.shell))
	b.WriteString("\r\n")
	if plan.countdown > 0 {
		b.WriteString("echo.\r\n")
		b.WriteString(fmt.Sprintf("echo [Command Runner] Auto close in %d seconds. Press Ctrl+C to cancel.\r\n", plan.countdown))
		b.WriteString(fmt.Sprintf("timeout /t %d >nul\r\n", plan.countdown))
	}
	return b.String()
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
