package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const externalCommandGrace = 1500 * time.Millisecond

func runCommandOutput(timeout time.Duration, name string, args ...string) (string, error) {
	if timeout <= 0 {
		return "", fmt.Errorf("command timeout must be positive")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	output, err := cmd.CombinedOutput()
	text := string(output)
	message := strings.TrimSpace(text)
	if ctx.Err() != nil {
		if message != "" {
			return text, fmt.Errorf("command timed out after %s: %s", timeout, message)
		}
		return text, fmt.Errorf("command timed out after %s", timeout)
	}
	if err != nil {
		if message != "" {
			return text, fmt.Errorf("%w: %s", err, message)
		}
		return text, err
	}
	return text, nil
}

func commandTimeoutWithGrace(operationTimeout time.Duration) time.Duration {
	if operationTimeout <= 0 {
		return externalCommandGrace
	}
	return operationTimeout + externalCommandGrace
}

func timeoutMilliseconds(timeout time.Duration) int64 {
	if timeout <= 0 {
		return 1
	}
	return int64((timeout + time.Millisecond - 1) / time.Millisecond)
}
