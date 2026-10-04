package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const dataIdentitySplitMigration = "2026-09-26-data-identity-split"

// repoStateFieldKeys 是从元数据中拆出、归属笔记仓库身份的工作状态字段。
var repoStateFieldKeys = []string{
	"sidebarItems",
	"openTabKeys",
	"tabGroupByTabKey",
	"activeTabKey",
	"tabGroups",
	"workspaces",
	"activeWorkspaceId",
	"currentFolderId",
}

// migrateDataIdentitySplit 按身份归位数据：
// 元数据只保留应用设置，指向笔记内容的工作状态、收藏夹、派生缓存与派生索引指纹全部归入知识库。
func (svc *service) migrateDataIdentitySplit() error {
	if err := svc.splitMetadataIdentity(); err != nil {
		return err
	}
	for _, file := range []string{favoritesFile, facePluginsStateFile} {
		if err := moveFileIfTargetMissing(filepath.Join(svc.stateDir, file), filepath.Join(svc.legacyLibraryDir, file)); err != nil {
			return err
		}
	}
	return moveDirIfTargetMissing(filepath.Join(svc.stateDir, thumbnailCacheDir), filepath.Join(svc.legacyLibraryDir, thumbnailCacheDir))
}

// extractRepoStateFields 从元数据中摘出仓库工作状态字段（就地删除），返回仓库状态文档主体。
func extractRepoStateFields(meta map[string]any) map[string]any {
	repoState := map[string]any{}
	for _, key := range repoStateFieldKeys {
		value, ok := meta[key]
		if !ok {
			continue
		}
		repoState[key] = value
		delete(meta, key)
	}
	return repoState
}

// splitMetadataIdentity 把元数据中的仓库工作状态字段搬入 library/hypercortex-repo-state.json。
// 幂等设计：仓库状态目标已存在时不覆盖；元数据缺少仓库字段时不产生任何写入。
func (svc *service) splitMetadataIdentity() error {
	metaPath := filepath.Join(svc.stateDir, metadataFile)
	var meta map[string]any
	if err := readJSONFile(metaPath, &meta); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("读取元数据失败：%w", err)
	}

	repoState := extractRepoStateFields(meta)
	if len(repoState) == 0 {
		return nil
	}

	repoState["version"] = 1
	repoStatePath := filepath.Join(svc.legacyLibraryDir, repoStateFile)
	if !exists(repoStatePath) {
		if err := writeJSONFile(repoStatePath, repoState); err != nil {
			return fmt.Errorf("写入仓库状态失败：%w", err)
		}
	}
	meta["version"] = 1
	return writeJSONFile(metaPath, meta)
}
