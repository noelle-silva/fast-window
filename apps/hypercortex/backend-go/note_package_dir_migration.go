package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (svc *service) migrateNotePackageDirsToIDs() error {
	noteDirsByID, err := svc.renamePackageDirsUnder(notesDir)
	if err != nil {
		return err
	}
	if _, err := svc.renamePackageDirsUnder(trashDir); err != nil {
		return err
	}
	if err := svc.rewriteNoteIndexDirs(noteDirsByID); err != nil {
		return err
	}
	return svc.rewriteTrashOriginalDirs()
}

func (svc *service) renamePackageDirsUnder(rootName string) (map[string]string, error) {
	root := filepath.Join(svc.libraryDir, rootName)
	dirsByID := map[string]string{}
	months, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return dirsByID, nil
	}
	if err != nil {
		return dirsByID, err
	}

	for _, month := range months {
		if !month.IsDir() {
			continue
		}
		monthDir := filepath.Join(root, month.Name())
		packages, err := os.ReadDir(monthDir)
		if err != nil {
			return dirsByID, err
		}
		for _, pkg := range packages {
			if !pkg.IsDir() {
				continue
			}
			fromRel := filepath.ToSlash(filepath.Join(rootName, month.Name(), pkg.Name()))
			manifest, err := readManifestAt(filepath.Join(monthDir, pkg.Name(), manifestFile))
			if err != nil || manifest.ID == "" {
				continue
			}
			noteID := strings.TrimSpace(manifest.ID)
			desiredRel, err := notePackageDirForMonthAndID(rootName, month.Name(), noteID)
			if err != nil {
				return dirsByID, err
			}
			dirsByID[noteID] = desiredRel
			if fromRel == desiredRel {
				continue
			}

			from := filepath.Join(monthDir, pkg.Name())
			to := filepath.Join(monthDir, noteID)
			if exists(to) {
				return dirsByID, fmt.Errorf("目标笔记目录已存在，无法迁移：%s", desiredRel)
			}
			if err := os.Rename(from, to); err != nil {
				return dirsByID, err
			}
		}
	}
	return dirsByID, nil
}

func (svc *service) rewriteNoteIndexDirs(dirsByID map[string]string) error {
	if len(dirsByID) == 0 {
		return nil
	}
	path := filepath.Join(svc.libraryDir, indexFile)
	var idx noteIndex
	if err := readJSONFile(path, &idx); err != nil {
		return nil
	}
	changed := false
	for key, meta := range idx.Notes {
		noteID := strings.TrimSpace(meta.ID)
		if noteID == "" {
			noteID = strings.TrimSpace(key)
		}
		dir := dirsByID[noteID]
		if dir == "" || filepath.ToSlash(strings.TrimSpace(meta.Dir)) == dir {
			continue
		}
		meta.Dir = dir
		idx.Notes[key] = meta
		changed = true
	}
	if !changed {
		return nil
	}
	return writeJSONFile(path, idx)
}

func (svc *service) rewriteTrashOriginalDirs() error {
	root := filepath.Join(svc.libraryDir, trashDir)
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
			packageDir := filepath.Join(monthDir, pkg.Name())
			manifest, err := readManifestAt(filepath.Join(packageDir, manifestFile))
			if err != nil || manifest.ID == "" {
				continue
			}
			metaPath := filepath.Join(packageDir, trashMetaFile)
			var meta trashMeta
			if err := readJSONFile(metaPath, &meta); err != nil {
				continue
			}
			trashRel := filepath.ToSlash(filepath.Join(trashDir, month.Name(), pkg.Name()))
			nextOriginal, err := canonicalOriginalDirForTrashPackage(trashRel, meta.OriginalDir, manifest.ID)
			if err != nil {
				return err
			}
			if filepath.ToSlash(strings.TrimSpace(meta.OriginalDir)) == nextOriginal {
				continue
			}
			meta.OriginalDir = nextOriginal
			if err := writeJSONFile(metaPath, meta); err != nil {
				return err
			}
		}
	}
	return nil
}

func readManifestAt(path string) (noteManifest, error) {
	var manifest noteManifest
	if err := readJSONFile(path, &manifest); err != nil {
		return noteManifest{}, err
	}
	manifest = normalizeManifest(manifest)
	if strings.TrimSpace(manifest.ID) == "" {
		return noteManifest{}, errors.New("笔记 manifest 缺少 id")
	}
	return manifest, nil
}
