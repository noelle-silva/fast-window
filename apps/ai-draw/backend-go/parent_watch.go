package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func startParentWatchFromEnv() {
	pidText := strings.TrimSpace(os.Getenv("FW_APP_PARENT_PID"))
	if pidText == "" {
		return
	}
	pid, err := strconv.Atoi(pidText)
	if err != nil || pid <= 0 {
		return
	}
	go func() {
		for {
			time.Sleep(2 * time.Second)
			if !processExists(pid) {
				os.Exit(0)
			}
		}
	}()
}

func processExists(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := process.Signal(os.Signal(nil)); err != nil {
		return false
	}
	return true
}
