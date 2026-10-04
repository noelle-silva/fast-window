package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const noteFaceSystemUnificationMigration = "2026-09-01-note-face-system-unification"

func (svc *service) migrateNoteFaceSystemUnification() error {
	if err := svc.migrateNoteManifestsToUnifiedFaceProtocol(); err != nil {
		return err
	}
	if err := svc.rebuildRefsIndex("library"); err != nil {
		return err
	}
	return svc.refreshNoteVersionSnapshots()
}

// migrateNoteManifestsToUnifiedFaceProtocol 把旧清单收敛为统一面协议形态（去掉角色字段并补齐能力快照）。
func (svc *service) migrateNoteManifestsToUnifiedFaceProtocol() error {
	root, err := svc.resolvePath("library", notesDir)
	if err != nil {
		return err
	}
	months, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, month := range months {
		if !month.IsDir() {
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
	return nil
}
