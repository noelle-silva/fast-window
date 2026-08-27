//go:build !windows

package main

import "os/exec"

func attachJobObject(cmd *exec.Cmd) (cleanup func(), err error) {
	return func() {}, nil
}
