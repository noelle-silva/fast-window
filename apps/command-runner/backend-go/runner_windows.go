//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// launchInNewConsole 在新的控制台窗口中执行命令：
//   - keep-open    : cmd /k wrapper，wrapper 执行完后保留交互窗口
//   - countdown    : cmd /c wrapper，wrapper 末尾内置倒计时
//   - immediate    : cmd /c wrapper，执行完立即关闭
func (svc *service) launchInNewConsole(cmd command, repo repo, plan runPlan) error {
	scriptPath, err := svc.writeScriptFile(cmd, plan.shell)
	if err != nil {
		return err
	}

	wrapperPath := filepath.Join(svc.runTmpPath(), fmt.Sprintf("wrap-%s.cmd", newID("w")[:10]))
	if err := os.WriteFile(wrapperPath, []byte(buildWrapperScript(plan)), 0o644); err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("写入运行包装脚本失败: %w", err)
	}

	flag := "/c"
	if plan.keepOpen {
		flag = "/k"
	}
	wrapperCmd := exec.Command("cmd.exe", flag, wrapperPath)
	wrapperCmd.Env = append(os.Environ(),
		fmt.Sprintf("%s=%s", workDirVar, repo.Path),
		fmt.Sprintf("%s=%s", shellExeVar, plan.shell.exePath),
		fmt.Sprintf("%s=%s", scriptFileVar, scriptPath),
	)
	// NoInheritHandles 必须为 true：后端自身 stdout 被宿主接管为管道，
	// 若不显式断开继承，cmd 会把全部输出（含 banner 与提示符）写进管道，
	// 新控制台窗口就会完全空白。
	wrapperCmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags:    createNewConsoleFlag,
		NoInheritHandles: true,
	}

	if err := wrapperCmd.Start(); err != nil {
		_ = os.Remove(scriptPath)
		_ = os.Remove(wrapperPath)
		return fmt.Errorf("启动命令行窗口失败: %w", err)
	}

	go func() {
		_ = wrapperCmd.Wait()
		_ = os.Remove(scriptPath)
		_ = os.Remove(wrapperPath)
	}()
	return nil
}
