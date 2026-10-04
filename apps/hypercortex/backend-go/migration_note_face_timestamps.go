package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const noteFaceTimestampsMigration = "2026-09-14-note-face-timestamps"

// migrateNoteFaceTimestamps 为旧数据的面补齐面级创建/更新时间：
// 已有面继承所属笔记的创建/更新时间，缺失时间的面也一并规范化。
func (svc *service) migrateNoteFaceTimestamps() error {
	for _, rootName := range []string{notesDir, trashDir} {
		root, err := svc.resolvePath("library", rootName)
		if err != nil {
			return err
		}
		months, err := os.ReadDir(root)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for _, month := range months {
			if !month.IsDir() || month.Name() == "assets" || month.Name() == trashFacesDirName {
				continue
			}
			monthDir := filepath.Join(root, month.Name())
			packages, err := os.ReadDir(monthDir)
			if err != nil {
				return err
			}
			for _, pkg := range packages {
				if !pkg.IsDir() {
					continue
				}
				manifestPath := filepath.Join(monthDir, pkg.Name(), manifestFile)
				var manifest noteManifest
				if err := readJSONFile(manifestPath, &manifest); err != nil {
					continue
				}
				if strings.TrimSpace(manifest.ID) == "" {
					continue
				}
				if err := writeJSONFile(manifestPath, normalizeManifest(manifest)); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
