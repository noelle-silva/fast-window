//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

const createBreakawayFromJobFlag uint32 = 0x01000000

// launchInNewConsole 在新的控制台窗口中执行命令：
//   - keep-open    : cmd /k wrapper，wrapper 执行完后保留交互窗口
//   - countdown    : cmd /c wrapper，wrapper 末尾内置倒计时
//   - immediate    : cmd /c wrapper，执行完立即关闭
//
// 进程归属策略（仅外部窗口模式）：
//   - detached（系统级独立进程，全局默认）：创建时携带 CREATE_BREAKAWAY_FROM_JOB，
//     从宿主 Job（App 进程树托管 Job）破壁而出成为独立顶级进程，再挂新控制台且
//     不套自身 Job——sidecar / App 退出均不影响它，窗口独立存活。
//   - attached（挂载在 App 进程树下）：启动后立即挂上 KILL_ON_JOB_CLOSE Job，
//     与 sidecar 同生共死——sidecar 退出（含被杀）时 Job 关闭，整棵进程树被系统回收。
//
// 命令环境一律使用 freshEnv()（操作系统原始环境块），不携带任何 App 私有污染。
func (svc *service) launchInNewConsole(cmd command, repo repo, plan runPlan) error {
	scriptPath, err := svc.writeScriptFile(cmd, plan.shell)
	if err != nil {
		return err
	}
	plan.scriptPath = scriptPath

	wrapperPath := filepath.Join(svc.runTmpPath(), fmt.Sprintf("wrap-%s.cmd", newID("w")[:10]))
	wrapper := svc.buildWrapperScript(plan, repo.Path)
	if err := os.WriteFile(wrapperPath, []byte(wrapper), 0o644); err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("写入运行包装脚本失败: %w", err)
	}

	flag := "/c"
	if plan.keepOpen {
		flag = "/k"
	}
	wrapperCmd := exec.Command("cmd.exe", flag, wrapperPath)
	// wrapper 脚本内已内联全部路径字面量（不再读 CR_* 环境变量），
	// cmd.exe 直接拿操作系统原始环境块，命令进程环境绝对纯净。
	wrapperCmd.Env = freshEnv()
	// NoInheritHandles 必须为 true：后端自身 stdout 被宿主接管为管道，
	// 若不显式断开继承，cmd 会把全部输出（含 banner 与提示符）写进管道，
	// 新控制台窗口就会完全空白。
	if err := svc.startWrapperCmd(wrapperCmd, plan); err != nil {
		_ = os.Remove(scriptPath)
		_ = os.Remove(wrapperPath)
		return err
	}

	if plan.processOwnership == ownershipAttached {
		cleanup, err := attachJobObject(wrapperCmd)
		if err != nil {
			_ = wrapperCmd.Process.Kill()
			_ = os.Remove(scriptPath)
			_ = os.Remove(wrapperPath)
			return fmt.Errorf("绑定进程守护失败: %w", err)
		}
		go func() {
			_ = wrapperCmd.Wait()
			cleanup()
			_ = os.Remove(scriptPath)
			_ = os.Remove(wrapperPath)
		}()
		return nil
	}

	go func() {
		_ = wrapperCmd.Wait()
		_ = os.Remove(scriptPath)
		_ = os.Remove(wrapperPath)
	}()
	return nil
}

// startWrapperCmd 启动 wrapper 命令进程。
// detached 模式携带 CREATE_BREAKAWAY_FROM_JOB 从宿主 Job 破壁而出；
// 若宿主 Job（旧版本未开 BREAKAWAY_OK 或外层嵌套 Job 不允许）拒绝破壁，
// 降级为普通创建（进程随宿主树，保证命令始终可用，仅失去"系统级独立"特性）。
func (svc *service) startWrapperCmd(cmd *exec.Cmd, plan runPlan) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags:    createNewConsoleFlag,
		NoInheritHandles: true,
	}

	// attached 模式无需破壁：它本就要挂 App 自身 Job 完成生命周期管控。
	if plan.processOwnership != ownershipDetached {
		return cmd.Start()
	}

	cmd.SysProcAttr.CreationFlags = createNewConsoleFlag | createBreakawayFromJobFlag
	if err := cmd.Start(); err != nil {
		// 破壁被拒（宿主 Job 未开放 BREAKAWAY_OK 或外层 Job 限制）：
		// 降级为树内运行，保证命令能启动。
		cmd.SysProcAttr.CreationFlags = createNewConsoleFlag
		if fallbackErr := cmd.Start(); fallbackErr != nil {
			return fmt.Errorf("启动命令行窗口失败: %w", fallbackErr)
		}
	}
	return nil
}
