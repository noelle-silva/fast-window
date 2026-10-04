package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// scopeRoot 解析数据根：data 为应用设置域；legacyLibraryName 仅供迁移链重放历史布局；其余一律按仓库 ID 定位。
func (svc *service) scopeRoot(scope string) (string, error) {
	switch scope {
	case "data":
		return svc.stateDir, nil
	case legacyLibraryName:
		return svc.legacyLibraryDir, nil
	default:
		return svc.repoRoot(scope)
	}
}

func cleanRelPath(input string) (string, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return "", nil
	}
	if strings.ContainsRune(raw, 0) {
		return "", coded(codePathEscape, "路径包含非法空字节")
	}
	raw = strings.ReplaceAll(raw, "\\", "/")
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return "", coded(codePathEscape, "不允许绝对路径")
	}
	if len(raw) >= 2 && raw[1] == ':' {
		return "", coded(codePathEscape, "不允许 Windows 盘符路径")
	}
	parts := []string{}
	for _, part := range strings.Split(raw, "/") {
		part = strings.TrimSpace(part)
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", coded(codePathEscape, "不允许路径越界")
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return "", nil
	}
	return filepath.Join(parts...), nil
}

func (svc *service) resolvePath(scope string, rel string) (string, error) {
	root, err := svc.scopeRoot(scope)
	if err != nil {
		return "", err
	}
	return resolveUnderRoot(root, rel)
}

// resolveUnderRoot 在给定根目录下解析相对路径，拒绝越界。
func resolveUnderRoot(root string, rel string) (string, error) {
	clean, err := cleanRelPath(rel)
	if err != nil {
		return "", err
	}
	target := root
	if clean != "" {
		target = filepath.Join(root, clean)
	}
	if !isInside(root, target) {
		return "", coded(codePathEscape, "路径越界")
	}
	return target, nil
}

func isInside(parent string, child string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	if err != nil {
		return false
	}
	return rel == "." || (rel != "" && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func ensureParent(path string) error {
	return os.MkdirAll(filepath.Dir(path), 0o755)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func writeFileAtomic(path string, data []byte) error {
	if err := ensureParent(path); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func listDir(path string) ([]fileEntry, error) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]fileEntry, 0, len(entries))
	for _, entry := range entries {
		info, _ := entry.Info()
		var size int64
		var modified float64
		if info != nil {
			size = info.Size()
			modified = float64(info.ModTime().UnixMilli())
		}
		out = append(out, fileEntry{Name: entry.Name(), IsDirectory: entry.IsDir(), IsFile: !entry.IsDir(), Size: size, ModifiedMs: modified})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
