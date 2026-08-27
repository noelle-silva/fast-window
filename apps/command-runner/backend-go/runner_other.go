//go:build !windows

package main

import "fmt"

func (svc *service) launchInNewConsole(cmd command, repo repo, plan runPlan) error {
	return fmt.Errorf("Command Runner 目前仅支持 Windows 独立命令行窗口运行")
}
