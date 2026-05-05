package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type migrationReport struct {
	Imported bool     `json:"imported"`
	Files    []string `json:"files"`
	Skipped  []string `json:"skipped"`
}

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

	report := migrationReport{Imported: true}
	for _, file := range []string{metadataFile, favoritesFile} {
		copied, err := copyFileIfTargetMissing(filepath.Join(source, file), filepath.Join(svc.stateDir, file))
		if err != nil {
			return report, err
		}
		report.record(file, copied)
	}
	for _, dir := range []string{notesDir, assetsDir, trashDir} {
		copied, err := copyDirMissingEntries(filepath.Join(source, dir), filepath.Join(svc.libraryDir, dir))
		if err != nil {
			return report, err
		}
		report.record(dir+"/", copied)
	}
	for _, file := range []string{indexFile, refsIndexFile, assetsIndexFile} {
		copied, err := copyFileIfTargetMissing(filepath.Join(source, file), filepath.Join(svc.libraryDir, file))
		if err != nil {
			return report, err
		}
		report.record(file, copied)
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

func (svc *service) moveRootFileToState(name string) error {
	return moveFileIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.stateDir, name))
}

func (svc *service) moveRootFileToLibrary(name string) error {
	return moveFileIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.libraryDir, name))
}

func (svc *service) moveRootDirToLibrary(name string) error {
	return moveDirIfTargetMissing(filepath.Join(svc.dataDir, name), filepath.Join(svc.libraryDir, name))
}

func moveFileIfTargetMissing(from string, to string) error {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		return nil
	}
	if exists(to) {
		return nil
	}
	if err := ensureParent(to); err != nil {
		return err
	}
	return os.Rename(from, to)
}

func moveDirIfTargetMissing(from string, to string) error {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || exists(to) {
		return nil
	}
	if err := ensureParent(to); err != nil {
		return err
	}
	return os.Rename(from, to)
}

func copyFileIfTargetMissing(from string, to string) (bool, error) {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if info.IsDir() || exists(to) {
		return false, nil
	}
	if err := ensureParent(to); err != nil {
		return false, err
	}
	src, err := os.Open(from)
	if err != nil {
		return false, err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return false, err
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if copyErr != nil {
		_ = os.Remove(to)
		return false, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(to)
		return false, closeErr
	}
	return true, nil
}

func copyDirIfTargetMissing(from string, to string) (bool, error) {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.IsDir() || exists(to) {
		return false, nil
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return false, err
	}
	if err := copyDirContents(from, to); err != nil {
		_ = os.RemoveAll(to)
		return false, err
	}
	return true, nil
}

func copyDirMissingEntries(from string, to string) (bool, error) {
	info, err := os.Stat(from)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, nil
	}
	if err := os.MkdirAll(to, 0o755); err != nil {
		return false, err
	}
	return copyDirContentsMissingEntries(from, to)
}

func copyDirContents(from string, to string) error {
	entries, err := os.ReadDir(from)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		src := filepath.Join(from, entry.Name())
		dst := filepath.Join(to, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return err
			}
			if err := copyDirContents(src, dst); err != nil {
				return err
			}
			continue
		}
		if _, err := copyFileIfTargetMissing(src, dst); err != nil {
			return err
		}
	}
	return nil
}

func copyDirContentsMissingEntries(from string, to string) (bool, error) {
	entries, err := os.ReadDir(from)
	if err != nil {
		return false, err
	}
	copiedAny := false
	for _, entry := range entries {
		src := filepath.Join(from, entry.Name())
		dst := filepath.Join(to, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return copiedAny, err
			}
			copied, err := copyDirContentsMissingEntries(src, dst)
			if err != nil {
				return copiedAny, err
			}
			copiedAny = copiedAny || copied
			continue
		}
		copied, err := copyFileIfTargetMissing(src, dst)
		if err != nil {
			return copiedAny, err
		}
		copiedAny = copiedAny || copied
	}
	return copiedAny, nil
}
