package main

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (svc *service) prepareStorageValueForSet(key string, value any) (any, error) {
	cleanKey, runtime, err := cleanStorageKey(key)
	if err != nil {
		return nil, err
	}
	if runtime || !isRoleChatStorageKey(cleanKey) {
		return value, nil
	}
	chat, ok := value.(map[string]any)
	if !ok || chat == nil {
		return value, nil
	}

	parts := strings.Split(cleanKey, "/")
	folder := parts[1]
	chatID := parts[2]
	changed, err := svc.ensureRoleChatImagesInPackage(folder, chatID, chat)
	if err != nil {
		return nil, err
	}
	if changed {
		return chat, nil
	}
	return value, nil
}

func isRoleChatStorageKey(cleanKey string) bool {
	parts := strings.Split(strings.TrimSpace(cleanKey), "/")
	return len(parts) == 4 && parts[0] == "chats" && parts[3] == "chat"
}

func (svc *service) ensureRoleChatImagesInPackage(folder string, chatID string, chat map[string]any) (bool, error) {
	messages := normalizeObjectList(chat["messages"])
	if len(messages) == 0 {
		return false, nil
	}
	changed := false
	usedNames := collectRoleChatPackageImageNames(messages)
	for _, msg := range messages {
		images := asSlice(msg["images"])
		if len(images) == 0 {
			continue
		}
		messageChanged := false
		next := make([]any, 0, len(images))
		for _, rawImage := range images {
			rel := strings.TrimSpace(asString(rawImage))
			if rel == "" {
				next = append(next, rawImage)
				continue
			}
			current := normalizeStoredImageRelPathGo(rel)
			if current == "" || isCurrentRoleChatPackageImagePathGo(current, folder, chatID) {
				next = append(next, rawImage)
				continue
			}
			newRel, ok, err := svc.copyImageIntoRoleChatPackage(folder, chatID, current, usedNames)
			if err != nil {
				return false, err
			}
			if ok {
				messageChanged = true
				changed = true
				next = append(next, newRel)
				continue
			}
			next = append(next, rawImage)
		}
		if messageChanged {
			msg["images"] = next
		}
	}
	if changed {
		chat["messages"] = objectListAsAny(messages)
	}
	return changed, nil
}

func collectRoleChatPackageImageNames(messages []map[string]any) map[string]bool {
	used := map[string]bool{}
	for _, msg := range messages {
		for _, rawImage := range asSlice(msg["images"]) {
			rel := strings.TrimSpace(asString(rawImage))
			if !isRoleChatPackageImagePathGo(rel) {
				continue
			}
			name := filepath.Base(strings.ReplaceAll(rel, "\\", "/"))
			if name != "" && name != "." {
				used[strings.ToLower(name)] = true
			}
		}
	}
	return used
}

func (svc *service) copyImageIntoRoleChatPackage(folder string, chatID string, currentRel string, usedNames map[string]bool) (string, bool, error) {
	oldPath := ""
	var err error
	if isRoleChatPackageImagePathGo(currentRel) {
		oldPath, _, err = svc.imagePathForRel(currentRel)
	} else if shouldMigrateLegacyImageSourceGo(currentRel) {
		oldPath, _, err = svc.legacyImagePathForRel(currentRel)
	} else {
		return "", false, nil
	}
	if err != nil {
		return "", false, nil
	}
	if _, err := os.Stat(oldPath); err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}

	name := uniqueImageFileNameGo(currentRel, usedNames)
	newRel := roleChatImageRelPathGo(folder, chatID, name)
	newPath, _, err := svc.imagePathForRel(newRel)
	if err != nil {
		return "", false, err
	}
	if _, err := os.Stat(newPath); err == nil {
		return newRel, true, nil
	}
	if err := copyFileLocal(oldPath, newPath, 0o644); err != nil {
		return "", false, err
	}
	return newRel, true, nil
}

func normalizeStoredImageRelPathGo(raw string) string {
	value := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if value == "" || strings.HasPrefix(value, "data:") {
		return ""
	}
	lower := strings.ToLower(value)
	if i := strings.LastIndex(lower, "/ref-images/"); i >= 0 {
		value = value[i+len("/ref-images/"):]
	} else if strings.HasPrefix(lower, "ref-images/") {
		value = value[len("ref-images/"):]
	}
	return strings.TrimLeft(value, "/")
}

func (svc *service) legacyImagePathForRel(raw string) (string, string, error) {
	relPath, err := cleanImageRelPath(raw)
	if err != nil {
		return "", "", err
	}
	path, err := safeJoin(svc.imagesDir(), filepath.FromSlash(relPath))
	return path, relPath, err
}

func isRoleChatPackageImagePathGo(relPath string) bool {
	parts := strings.Split(strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/")), "/")
	return len(parts) >= 5 && parts[0] == "chats" && parts[3] == "images"
}

func isCurrentRoleChatPackageImagePathGo(relPath string, folder string, chatID string) bool {
	parts := strings.Split(strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/")), "/")
	return len(parts) >= 5 && parts[0] == "chats" && parts[1] == strings.TrimSpace(folder) && parts[2] == strings.TrimSpace(chatID) && parts[3] == "images"
}

func shouldMigrateLegacyImageSourceGo(relPath string) bool {
	value := strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	if value == "" {
		return false
	}
	return !strings.HasPrefix(value, "stickers/") && !strings.HasPrefix(value, "roles/") && !strings.HasPrefix(value, "groups/")
}

func uniqueImageFileNameGo(relPath string, usedNames map[string]bool) string {
	name := sanitizeImageFileNameGo(filepath.Base(strings.ReplaceAll(relPath, "\\", "/")))
	base := strings.TrimSuffix(name, filepath.Ext(name))
	ext := filepath.Ext(name)
	if len(strings.Split(strings.TrimSpace(relPath), "/")) > 1 {
		base = base + "-" + shortImagePathHashGo(relPath)
		name = base + ext
		if len(name) > 120 {
			limit := 120 - len(ext)
			if limit < 1 {
				limit = 1
			}
			base = base[:minInt(len(base), limit)]
			name = base + ext
		}
	}
	for i := 0; ; i++ {
		candidate := name
		if i > 0 {
			candidate = fmt.Sprintf("%s-%d%s", base, i+1, ext)
		}
		key := strings.ToLower(candidate)
		if !usedNames[key] {
			usedNames[key] = true
			return candidate
		}
	}
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func shortImagePathHashGo(relPath string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.ToSlash(relPath))))
	return hex.EncodeToString(sum[:])[:10]
}

func copyFileLocal(src string, dst string, perm os.FileMode) error {
	payload, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, payload, perm)
}

func sanitizeImageFileNameGo(raw string) string {
	name := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if name == "" {
		name = "image.png"
	}
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\\|?*`, r) {
			return '_'
		}
		return r
	}, name)
	name = strings.Trim(strings.TrimSpace(name), ".")
	if name == "" {
		name = "image.png"
	}
	if len(name) > 120 {
		ext := filepath.Ext(name)
		base := strings.TrimSuffix(name, ext)
		if len(ext) > 12 {
			ext = ""
		}
		limit := 120 - len(ext)
		if limit < 1 {
			limit = 1
		}
		if len(base) > limit {
			base = base[:limit]
		}
		name = base + ext
	}
	if !isAllowedImageExt(filepath.Ext(name)) {
		name += ".png"
	}
	return name
}

func roleChatImageRelPathGo(folder string, chatID string, fileName string) string {
	return filepath.ToSlash(filepath.Join("chats", strings.TrimSpace(folder), strings.TrimSpace(chatID), "images", sanitizeImageFileNameGo(fileName)))
}
