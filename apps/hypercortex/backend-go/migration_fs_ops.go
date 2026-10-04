package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
)

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
