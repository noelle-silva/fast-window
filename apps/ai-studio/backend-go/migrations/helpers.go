package migrations

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func storagePathForKey(dataDir string, key string) (string, error) {
	cleanKey, runtime, err := cleanStorageKey(key)
	if err != nil {
		return "", err
	}
	baseDir := dataDir
	if runtime {
		baseDir = filepath.Join(dataDir, "runtime")
	}
	return safeJoin(baseDir, filepath.FromSlash(cleanKey)+".json")
}

func imagePathForRel(dataDir string, raw string) (string, string, error) {
	relPath, err := cleanImageRelPath(raw)
	if err != nil {
		return "", "", err
	}
	path, err := safeJoin(dataDir, filepath.FromSlash(relPath))
	return path, relPath, err
}

func legacyImagePathForRel(dataDir string, raw string) (string, string, error) {
	relPath, err := cleanImageRelPath(raw)
	if err != nil {
		return "", "", err
	}
	path, err := safeJoin(filepath.Join(dataDir, "ref-images"), filepath.FromSlash(relPath))
	return path, relPath, err
}

func cleanStorageKey(raw string) (string, bool, error) {
	key := strings.TrimSpace(raw)
	if key == "" {
		return "", false, errors.New("key is required")
	}
	if len(key) > 600 {
		return "", false, errors.New("storage key is too long")
	}
	if strings.Contains(key, "\\") || strings.ContainsRune(key, 0) || strings.HasPrefix(key, "/") {
		return "", false, errors.New("storage key is invalid")
	}
	runtime := false
	if strings.HasPrefix(key, "runtime/") {
		runtime = true
		key = strings.TrimPrefix(key, "runtime/")
	}
	parts := strings.Split(key, "/")
	for _, part := range parts {
		segment := strings.TrimSpace(part)
		if segment == "" || segment == "." || segment == ".." {
			return "", false, errors.New("storage key has invalid path segment")
		}
	}
	return key, runtime, nil
}

func cleanImageRelPath(raw string) (string, error) {
	relPath := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if relPath == "" {
		return "", errors.New("image path is required")
	}
	if len(relPath) > 600 || strings.HasPrefix(relPath, "/") || strings.ContainsRune(relPath, 0) {
		return "", errors.New("image path is invalid")
	}
	parts := strings.Split(relPath, "/")
	for _, part := range parts {
		segment := strings.TrimSpace(part)
		if segment == "" || segment == "." || segment == ".." {
			return "", errors.New("image path has invalid path segment")
		}
	}
	ext := strings.ToLower(filepath.Ext(relPath))
	if !isAllowedImageExt(ext) {
		return "", fmt.Errorf("unsupported image extension: %s", ext)
	}
	return relPath, nil
}

func safeJoin(baseDir string, relPath string) (string, error) {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	fullAbs, err := filepath.Abs(filepath.Join(baseAbs, relPath))
	if err != nil {
		return "", err
	}
	baseClean := filepath.Clean(baseAbs)
	fullClean := filepath.Clean(fullAbs)
	if fullClean != baseClean && !strings.HasPrefix(fullClean, baseClean+string(os.PathSeparator)) {
		return "", errors.New("path traversal detected")
	}
	return fullClean, nil
}

func atomicWriteFile(path string, payload []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixMilli())
	if err := os.WriteFile(tmp, payload, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			_ = os.Remove(tmp)
			return removeErr
		}
		if renameErr := os.Rename(tmp, path); renameErr != nil {
			_ = os.Remove(tmp)
			return renameErr
		}
	}
	return nil
}

func copyFile(src string, dst string, perm os.FileMode) error {
	payload, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, payload, perm)
}

func isAllowedImageExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp":
		return true
	default:
		return false
	}
}

func asString(raw any) string {
	switch v := raw.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func asMap(raw any) map[string]any {
	value, _ := raw.(map[string]any)
	return value
}

func asSlice(raw any) []any {
	value, _ := raw.([]any)
	return value
}

func normalizeObjectList(raw any) []map[string]any {
	list := asSlice(raw)
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		obj := asMap(item)
		if obj != nil {
			out = append(out, obj)
		}
	}
	return out
}

func objectListAsAny(items []map[string]any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}
