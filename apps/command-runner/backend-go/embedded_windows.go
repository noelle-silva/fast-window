//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

const createNoWindowFlag = 0x08000000

// hideEmbeddedProcess 内嵌模式不弹任何窗口，输出全部经管道捕获。
func hideEmbeddedProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindowFlag}
}

// killProcessTree 终结整个进程树（含脚本派生的子进程）。
func killProcessTree(pid int) error {
	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
	kill.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindowFlag}
	kill.Stdout = os.Stderr
	kill.Stderr = os.Stderr
	return kill.Run()
}
