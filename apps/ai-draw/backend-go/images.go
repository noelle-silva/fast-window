package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var imageDataURLPattern = regexp.MustCompile(`^data:(image/[a-zA-Z0-9.+-]+);base64,`)

type imageStore struct {
	mu      sync.RWMutex
	rootDir string
}

func newImageStore(rootDir string) *imageStore {
	return &imageStore{rootDir: rootDir}
}

func (store *imageStore) list() ([]string, error) {
	rootDir := store.currentRootDir()
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return nil, err
	}
	type fileItem struct {
		name  string
		mtime int64
	}
	items := make([]fileItem, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !isImageFileName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, fileItem{name: entry.Name(), mtime: info.ModTime().UnixMilli()})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mtime > items[j].mtime })
	paths := make([]string, 0, len(items))
	for _, item := range items {
		paths = append(paths, item.name)
	}
	return paths, nil
}

func (store *imageStore) read(relativePath string) (string, error) {
	path, rel, err := store.safePath(relativePath)
	if err != nil {
		return "", err
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	mime := mimeFromExt(rel)
	return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(bytes)), nil
}

func (store *imageStore) saveBase64(input string) (string, error) {
	mime, bytes, err := normalizeImageInput(input)
	if err != nil {
		return "", err
	}
	rootDir := store.currentRootDir()
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return "", err
	}
	fileName := randomImageName(extFromMime(mime))
	path := filepath.Join(rootDir, fileName)
	if err := atomicWriteFile(path, bytes, 0o644); err != nil {
		return "", err
	}
	return fileName, nil
}

func (store *imageStore) delete(relativePath string) error {
	path, _, err := store.safePath(relativePath)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (store *imageStore) safePath(relativePath string) (string, string, error) {
	rel := filepath.Clean(strings.TrimSpace(relativePath))
	if rel == "." || rel == "" || filepath.IsAbs(rel) || strings.HasPrefix(rel, "..") {
		return "", "", newDirectError("BAD_REQUEST", "图片路径无效")
	}
	rootAbs, err := filepath.Abs(store.currentRootDir())
	if err != nil {
		return "", "", err
	}
	fullAbs, err := filepath.Abs(filepath.Join(rootAbs, rel))
	if err != nil {
		return "", "", err
	}
	if fullAbs != rootAbs && !strings.HasPrefix(fullAbs, rootAbs+string(os.PathSeparator)) {
		return "", "", newDirectError("BAD_REQUEST", "图片路径越界")
	}
	return fullAbs, rel, nil
}

func (store *imageStore) currentRootDir() string {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.rootDir
}

func (store *imageStore) setRootDir(rootDir string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.rootDir = rootDir
}

func ensureWritableOutputDir(path string) error {
	value := strings.TrimSpace(path)
	if value == "" || !filepath.IsAbs(value) {
		return newDirectError(errorBadRequest, "输出目录无效")
	}
	if err := os.MkdirAll(value, 0o755); err != nil {
		return newDirectError(errorStorageFailed, fmt.Sprintf("创建输出目录失败: %v", err))
	}
	testPath := filepath.Join(value, ".fw-ai-draw-output-write-test")
	if err := os.WriteFile(testPath, []byte("ok"), 0o644); err != nil {
		return newDirectError(errorStorageFailed, fmt.Sprintf("输出目录不可写: %v", err))
	}
	_ = os.Remove(testPath)
	return nil
}

func normalizeImageInput(input string) (string, []byte, error) {
	value := strings.TrimSpace(input)
	if value == "" {
		return "", nil, newDirectError("IMAGE_INVALID", "图片数据为空")
	}
	mime := ""
	if match := imageDataURLPattern.FindStringSubmatch(value); len(match) == 2 {
		mime = strings.ToLower(match[1])
		value = value[len(match[0]):]
	}
	value = strings.ReplaceAll(value, " ", "")
	value = strings.ReplaceAll(value, "\n", "")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\t", "")
	value = strings.ReplaceAll(value, "-", "+")
	value = strings.ReplaceAll(value, "_", "/")
	switch len(value) % 4 {
	case 2:
		value += "=="
	case 3:
		value += "="
	case 1:
		return "", nil, newDirectError("IMAGE_INVALID", "图片 base64 无效")
	}
	bytes, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", nil, newDirectError("IMAGE_INVALID", "图片 base64 无效")
	}
	if mime == "" {
		mime = inferMime(bytes)
	}
	return mime, bytes, nil
}

func normalizeImageBase64(input string) string {
	_, bytes, err := normalizeImageInput(input)
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(bytes)
}

func inferMime(bytes []byte) string {
	if len(bytes) >= 8 && string(bytes[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png"
	}
	if len(bytes) >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
		return "image/jpeg"
	}
	if len(bytes) >= 12 && string(bytes[:4]) == "RIFF" && string(bytes[8:12]) == "WEBP" {
		return "image/webp"
	}
	if len(bytes) >= 6 && (string(bytes[:6]) == "GIF87a" || string(bytes[:6]) == "GIF89a") {
		return "image/gif"
	}
	return "image/png"
}

func mimeFromExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return "image/png"
	}
}

func extFromMime(mime string) string {
	switch strings.ToLower(mime) {
	case "image/jpeg":
		return "jpg"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	default:
		return "png"
	}
}

func isImageFileName(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return true
	default:
		return false
	}
}

func randomImageName(ext string) string {
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	stamp := time.Now().Format("20060102-150405")
	return fmt.Sprintf("%s-%x.%s", stamp, buf, ext)
}
