package migrations

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const refImagesToDataTreeID = "2026-05-05-ref-images-to-data-tree"

func RefImagesToDataTree() Migration {
	return Migration{
		ID:          refImagesToDataTreeID,
		FromVersion: 4,
		ToVersion:   5,
		Description: "将 ref-images 下的图片归档到对应业务数据目录，并移除空的 ref-images",
		Apply:       applyRefImagesToDataTree,
	}
}

func applyRefImagesToDataTree(ctx Context) error {
	return moveRefImagesToDataTree(ctx.DataDir)
}

func moveRefImagesToDataTree(dataDir string) error {
	refDir := filepath.Join(dataDir, "ref-images")
	info, err := os.Stat(refDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("ref-images 不是目录：%s", refDir)
	}

	files, err := collectRefImageFiles(refDir)
	if err != nil {
		return err
	}
	for _, srcPath := range files {
		if err := moveRefImageFileToDataTree(dataDir, refDir, srcPath); err != nil {
			return err
		}
	}
	return removeEmptyDirsBottomUp(refDir)
}

func collectRefImageFiles(refDir string) ([]string, error) {
	var files []string
	if err := filepath.Walk(refDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		files = append(files, path)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

func moveRefImageFileToDataTree(dataDir string, refDir string, srcPath string) error {
	rel, err := filepath.Rel(refDir, srcPath)
	if err != nil {
		return err
	}
	rel = filepath.ToSlash(rel)
	dstPath, safeRel, err := imagePathForRel(dataDir, rel)
	if err != nil {
		return fmt.Errorf("图片路径无效：%s：%w", rel, err)
	}
	if pathIsInsideOrSame(refDir, dstPath) {
		return fmt.Errorf("迁移目标仍位于 ref-images 内：%s", safeRel)
	}

	if _, err := os.Stat(dstPath); err == nil {
		same, err := sameFilePayload(srcPath, dstPath)
		if err != nil {
			return err
		}
		if !same {
			return fmt.Errorf("目标图片已存在且内容不同：%s", safeRel)
		}
		return removeFileIfExists(srcPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return err
	}
	if err := os.Rename(srcPath, dstPath); err == nil {
		return nil
	}
	if err := copyFile(srcPath, dstPath, 0o644); err != nil {
		return err
	}
	return removeFileIfExists(srcPath)
}

func sameFilePayload(left string, right string) (bool, error) {
	leftPayload, err := os.ReadFile(left)
	if err != nil {
		return false, err
	}
	rightPayload, err := os.ReadFile(right)
	if err != nil {
		return false, err
	}
	return bytes.Equal(leftPayload, rightPayload), nil
}

func removeFileIfExists(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func removeEmptyDirsBottomUp(root string) error {
	var dirs []string
	if err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			dirs = append(dirs, path)
		}
		return nil
	}); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	sort.Slice(dirs, func(i int, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	for _, dir := range dirs {
		if err := os.Remove(dir); err != nil && !errors.Is(err, os.ErrNotExist) {
			if strings.Contains(strings.ToLower(err.Error()), "directory not empty") || strings.Contains(strings.ToLower(err.Error()), "not empty") {
				continue
			}
			return err
		}
	}
	return nil
}

func pathIsInsideOrSame(baseDir string, path string) bool {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return false
	}
	pathAbs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	baseClean := filepath.Clean(baseAbs)
	pathClean := filepath.Clean(pathAbs)
	return pathClean == baseClean || strings.HasPrefix(pathClean, baseClean+string(os.PathSeparator))
}
