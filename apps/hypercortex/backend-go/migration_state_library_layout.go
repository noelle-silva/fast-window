package main

import (
	"path/filepath"
)

const stateLibraryLayoutMigration = "2026-05-06-state-library-layout"

func (svc *service) migrateDataLayout() error {
	for _, file := range []string{metadataFile, favoritesFile} {
		if err := svc.moveRootFileToState(file); err != nil {
			return err
		}
	}
	for _, dir := range []string{notesDir, assetsDir, trashDir} {
		if err := svc.moveRootDirToLibrary(dir); err != nil {
			return err
		}
	}
	for _, file := range []string{indexFile, refsIndexFile, assetsIndexFile} {
		if err := svc.moveRootFileToLibrary(file); err != nil {
			return err
		}
	}
	return nil
}

func (svc *service) moveRootFileToState(name string) error {
	return moveFileIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.stateDir, name))
}

func (svc *service) moveRootFileToLibrary(name string) error {
	return moveFileIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.legacyLibraryDir, name))
}

func (svc *service) moveRootDirToLibrary(name string) error {
	return moveDirIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.legacyLibraryDir, name))
}
