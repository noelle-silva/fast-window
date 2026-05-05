package migrations

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const roleChatPackagesMigrationID = "2026-05-05-role-chat-packages"

func RoleChatPackages() Migration {
	return Migration{
		ID:          roleChatPackagesMigrationID,
		FromVersion: 2,
		ToVersion:   3,
		Description: "角色聊天记录目录化，并把每个聊天使用的图片收拢到对应聊天文件夹",
		Recovery: recoverySpec([]string{
			"chats",
			"ref-images/images",
		}, "migrates legacy role chat JSON files into chat package directories and may remove migrated legacy root images"),
		Apply:       applyRoleChatPackages,
	}
}

func applyRoleChatPackages(ctx Context) error {
	roleFolders := asMap(ctx.Meta["roleFolders"])
	chatIndexByRole := asMap(ctx.Meta["chatIndexByRole"])
	if len(roleFolders) == 0 || len(chatIndexByRole) == 0 {
		return nil
	}

	refCounts, err := collectGlobalImageRefCounts(ctx.DataDir)
	if err != nil {
		return err
	}

	for roleID, folderRaw := range roleFolders {
		folder := strings.TrimSpace(asString(folderRaw))
		if folder == "" {
			continue
		}
		idx := asMap(chatIndexByRole[roleID])
		for _, chatIDRaw := range asSlice(idx["chatIds"]) {
			chatID := strings.TrimSpace(asString(chatIDRaw))
			if chatID == "" {
				continue
			}
			if err := migrateRoleChatPackage(ctx.DataDir, folder, chatID, refCounts); err != nil {
				return err
			}
		}
	}

	return nil
}

func migrateRoleChatPackage(dataDir string, folder string, chatID string, refCounts map[string]int) error {
	oldPath, err := storagePathForKey(dataDir, splitChatLegacyKey(folder, chatID))
	if err != nil {
		return err
	}
	newPath, err := storagePathForKey(dataDir, splitChatKey(folder, chatID))
	if err != nil {
		return err
	}

	rawBytes, err := os.ReadFile(oldPath)
	if errors.Is(err, os.ErrNotExist) {
		if _, statErr := os.Stat(newPath); statErr == nil {
			return nil
		}
		return fmt.Errorf("角色聊天文件缺失：%s/%s", folder, chatID)
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(rawBytes)) == "" {
		return fmt.Errorf("角色聊天文件为空：%s/%s", folder, chatID)
	}

	var chat map[string]any
	if err := json.Unmarshal(rawBytes, &chat); err != nil {
		return fmt.Errorf("读取角色聊天失败：%s/%s：%w", folder, chatID, err)
	}
	if chat == nil {
		return nil
	}

	changed, err := moveRoleChatImagesIntoPackage(dataDir, folder, chatID, chat, refCounts)
	if err != nil {
		return err
	}

	payload := rawBytes
	if changed {
		payload, err = json.MarshalIndent(chat, "", "  ")
		if err != nil {
			return err
		}
		payload = append(payload, '\n')
	}
	if err := atomicWriteFile(newPath, payload, 0o644); err != nil {
		return err
	}
	if err := os.Remove(oldPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func moveRoleChatImagesIntoPackage(dataDir string, folder string, chatID string, chat map[string]any, refCounts map[string]int) (bool, error) {
	messages := normalizeObjectList(chat["messages"])
	if len(messages) == 0 {
		return false, nil
	}

	changed := false
	usedNames := map[string]bool{}
	copiedBySource := map[string]string{}
	for _, msg := range messages {
		images := asSlice(msg["images"])
		if len(images) == 0 {
			continue
		}
		messageChanged := false
		next := make([]any, 0, len(images))
		for _, rawImage := range images {
			imagePath := strings.TrimSpace(asString(rawImage))
			if imagePath == "" {
				next = append(next, rawImage)
				continue
			}
			newRel, moved, err := copyRoleChatImageIntoPackage(dataDir, folder, chatID, imagePath, usedNames, copiedBySource, refCounts)
			if err != nil {
				return false, err
			}
			if moved {
				messageChanged = true
				changed = true
				next = append(next, newRel)
			} else {
				next = append(next, rawImage)
			}
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

func copyRoleChatImageIntoPackage(dataDir string, folder string, chatID string, raw string, usedNames map[string]bool, copiedBySource map[string]string, refCounts map[string]int) (string, bool, error) {
	currentRel := normalizeStoredImageRelPath(raw)
	if currentRel == "" || IsRoleChatPackageImagePath(currentRel) || !shouldMigrateLegacyImageSource(currentRel) {
		return "", false, nil
	}
	oldPath, _, err := legacyImagePathForRel(dataDir, currentRel)
	if err != nil {
		return "", false, nil
	}
	if cached := copiedBySource[strings.ToLower(currentRel)]; cached != "" {
		if shouldRemoveLegacyImageSource(currentRel) && decrementImageRefCount(refCounts, currentRel) <= 0 {
			_ = os.Remove(oldPath)
		}
		return cached, true, nil
	}
	if _, err := os.Stat(oldPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", false, nil
		}
		return "", false, err
	}

	name := uniqueImageFileName(currentRel, usedNames)
	newRel := roleChatImageRelPath(folder, chatID, name)
	newPath, _, err := imagePathForRel(dataDir, newRel)
	if err != nil {
		return "", false, err
	}
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return "", false, err
	}
	if _, err := os.Stat(newPath); err == nil {
		copiedBySource[strings.ToLower(currentRel)] = newRel
		if shouldRemoveLegacyImageSource(currentRel) && decrementImageRefCount(refCounts, currentRel) <= 0 {
			_ = os.Remove(oldPath)
		}
		return newRel, true, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", false, err
	}

	if err := copyFile(oldPath, newPath, 0o644); err != nil {
		return "", false, err
	}
	copiedBySource[strings.ToLower(currentRel)] = newRel
	if shouldRemoveLegacyImageSource(currentRel) && decrementImageRefCount(refCounts, currentRel) <= 0 {
		_ = os.Remove(oldPath)
	}
	return newRel, true, nil
}

func shouldRemoveLegacyImageSource(relPath string) bool {
	value := strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	return shouldMigrateLegacyImageSource(value) && strings.HasPrefix(value, "images/")
}

func shouldMigrateLegacyImageSource(relPath string) bool {
	value := strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	if value == "" {
		return false
	}
	return !strings.HasPrefix(value, "stickers/") && !strings.HasPrefix(value, "roles/") && !strings.HasPrefix(value, "groups/")
}

func collectGlobalImageRefCounts(dataDir string) (map[string]int, error) {
	counts := map[string]int{}
	for _, root := range []string{"chats", "groups"} {
		base := filepath.Join(dataDir, root)
		if _, err := os.Stat(base); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, err
		}
		if err := filepath.Walk(base, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				return nil
			}
			if strings.ToLower(filepath.Ext(path)) != ".json" {
				return nil
			}
			return collectImageRefsFromJSONFile(path, counts)
		}); err != nil {
			return nil, err
		}
	}
	return counts, nil
}

