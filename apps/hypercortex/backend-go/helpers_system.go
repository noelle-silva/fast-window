package main

import (
	"os/exec"
	"runtime"
	"strings"
)

func openSystemDir(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

func copyToClipboard(text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "clip")
	case "darwin":
		cmd = exec.Command("pbcopy")
	default:
		cmd = exec.Command("xclip", "-selection", "clipboard")
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	_, writeErr := stdin.Write([]byte(text))
	closeErr := stdin.Close()
	waitErr := cmd.Wait()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return waitErr
}
