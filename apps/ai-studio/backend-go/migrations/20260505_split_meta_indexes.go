package migrations

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const splitMetaIndexesID = "2026-05-05-split-meta-indexes"

func SplitMetaIndexes() Migration {
	return Migration{
		ID:          splitMetaIndexesID,
		FromVersion: 5,
		ToVersion:   6,
		Description: "拆分 meta/index 中的聊天索引和供应商配置",
		Recovery: recoverySpec([]string{
			"meta/index.json",
			"chats/index.json",
			"chats/*/index.json",
			"groups/index.json",
			"groups/*/chats/index.json",
			"groups/*/chats/*.json",
			"groups/*/chats/*/images",
			"providers",
			"images",
		}, "splits indexes and providers out of meta, rewrites group chat image paths, and may remove migrated legacy images"),
		Apply:       applySplitMetaIndexes,
	}
}

func applySplitMetaIndexes(ctx Context) error {
	meta := ctx.Meta
	if meta == nil {
		return errors.New("meta is nil")
	}
	now := nowMsForMigration()

	roleOrder := normalizeStringList(meta["roleOrder"])
	roleFolders := normalizeStringMap(meta["roleFolders"])
	chatIndexByRole := asMap(meta["chatIndexByRole"])
	if err := writeJSONIfSameOrMissing(ctx.DataDir, splitChatsIndexKey(), map[string]any{
		"schemaVersion": 1,
		"updatedAt":     now,
		"roleOrder":     roleOrder,
		"roleFolders":   roleFolders,
	}); err != nil {
		return err
	}
	for _, roleID := range roleOrder {
		folder := strings.TrimSpace(roleFolders[roleID])
		if folder == "" {
			continue
		}
		idx := asMap(chatIndexByRole[roleID])
		if err := writeJSONIfSameOrMissing(ctx.DataDir, splitRoleChatIndexKey(folder), map[string]any{
			"schemaVersion": 1,
			"roleId":        roleID,
			"roleFolder":    folder,
			"activeChatId":  strings.TrimSpace(asString(idx["activeChatId"])),
			"chatIds":       normalizeStringList(idx["chatIds"]),
			"chatUpdatedAt": asMapOrEmpty(idx["chatUpdatedAt"]),
			"updatedAt":     now,
		}); err != nil {
			return err
		}
	}

	groupOrder := normalizeStringList(meta["groupOrder"])
	groupFolders := normalizeStringMap(meta["groupFolders"])
	chatIndexByGroup := asMap(meta["chatIndexByGroup"])
	if err := writeJSONIfSameOrMissing(ctx.DataDir, splitGroupsIndexKey(), map[string]any{
		"schemaVersion": 1,
		"updatedAt":     now,
		"groupOrder":    groupOrder,
		"groupFolders":  groupFolders,
	}); err != nil {
		return err
	}
	for _, groupID := range groupOrder {
		folder := strings.TrimSpace(groupFolders[groupID])
		if folder == "" {
			continue
		}
		idx := asMap(chatIndexByGroup[groupID])
		if err := writeJSONIfSameOrMissing(ctx.DataDir, splitGroupChatIndexKey(folder), map[string]any{
			"schemaVersion": 1,
			"groupId":       groupID,
			"groupFolder":   folder,
			"activeChatId":  strings.TrimSpace(asString(idx["activeChatId"])),
			"chatIds":       normalizeStringList(idx["chatIds"]),
			"chatUpdatedAt": asMapOrEmpty(idx["chatUpdatedAt"]),
			"updatedAt":     now,
		}); err != nil {
			return err
		}
	}
	if err := migrateGroupChatImagesIntoPackages(ctx.DataDir, groupOrder, groupFolders, chatIndexByGroup); err != nil {
		return err
	}

	settings := asMap(meta["settings"])
	providers := normalizeObjectList(settings["providers"])
	providerOrder, providerFolders := buildProviderIndex(providers)
	if err := writeJSONIfSameOrMissing(ctx.DataDir, splitProvidersIndexKey(), map[string]any{
		"schemaVersion":   1,
		"updatedAt":       now,
		"providerOrder":   providerOrder,
		"providerFolders": providerFolders,
	}); err != nil {
		return err
	}
	for _, provider := range providers {
		providerID := strings.TrimSpace(asString(provider["id"]))
		folder := strings.TrimSpace(providerFolders[providerID])
		if providerID == "" || folder == "" {
			continue
		}
		if err := writeJSONIfSameOrMissing(ctx.DataDir, splitProviderKey(folder), provider); err != nil {
			return err
		}
	}

	delete(meta, "roleOrder")
	delete(meta, "roleFolders")
	delete(meta, "chatIndexByRole")
	delete(meta, "groupOrder")
	delete(meta, "groupFolders")
	delete(meta, "chatIndexByGroup")
	if settings != nil {
		delete(settings, "providers")
		meta["settings"] = settings
	}
	return nil
}

