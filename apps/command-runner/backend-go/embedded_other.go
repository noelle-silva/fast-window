//go:build !windows

package main

import (
	"os/exec"
	"strconv"
)

func hideEmbeddedProcess(cmd *exec.Cmd) {}

func killProcessTree(pid int) error {
	return exec.Command("kill", "-9", strconv.Itoa(pid)).Run()
}
