package main

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const thumbnailCommandOutputLimit = 16 * 1024

type thumbnailCommand struct {
	Binary          string
	Args            []string
	DependencyLabel string
	FailureLabel    string
	Timeout         time.Duration
}

func runThumbnailCommand(command thumbnailCommand) error {
	timeout := command.Timeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, command.Binary, command.Args...)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("%s超时", nonEmpty(command.FailureLabel, "缩略图生成失败"))
	}
	if errors.Is(err, exec.ErrNotFound) {
		return fmt.Errorf("%s不可用：%w", nonEmpty(command.DependencyLabel, "缩略图生成依赖"), err)
	}
	message := strings.TrimSpace(string(output))
	if len(message) > thumbnailCommandOutputLimit {
		message = message[:thumbnailCommandOutputLimit]
	}
	if message == "" {
		message = err.Error()
	}
	return fmt.Errorf("%s：%s", nonEmpty(command.FailureLabel, "缩略图生成失败"), message)
}
