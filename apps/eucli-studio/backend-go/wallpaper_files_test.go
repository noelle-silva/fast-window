package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testImageDataURL(mime string, payload []byte) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(payload)
}

func TestWallpaperFileWriteReadRemove(t *testing.T) {
	dir := t.TempDir()
	relPath := "wallpapers/w_001.png"

	if err := writeWallpaperFile(dir, relPath, testImageDataURL("image/png", []byte("wallpaper-bytes"))); err != nil {
		t.Fatalf("writeWallpaperFile: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "wallpapers", "w_001.png")); err != nil {
		t.Fatalf("wallpaper file missing on disk: %v", err)
	}

	dataURL, err := readWallpaperFile(dir, relPath)
	if err != nil {
		t.Fatalf("readWallpaperFile: %v", err)
	}
	if !strings.HasPrefix(dataURL, "data:image/png;base64,") {
		t.Fatalf("unexpected data url prefix: %q", dataURL)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, "data:image/png;base64,"))
	if err != nil || string(decoded) != "wallpaper-bytes" {
		t.Fatalf("unexpected payload: %q (%v)", string(decoded), err)
	}

	if err := removeWallpaperFile(dir, relPath); err != nil {
		t.Fatalf("removeWallpaperFile: %v", err)
	}
	if _, err := readWallpaperFile(dir, relPath); err == nil {
		t.Fatalf("expected read to fail after remove")
	}
	if err := removeWallpaperFile(dir, relPath); err != nil {
		t.Fatalf("removeWallpaperFile on missing file should be a no-op: %v", err)
	}
}

func TestWallpaperFileRejectsInvalidInput(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name    string
		relPath string
		dataURL string
	}{
		{"非壁纸目录", "roles/role/avatar.png", testImageDataURL("image/png", []byte("x"))},
		{"目录越级", "wallpapers/../escape.png", testImageDataURL("image/png", []byte("x"))},
		{"多级子目录", "wallpapers/sub/x.png", testImageDataURL("image/png", []byte("x"))},
		{"非法标识", "wallpapers/壁纸.png", testImageDataURL("image/png", []byte("x"))},
		{"不支持的扩展名", "wallpapers/x.exe", testImageDataURL("image/png", []byte("x"))},
		{"类型与扩展名不匹配", "wallpapers/x.jpg", testImageDataURL("image/png", []byte("x"))},
		{"非 data url", "wallpapers/x.png", "https://example.com/x.png"},
		{"空内容", "wallpapers/x.png", "data:image/png;base64,"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := writeWallpaperFile(dir, tc.relPath, tc.dataURL); err == nil {
				t.Fatalf("expected write to fail for %s", tc.relPath)
			}
		})
	}
}

func TestWallpaperFileRejectsOversize(t *testing.T) {
	dir := t.TempDir()
	payload := bytes.Repeat([]byte{7}, wallpaperMaxBytes+1)
	if err := writeWallpaperFile(dir, "wallpapers/big.png", testImageDataURL("image/png", payload)); err == nil {
		t.Fatalf("expected oversize wallpaper to be rejected")
	}
}

func TestIsWallpaperRelPath(t *testing.T) {
	if !isWallpaperRelPath("wallpapers/x.png") {
		t.Fatalf("expected wallpapers/ prefix to be recognized")
	}
	if isWallpaperRelPath("stickers/x.png") || isWallpaperRelPath("wallpapers") {
		t.Fatalf("unexpected wallpaper path match")
	}
}
