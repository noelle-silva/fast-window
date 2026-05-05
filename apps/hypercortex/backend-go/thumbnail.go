package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const defaultThumbnailWidth = 320

func (svc *service) createVideoThumbnail(scope string, relPath string, width int, height int) (string, error) {
	if width <= 0 {
		width = defaultThumbnailWidth
	}
	if width > 1920 {
		width = 1920
	}
	source, err := svc.resolvePath(scope, relPath)
	if err != nil {
		return "", err
	}
	if !exists(source) {
		return "", errors.New("视频文件不存在")
	}
	output := filepath.Join(os.TempDir(), fmt.Sprintf("hypercortex-thumb-%d-%d.jpg", os.Getpid(), time.Now().UnixNano()))
	defer os.Remove(output)

	filter := fmt.Sprintf("thumbnail,scale=%d:-1", width)
	if height > 0 {
		filter = fmt.Sprintf("thumbnail,scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2", width, height, width, height)
	}
	if err := runFFmpeg([]string{"-y", "-hide_banner", "-loglevel", "error", "-i", source, "-frames:v", "1", "-vf", filter, output}); err != nil {
		return "", err
	}
	data, err := os.ReadFile(output)
	if err != nil {
		return "", fmt.Errorf("读取视频缩略图失败: %w", err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data), nil
}

func runFFmpeg(args []string) error {
	cmd := exec.Command("ffmpeg", args...)
	output, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return fmt.Errorf("视频缩略图依赖 ffmpeg 不可用：%w", err)
	}
	message := strings.TrimSpace(string(output))
	if len(message) > 16*1024 {
		message = message[:16*1024]
	}
	if message == "" {
		message = err.Error()
	}
	return fmt.Errorf("视频缩略图生成失败：%s", message)
}
