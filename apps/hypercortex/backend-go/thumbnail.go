package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultThumbnailWidth = 320
const defaultThumbnailHeight = 180
const maxThumbnailDimension = 1920

func generateVideoThumbnailFile(source string, output string, width int, height int) error {
	width, height = normalizeThumbnailSize(width, height)
	filter := fmt.Sprintf("thumbnail,scale=%d:-1", width)
	if height > 0 {
		filter = fmt.Sprintf("thumbnail,scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2", width, height, width, height)
	}
	return runFFmpeg([]string{"-y", "-hide_banner", "-loglevel", "error", "-i", source, "-frames:v", "1", "-vf", filter, output})
}

func normalizeThumbnailSize(width int, height int) (int, int) {
	if width <= 0 {
		width = defaultThumbnailWidth
	}
	if width > maxThumbnailDimension {
		width = maxThumbnailDimension
	}
	if height < 0 {
		height = 0
	}
	if height > maxThumbnailDimension {
		height = maxThumbnailDimension
	}
	return width, height
}

func runFFmpeg(args []string) error {
	return runThumbnailCommand(thumbnailCommand{
		Binary:          resolveFFmpegBinary(),
		Args:            args,
		DependencyLabel: "视频缩略图依赖 ffmpeg ",
		FailureLabel:    "视频缩略图生成失败",
		Timeout:         45 * time.Second,
	})
}

func resolveFFmpegBinary() string {
	if configured := strings.TrimSpace(os.Getenv("FW_HYPERCORTEX_FFMPEG")); configured != "" {
		if exists(configured) {
			return configured
		}
	}

	for _, candidate := range bundledFFmpegCandidates() {
		if exists(candidate) {
			return candidate
		}
	}

	return "ffmpeg"
}

func bundledFFmpegCandidates() []string {
	name := "ffmpeg"
	if isWindows() {
		name = "ffmpeg.exe"
	}

	var candidates []string
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(dir, "bin", name))
		candidates = append(candidates, filepath.Join(dir, name))
	}
	return candidates
}

func isWindows() bool {
	return filepath.Separator == '\\'
}
