package main

import (
	"os"
	"path/filepath"
)

func pluginEraLayoutMigration() dataMigration {
	return dataMigration{
		ID:          "2026-05-06-plugin-era-layout",
		FromVersion: 1,
		ToVersion:   2,
		Description: "收敛插件时代 AI 绘图数据布局为 App 后端可直接读取的分片结构",
		Recovery: migrationRecoverySpec{
			AffectedPaths: []string{
				metaFile,
				legacyPackFile,
				legacyShardDir + "/*.json",
				"settings.json",
				"taskHistory.json",
				"promptLibrary.json",
				"refLibraryIndex.json",
			},
			Notes: []string{
				"本迁移不移动 output-images 和 ref-images 图片目录，只整理 JSON 分片与参考图库索引路径。",
				"若根目录已有分片 JSON，则优先保留根目录分片；否则从旧 files/storage 或 ai-draw.json 单包补齐。",
			},
		},
		Apply: func(svc *service) error {
			return svc.migratePluginEraLayout()
		},
	}
}

func (svc *service) migratePluginEraLayout() error {
	legacyPack, err := svc.readLegacyPack()
	if err != nil {
		return err
	}
	for _, key := range []string{"settings", "taskHistory", "promptLibrary", "refLibraryIndex"} {
		if err := svc.ensureRootShardFromLegacy(key, legacyPack); err != nil {
			return err
		}
	}
	return svc.normalizeStoredRefLibraryIndex()
}

func (svc *service) ensureRootShardFromLegacy(key string, legacyPack map[string]any) error {
	targetPath := filepath.Join(svc.dataDir, shardFile(key))
	if fileExists(targetPath) {
		return nil
	}
	legacyShard, err := svc.store.read(filepath.Join(svc.dataDir, filepath.FromSlash(legacyShardDir), shardFile(key)))
	if err != nil {
		return err
	}
	if legacyShard != nil {
		return svc.store.write(targetPath, legacyShard)
	}
	if legacyPack == nil {
		return nil
	}
	value := legacyPack[key]
	if value == nil {
		return nil
	}
	return svc.store.write(targetPath, value)
}

func (svc *service) normalizeStoredRefLibraryIndex() error {
	indexPath := filepath.Join(svc.dataDir, shardFile("refLibraryIndex"))
	value, err := svc.store.read(indexPath)
	if err != nil || value == nil {
		return err
	}
	paths, err := svc.referenceImages.list()
	if err != nil {
		return nil
	}
	normalized := normalizeRefLibraryIndexPaths(value, paths)
	return svc.store.write(indexPath, normalized)
}

func (svc *service) readLegacyPack() (map[string]any, error) {
	value, err := svc.store.read(filepath.Join(svc.dataDir, legacyPackFile))
	if err != nil || value == nil {
		return nil, err
	}
	pack, _ := value.(map[string]any)
	return pack, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
