package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
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

func (store *imageStore) exportToDir(relativePaths []string, targetDir string) ([]string, error) {
	paths := normalizeImagePathList(relativePaths, 5000)
	if len(paths) == 0 {
		return nil, newDirectError(errorBadRequest, "请选择要导出的图片")
	}
	targetDir = strings.TrimSpace(targetDir)
	if err := ensureWritableDir(targetDir, "导出目录"); err != nil {
		return nil, err
	}

	exported := make([]string, 0, len(paths))
	for _, relPath := range paths {
		sourcePath, sourceRel, err := store.safePath(relPath)
		if err != nil {
			return nil, err
		}
		if !isImageFileName(sourceRel) {
			return nil, newDirectError(errorBadRequest, "只能导出图片文件")
		}
		targetPath, err := uniqueTargetPath(targetDir, filepath.Base(sourceRel))
		if err != nil {
			return nil, err
		}
		if err := copyFileNoOverwrite(sourcePath, targetPath); err != nil {
			return nil, newDirectError(errorStorageFailed, fmt.Sprintf("导出图片失败: %v", err))
		}
		exported = append(exported, targetPath)
	}
	return exported, nil
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
	return ensureWritableDir(path, "输出目录")
}

func ensureWritableDir(path string, label string) error {
	value := strings.TrimSpace(path)
	if value == "" || !filepath.IsAbs(value) {
		return newDirectError(errorBadRequest, label+"无效")
	}
	if err := os.MkdirAll(value, 0o755); err != nil {
		return newDirectError(errorStorageFailed, fmt.Sprintf("创建%s失败: %v", label, err))
	}
	testPath := filepath.Join(value, ".fw-ai-draw-write-test")
	if err := os.WriteFile(testPath, []byte("ok"), 0o644); err != nil {
		return newDirectError(errorStorageFailed, fmt.Sprintf("%s不可写: %v", label, err))
	}
	_ = os.Remove(testPath)
	return nil
}

func normalizeImagePathList(raw []string, limit int) []string {
	out := make([]string, 0, len(raw))
	seen := make(map[string]bool)
	for _, item := range raw {
		path := strings.TrimSpace(item)
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		out = append(out, path)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func uniqueTargetPath(targetDir string, fileName string) (string, error) {
	baseName := filepath.Base(strings.TrimSpace(fileName))
	if baseName == "." || baseName == string(os.PathSeparator) || baseName == "" {
		baseName = randomImageName("png")
	}
	ext := filepath.Ext(baseName)
	stem := strings.TrimSuffix(baseName, ext)
	if stem == "" {
		stem = "image"
	}
	path := filepath.Join(targetDir, baseName)
	if _, err := os.Stat(path); err == nil {
		// Try suffixed names below.
	} else if errors.Is(err, os.ErrNotExist) {
		return path, nil
	} else {
		return "", newDirectError(errorStorageFailed, fmt.Sprintf("检查导出文件失败: %v", err))
	}
	for i := 1; ; i++ {
		candidate := filepath.Join(targetDir, fmt.Sprintf("%s-%d%s", stem, i, ext))
		if _, err := os.Stat(candidate); err == nil {
			continue
		} else if errors.Is(err, os.ErrNotExist) {
			return candidate, nil
		} else {
			return "", newDirectError(errorStorageFailed, fmt.Sprintf("检查导出文件失败: %v", err))
		}
	}
}

func copyFileNoOverwrite(sourcePath string, targetPath string) error {
	input, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(targetPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(targetPath)
		return closeErr
	}
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
