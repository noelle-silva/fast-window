package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

func noteMonthFolderFromID(id string) string {
	s := strings.TrimSpace(id)
	if len(s) >= 6 {
		y, m := s[:4], s[4:6]
		if allDigits(y) && allDigits(m) && m >= "01" && m <= "12" {
			return y + "-" + m
		}
	}
	return time.Now().Format("2006-01")
}

func notePackageDirForID(id string) (string, error) {
	noteID, err := normalizeNotePackageID(id)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join(notesDir, noteMonthFolderFromID(noteID), noteID)), nil
}

func notePackageDirForMonthAndID(rootName string, monthName string, id string) (string, error) {
	root := strings.TrimSpace(rootName)
	month := strings.TrimSpace(monthName)
	if root != notesDir && root != trashDir {
		return "", fmt.Errorf("非法笔记包根目录：%s", root)
	}
	if month == "" || strings.ContainsAny(month, "/\\\x00") || month == "." || month == ".." {
		return "", fmt.Errorf("非法笔记月份目录：%s", month)
	}
	noteID, err := normalizeNotePackageID(id)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join(root, month, noteID)), nil
}

func canonicalOriginalDirForTrashPackage(trashPackageDir string, originalDir string, noteID string) (string, error) {
	source := strings.TrimSpace(originalDir)
	if source == "" {
		parts, err := notePackagePathParts(trashPackageDir, trashDir, "恢复")
		if err != nil {
			return "", err
		}
		source = filepath.ToSlash(filepath.Join(notesDir, parts[1], parts[2]))
	}
	return canonicalNoteDirForID(source, noteID)
}

func canonicalNoteDirForID(dir string, noteID string) (string, error) {
	noteID, err := normalizeNotePackageID(noteID)
	if err != nil {
		return "", err
	}
	parts, err := notePackagePathParts(dir, notesDir, "规范化")
	if err != nil {
		return "", err
	}
	return notePackageDirForMonthAndID(notesDir, parts[1], noteID)
}

func trashPackageDirForNoteDir(noteDir string) (string, error) {
	parts, err := notePackagePathParts(noteDir, notesDir, "移入回收站")
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join(trashDir, parts[1], parts[2])), nil
}

func notePackagePathParts(path string, expectedRoot string, action string) ([]string, error) {
	clean, err := cleanRelPath(path)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(filepath.ToSlash(clean), "/")
	if len(parts) != 3 || parts[0] != expectedRoot {
		return nil, fmt.Errorf("笔记目录无法%s：%s", action, filepath.ToSlash(clean))
	}
	return parts, nil
}

func normalizeNotePackageID(id string) (string, error) {
	noteID := strings.TrimSpace(id)
	if noteID == "" {
		return "", errors.New("笔记 id 不能为空")
	}
	if noteID == "." || noteID == ".." || strings.ContainsAny(noteID, "/\\\x00") {
		return "", fmt.Errorf("笔记 id 不能作为文件夹名：%s", noteID)
	}
	return noteID, nil
}

func allDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}