func migrateGroupChatImagesIntoPackages(dataDir string, groupOrder []string, groupFolders map[string]string, chatIndexByGroup map[string]any) error {
	if len(groupOrder) == 0 {
		return nil
	}
	refCounts, err := collectGlobalImageRefCounts(dataDir)
	if err != nil {
		return err
	}
	for _, groupID := range groupOrder {
		folder := strings.TrimSpace(groupFolders[groupID])
		if folder == "" {
			continue
		}
		idx := asMap(chatIndexByGroup[groupID])
		for _, chatID := range normalizeStringList(idx["chatIds"]) {
			if err := migrateGroupChatImagesIntoPackage(dataDir, folder, chatID, refCounts); err != nil {
				return err
			}
		}
	}
	return removeEmptyDirIfExists(filepath.Join(dataDir, "images"))
}

func migrateGroupChatImagesIntoPackage(dataDir string, folder string, chatID string, refCounts map[string]int) error {
	chatPath, err := storagePathForKey(dataDir, splitGroupChatKeyForMigration(folder, chatID))
	if err != nil {
		return err
	}
	rawBytes, err := os.ReadFile(chatPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(rawBytes)) == "" {
		return nil
	}
	var chat map[string]any
	if err := json.Unmarshal(rawBytes, &chat); err != nil {
		return err
	}
	changed, err := moveGroupChatImagesIntoPackage(dataDir, folder, chatID, chat, refCounts)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	payload, err := json.MarshalIndent(chat, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return atomicWriteFile(chatPath, payload, 0o644)
}

func moveGroupChatImagesIntoPackage(dataDir string, folder string, chatID string, chat map[string]any, refCounts map[string]int) (bool, error) {
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
			currentRel := normalizeStoredImageRelPath(imagePath)
			if currentRel == "" || !shouldMoveLegacyImageIntoGroupPackage(currentRel) {
				next = append(next, rawImage)
				continue
			}
			newRel, moved, err := copyGroupChatImageIntoPackage(dataDir, folder, chatID, currentRel, usedNames, copiedBySource, refCounts)
			if err != nil {
				return false, err
			}
			if moved {
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

func copyGroupChatImageIntoPackage(dataDir string, folder string, chatID string, currentRel string, usedNames map[string]bool, copiedBySource map[string]string, refCounts map[string]int) (string, bool, error) {
	oldPath, _, err := imagePathForRel(dataDir, currentRel)
	if err != nil {
		return "", false, nil
	}
	if cached := copiedBySource[strings.ToLower(currentRel)]; cached != "" {
		if decrementImageRefCount(refCounts, currentRel) <= 0 {
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
	newRel := groupChatImageRelPathForMigration(folder, chatID, name)
	newPath, _, err := imagePathForRel(dataDir, newRel)
	if err != nil {
		return "", false, err
	}
	if _, err := os.Stat(newPath); err == nil {
		copiedBySource[strings.ToLower(currentRel)] = newRel
		if decrementImageRefCount(refCounts, currentRel) <= 0 {
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
	if decrementImageRefCount(refCounts, currentRel) <= 0 {
		_ = os.Remove(oldPath)
	}
	return newRel, true, nil
}

func shouldMoveLegacyImageIntoGroupPackage(relPath string) bool {
	value := strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
	return strings.HasPrefix(value, "images/")
}

func splitGroupChatKeyForMigration(folder string, chatID string) string {
	return "groups/" + strings.TrimSpace(folder) + "/chats/" + strings.TrimSpace(chatID)
}

func groupChatImageRelPathForMigration(folder string, chatID string, fileName string) string {
	return filepath.ToSlash(filepath.Join("groups", strings.TrimSpace(folder), "chats", strings.TrimSpace(chatID), "images", sanitizeImageFileName(fileName)))
}

func removeEmptyDirIfExists(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		if strings.Contains(strings.ToLower(err.Error()), "directory not empty") || strings.Contains(strings.ToLower(err.Error()), "not empty") {
			return nil
		}
		return err
	}
	return nil
}

func buildProviderIndex(providers []map[string]any) ([]string, map[string]string) {
	order := make([]string, 0, len(providers))
	folders := map[string]string{}
	used := map[string]bool{}
	for _, provider := range providers {
		providerID := strings.TrimSpace(asString(provider["id"]))
		if providerID == "" {
			continue
		}
		order = append(order, providerID)
		folder := safeDirNameGo(firstNonEmptyStringForMigration(provider["name"], provider["id"]), "供应商")
		base := folder
		for i := 2; used[strings.ToLower(folder)]; i++ {
			folder = fmt.Sprintf("%s__%d", base, i)
		}
		used[strings.ToLower(folder)] = true
		folders[providerID] = folder
	}
	return order, folders
}

func writeJSONIfSameOrMissing(dataDir string, key string, value any) error {
	path, err := storagePathForKey(dataDir, key)
	if err != nil {
		return err
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	existing, err := os.ReadFile(path)
	if err == nil {
		if jsonPayloadEqual(existing, payload) {
			return nil
		}
		return fmt.Errorf("目标文件已存在且内容不同：%s", filepath.ToSlash(key)+".json")
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return atomicWriteFile(path, payload, 0o644)
}

func jsonPayloadEqual(left []byte, right []byte) bool {
	var leftValue any
	var rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return bytes.Equal(left, right)
	}
	leftNorm, _ := json.Marshal(leftValue)
	rightNorm, _ := json.Marshal(rightValue)
	return bytes.Equal(leftNorm, rightNorm)
}

func splitChatsIndexKey() string {
	return "chats/index"
}

func splitRoleChatIndexKey(folder string) string {
	return "chats/" + strings.TrimSpace(folder) + "/index"
}

func splitGroupsIndexKey() string {
	return "groups/index"
}

func splitGroupChatIndexKey(folder string) string {
	return "groups/" + strings.TrimSpace(folder) + "/chats/index"
}

func splitProvidersIndexKey() string {
	return "providers/index"
}

func splitProviderKey(folder string) string {
	return "providers/" + strings.TrimSpace(folder) + "/provider"
}

func normalizeStringList(raw any) []string {
	items := asSlice(raw)
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		value := strings.TrimSpace(asString(item))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func normalizeStringMap(raw any) map[string]string {
	src := asMap(raw)
	out := map[string]string{}
	for key, value := range src {
		k := strings.TrimSpace(key)
		v := strings.TrimSpace(asString(value))
		if k != "" && v != "" {
			out[k] = v
		}
	}
	return out
}

func asMapOrEmpty(raw any) map[string]any {
	value := asMap(raw)
	if value == nil {
		return map[string]any{}
	}
	return value
}

func firstNonEmptyStringForMigration(items ...any) string {
	for _, item := range items {
		value := strings.TrimSpace(asString(item))
		if value != "" {
			return value
		}
	}
	return ""
}

func safeDirNameGo(input string, fallback string) string {
	raw := strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
	base := raw
	if base == "" {
		base = fallback
	}
	name := strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, base)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if name == "" {
		name = fallback
	}
	upper := strings.ToUpper(name)
	reserved := upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL" || name == "." || name == ".."
	if !reserved && len(upper) == 4 {
		reserved = (strings.HasPrefix(upper, "COM") || strings.HasPrefix(upper, "LPT")) && upper[3] >= '1' && upper[3] <= '9'
	}
	if reserved {
		name = "_" + name
	}
	if len([]rune(name)) > 60 {
		name = string([]rune(name)[:60])
		name = strings.TrimSpace(name)
	}
	if name == "" {
		return fallback
	}
	return name
}

func nowMsForMigration() int64 {
	return time.Now().UnixMilli()
}
