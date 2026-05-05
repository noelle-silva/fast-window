package migrations

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const removeMigratedRoleChatRootImagesID = "2026-05-05-remove-migrated-role-chat-root-images"

func RemoveMigratedRoleChatRootImages() Migration {
	return Migration{
		ID:          removeMigratedRoleChatRootImagesID,
		FromVersion: 3,
		ToVersion:   4,
		Description: "清理已经复制进角色聊天包的 ref-images 根部旧图片副本",
		Apply:       applyRemoveMigratedRoleChatRootImages,
	}
}

func applyRemoveMigratedRoleChatRootImages(ctx Context) error {
	chatFiles, err := roleChatPackageFiles(ctx.DataDir)
	if err != nil {
		return err
	}
	for _, chatPath := range chatFiles {
		chat, err := readJSONMap(chatPath)
		if err != nil {
			return err
		}
		for _, relPath := range collectRolePackageImageRefs(chat) {
			if err := removeLegacyRootImageIfSamePayload(ctx.DataDir, relPath); err != nil {
				return err
			}
		}
	}
	return nil
}

func roleChatPackageFiles(dataDir string) ([]string, error) {
	base := filepath.Join(dataDir, "chats")
	if _, err := os.Stat(base); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	if err := filepath.Walk(base, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		if filepath.Base(path) == "chat.json" {
			out = append(out, path)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

func readJSONMap(path string) (map[string]any, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func collectRolePackageImageRefs(chat map[string]any) []string {
	seen := map[string]bool{}
	var out []string
	for _, msg := range normalizeObjectList(chat["messages"]) {
		for _, rawImage := range asSlice(msg["images"]) {
			relPath := strings.TrimSpace(strings.ReplaceAll(asString(rawImage), "\\", "/"))
			if !IsRoleChatPackageImagePath(relPath) {
				continue
			}
			if seen[relPath] {
				continue
			}
			seen[relPath] = true
			out = append(out, relPath)
		}
	}
	return out
}

func removeLegacyRootImageIfSamePayload(dataDir string, packageRelPath string) error {
	packagePath, _, err := imagePathForRel(dataDir, packageRelPath)
	if err != nil {
		return nil
	}
	packagePayload, err := os.ReadFile(packagePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	rootPath := filepath.Join(dataDir, "ref-images", filepath.Base(packageRelPath))
	rootPayload, err := os.ReadFile(rootPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !bytes.Equal(packagePayload, rootPayload) {
		return nil
	}
	if err := os.Remove(rootPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