func collectImageRefsFromJSONFile(path string, counts map[string]int) error {
	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(rawBytes)) == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal(rawBytes, &value); err != nil {
		return nil
	}
	collectImageRefsFromAny(value, counts)
	return nil
}

func collectImageRefsFromAny(value any, counts map[string]int) {
	switch item := value.(type) {
	case []any:
		for _, child := range item {
			collectImageRefsFromAny(child, counts)
		}
	case map[string]any:
		if images, ok := item["images"]; ok {
			for _, image := range asSlice(images) {
				rel := normalizeStoredImageRelPath(strings.TrimSpace(asString(image)))
				if rel != "" {
					counts[strings.ToLower(rel)]++
				}
			}
		}
		for _, child := range item {
			collectImageRefsFromAny(child, counts)
		}
	}
}

func normalizeStoredImageRelPath(raw string) string {
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

func IsRoleChatPackageImagePath(relPath string) bool {
	parts := strings.Split(strings.TrimSpace(relPath), "/")
	return len(parts) >= 5 && parts[0] == "chats" && parts[3] == "images"
}

func uniqueImageFileName(relPath string, usedNames map[string]bool) string {
	name := sanitizeImageFileName(filepath.Base(relPath))
	base := strings.TrimSuffix(name, filepath.Ext(name))
	ext := filepath.Ext(name)
	if imageNameNeedsHash(relPath) {
		base = base + "-" + shortImagePathHash(relPath)
		name = base + ext
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

func imageNameNeedsHash(relPath string) bool {
	parts := strings.Split(strings.TrimSpace(relPath), "/")
	return len(parts) > 1
}

func shortImagePathHash(relPath string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.ToSlash(relPath))))
	return hex.EncodeToString(sum[:])[:10]
}

func sanitizeImageFileName(raw string) string {
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

func decrementImageRefCount(refCounts map[string]int, relPath string) int {
	if refCounts == nil {
		return 0
	}
	key := strings.ToLower(strings.TrimSpace(relPath))
	if key == "" {
		return 0
	}
	count := refCounts[key]
	if count <= 0 {
		return 0
	}
	count--
	refCounts[key] = count
	return count
}

func splitChatKey(folder string, chatID string) string {
	return "chats/" + strings.TrimSpace(folder) + "/" + strings.TrimSpace(chatID) + "/chat"
}

func splitChatLegacyKey(folder string, chatID string) string {
	return "chats/" + strings.TrimSpace(folder) + "/" + strings.TrimSpace(chatID)
}

func roleChatImageRelPath(folder string, chatID string, fileName string) string {
	return filepath.ToSlash(filepath.Join("chats", strings.TrimSpace(folder), strings.TrimSpace(chatID), "images", sanitizeImageFileName(fileName)))
}
