package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type migrationReport struct {
	Imported  bool     `json:"imported"`
	RepoID    string   `json:"repoId,omitempty"`
	RepoTitle string   `json:"repoTitle,omitempty"`
	Files     []string `json:"files"`
	Skipped   []string `json:"skipped"`
}

// importLegacyData 把旧版数据目录导入为一个新仓库：
// 笔记/附件/回收站/索引/收藏夹与仓库工作状态进入新仓库；应用设置只在当前缺失时补种；
// 导入过程不触碰任何现有仓库。
func (svc *service) importLegacyData(sourceDir string) (migrationReport, error) {
	source, err := filepath.Abs(strings.TrimSpace(sourceDir))
	if err != nil {
		return migrationReport{}, fmt.Errorf("解析导入目录失败: %w", err)
	}
	if source == "" || !exists(source) {
		return migrationReport{}, errors.New("导入目录不存在")
	}
	if isInside(svc.dataDir, source) {
		return migrationReport{}, errors.New("导入目录不能位于当前 HyperCortex 数据目录内部")
	}
	if err := svc.ensureRoots(); err != nil {
		return migrationReport{}, err
	}

	report := migrationReport{Imported: true, Files: []string{}, Skipped: []string{}}

	var legacyMeta map[string]any
	metaPath := filepath.Join(source, metadataFile)
	if err := readJSONFile(metaPath, &legacyMeta); err != nil && !errors.Is(err, os.ErrNotExist) {
		return report, fmt.Errorf("读取旧版元数据失败：%w", err)
	}
	var legacyRepoState map[string]any
	if legacyMeta != nil {
		legacyRepoState = extractRepoStateFields(legacyMeta)
	}

	id, err := newRepoID()
	if err != nil {
		return report, err
	}
	identity := repoIdentity{Version: 1, ID: id, Title: "导入仓库", CreatedAtMs: nowMs()}
	err = svc.buildRepo(identity, func(root string) error {
		for _, dir := range []string{notesDir, assetsDir, trashDir} {
			copied, err := copyDirMissingEntries(filepath.Join(source, dir), filepath.Join(root, dir))
			if err != nil {
				return err
			}
			report.record(dir+"/", copied)
		}
		for _, file := range []string{indexFile, refsIndexFile, assetsIndexFile, favoritesFile} {
			copied, err := copyFileIfTargetMissing(filepath.Join(source, file), filepath.Join(root, file))
			if err != nil {
				return err
			}
			report.record(file, copied)
		}
		if len(legacyRepoState) > 0 {
			legacyRepoState["version"] = 1
			if err := writeJSONFile(filepath.Join(root, repoStateFile), legacyRepoState); err != nil {
				return err
			}
			report.record(repoStateFile, true)
		}
		return svc.migrateNotePackageDirsToIDsAt(root)
	})
	if err != nil {
		return report, err
	}
	report.RepoID = identity.ID
	report.RepoTitle = identity.Title

	// 应用设置：只在当前缺失时补种（此时仓库字段已摘除，保持应用设置身份纯净）。
	if legacyMeta != nil {
		stateMetaPath := filepath.Join(svc.stateDir, metadataFile)
		if !exists(stateMetaPath) {
			legacyMeta["version"] = 1
			if err := writeJSONFile(stateMetaPath, legacyMeta); err != nil {
				return report, err
			}
			report.record(metadataFile, true)
		} else {
			report.record(metadataFile, false)
		}
	}
	return report, nil
}

func (report *migrationReport) record(path string, copied bool) {
	if copied {
		report.Files = append(report.Files, path)
	} else {
		report.Skipped = append(report.Skipped, path)
	}
}
