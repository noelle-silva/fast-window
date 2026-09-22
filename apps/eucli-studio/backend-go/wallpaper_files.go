package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// 壁纸素材落在客户端数据目录：<dataDir>/wallpapers/<id>.<ext>。
// 元数据（预设清单、取景、当前项）由前端设置数据保存，这里只负责素材文件本身。
const wallpaperDirName = "wallpapers"
const wallpaperMaxBytes = 12 << 20

var wallpaperIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

var wallpaperMimeByExt = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"webp": "image/webp",
	"gif":  "image/gif",
}

type wallpaperAsset struct {
	name string
	ext  string
}

func isWallpaperRelPath(relPath string) bool {
	p := strings.TrimSpace(filepath.ToSlash(relPath))
	return strings.HasPrefix(p, wallpaperDirName+"/")
}

func parseWallpaperRelPath(relPath string) (wallpaperAsset, error) {
	p := strings.TrimSpace(filepath.ToSlash(relPath))
	parts := strings.Split(p, "/")
	if len(parts) != 2 || parts[0] != wallpaperDirName {
		return wallpaperAsset{}, newError("BAD_REQUEST", "壁纸路径无效")
	}
	file := parts[1]
	dot := strings.LastIndex(file, ".")
	if dot <= 0 || dot == len(file)-1 {
		return wallpaperAsset{}, newError("BAD_REQUEST", "壁纸路径无效")
	}
	id := file[:dot]
	ext := strings.ToLower(file[dot+1:])
	if !wallpaperIDPattern.MatchString(id) {
		return wallpaperAsset{}, newError("BAD_REQUEST", "壁纸标识无效")
	}
	if _, ok := wallpaperMimeByExt[ext]; !ok {
		return wallpaperAsset{}, newError("BAD_REQUEST", "壁纸格式不支持")
	}
	return wallpaperAsset{name: file, ext: ext}, nil
}

func parseImageDataURL(dataUrl string) (string, string, error) {
	raw := strings.TrimSpace(dataUrl)
	if !strings.HasPrefix(raw, "data:") {
		return "", "", newError("BAD_REQUEST", "壁纸内容必须是图片 data url")
	}
	comma := strings.Index(raw, ",")
	if comma <= 0 {
		return "", "", newError("BAD_REQUEST", "壁纸内容必须是图片 data url")
	}
	header := raw[len("data:"):comma]
	payload := raw[comma+1:]
	if !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return "", "", newError("BAD_REQUEST", "壁纸内容必须是 base64 图片")
	}
	mime := header[:strings.Index(strings.ToLower(header), ";base64")]
	if mime == "" {
		return "", "", newError("BAD_REQUEST", "壁纸内容缺少图片类型")
	}
	if payload == "" {
		return "", "", newError("BAD_REQUEST", "壁纸内容为空")
	}
	return strings.ToLower(mime), payload, nil
}

func wallpaperExtByMime(mime string) string {
	for ext, candidate := range wallpaperMimeByExt {
		if candidate == mime {
			if ext == "jpeg" {
				return "jpg"
			}
			return ext
		}
	}
	return ""
}

func wallpaperFilePath(dataDir string, asset wallpaperAsset) string {
	return filepath.Join(dataDir, wallpaperDirName, asset.name)
}

func writeWallpaperFile(dataDir string, relPath string, dataUrl string) error {
	asset, err := parseWallpaperRelPath(relPath)
	if err != nil {
		return err
	}
	mime, payload, err := parseImageDataURL(dataUrl)
	if err != nil {
		return err
	}
	if wallpaperMimeByExt[asset.ext] != mime {
		return newError("BAD_REQUEST", "壁纸文件名与图片类型不匹配")
	}
	decoded, decodeErr := base64.StdEncoding.DecodeString(payload)
	if decodeErr != nil || len(decoded) == 0 {
		return newError("BAD_REQUEST", "壁纸内容解码失败")
	}
	if len(decoded) > wallpaperMaxBytes {
		return newError("BAD_REQUEST", fmt.Sprintf("壁纸文件超过 %dMB 上限", wallpaperMaxBytes>>20))
	}
	dir := filepath.Join(dataDir, wallpaperDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(wallpaperFilePath(dataDir, asset), decoded, 0o600)
}

func readWallpaperFile(dataDir string, relPath string) (string, error) {
	asset, err := parseWallpaperRelPath(relPath)
	if err != nil {
		return "", err
	}
	bytes, err := os.ReadFile(wallpaperFilePath(dataDir, asset))
	if err != nil {
		if os.IsNotExist(err) {
			return "", newError("NOT_FOUND", "壁纸文件不存在")
		}
		return "", err
	}
	if len(bytes) == 0 {
		return "", newError("NOT_FOUND", "壁纸文件为空")
	}
	mime := wallpaperMimeByExt[asset.ext]
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(bytes), nil
}

func removeWallpaperFile(dataDir string, relPath string) error {
	asset, err := parseWallpaperRelPath(relPath)
	if err != nil {
		return err
	}
	if err := os.Remove(wallpaperFilePath(dataDir, asset)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
