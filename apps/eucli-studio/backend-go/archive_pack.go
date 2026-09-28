package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// packDirectoryArchive 把目录打包成系统临时区里的 zip，返回包路径与清理函数。
// 只收录普通文件：跳过 .git 目录与符号链接；zip 内路径一律相对目录根、以 / 分隔且不写目录条目，
// 与业务端解压核验的成品格式保持一致。
func packDirectoryArchive(directory string) (string, func(), error) {
	absolute, err := filepath.Abs(strings.TrimSpace(directory))
	if err != nil || strings.TrimSpace(directory) == "" {
		return "", nil, fmt.Errorf("目录路径无效")
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", nil, fmt.Errorf("读取目录失败：%w", err)
	}
	if !info.IsDir() {
		return "", nil, fmt.Errorf("路径不是目录")
	}
	file, err := os.CreateTemp("", "eucli-studio-import-*.zip")
	if err != nil {
		return "", nil, fmt.Errorf("建立临时压缩包失败：%w", err)
	}
	archive := zip.NewWriter(file)
	walkErr := filepath.WalkDir(absolute, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		relative, err := filepath.Rel(absolute, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		if name == "" || strings.HasPrefix(name, "..") {
			return nil
		}
		writer, err := archive.Create(name)
		if err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(writer, input)
		closeErr := input.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if walkErr != nil {
		_ = archive.Close()
		_ = file.Close()
		_ = os.Remove(file.Name())
		return "", nil, fmt.Errorf("打包目录失败：%w", walkErr)
	}
	if err := archive.Close(); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return "", nil, fmt.Errorf("关闭临时压缩包失败：%w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(file.Name())
		return "", nil, fmt.Errorf("写入临时压缩包失败：%w", err)
	}
	return file.Name(), func() { _ = os.Remove(file.Name()) }, nil
}
