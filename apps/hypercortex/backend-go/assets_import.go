package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var allowedAssetExts = map[string]bool{
	"jpg": true, "png": true, "webp": true, "gif": true, "svg": true,
	"mp3": true, "wav": true, "ogg": true, "flac": true, "aac": true, "m4a": true,
	"mp4": true, "m4v": true, "webm": true, "mov": true, "ogv": true,
	"pdf": true, "txt": true, "csv": true, "zip": true, "docx": true, "xlsx": true, "pptx": true,
}

type localAssetImportInput struct {
	Path        string `json:"path"`
	DisplayName string `json:"displayName"`
}

type preparedAssetImport struct {
	tempPath    string
	targetPath  string
	relPath     string
	fileName    string
	assetID     string
	mimeType    string
	ext         string
	kind        string
	displayName string
	size        int64
	modifiedMs  float64
	existed     bool
}

func (svc *service) importLocalFiles(scope string, raw json.RawMessage) ([]resourceRef, error) {
	var inputs []localAssetImportInput
	if err := json.Unmarshal(raw, &inputs); err != nil {
		return nil, err
	}
	if len(inputs) == 0 {
		return []resourceRef{}, nil
	}

	stagingDir, err := svc.assetImportStagingDir(scope)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, err
	}

	prepared := []preparedAssetImport{}
	for _, input := range inputs {
		item, err := svc.prepareLocalAssetImport(scope, stagingDir, input)
		if err != nil {
			cleanupPreparedImports(prepared)
			return nil, err
		}
		prepared = append(prepared, item)
	}

	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		cleanupPreparedImports(prepared)
		return nil, err
	}
	createdTargets := []string{}
	committedTargets := map[string]bool{}
	committed := false
	defer func() {
		cleanupPreparedImports(prepared)
		if !committed {
			for _, target := range createdTargets {
				_ = os.Remove(target)
			}
		}
	}()

	out := make([]resourceRef, 0, len(prepared))
	for _, item := range prepared {
		if !item.existed {
			if committedTargets[item.targetPath] || exists(item.targetPath) {
				_ = os.Remove(item.tempPath)
			} else {
				if err := ensureParent(item.targetPath); err != nil {
					return nil, err
				}
				if err := os.Rename(item.tempPath, item.targetPath); err != nil {
					return nil, err
				}
				createdTargets = append(createdTargets, item.targetPath)
				committedTargets[item.targetPath] = true
			}
		}

		idx.Assets[item.fileName] = assetIndexEntry{
			Path:        item.relPath,
			Kind:        item.kind,
			Size:        item.size,
			ModifiedMs:  item.modifiedMs,
			DisplayName: item.displayName,
		}
		out = append(out, resourceRef{AssetID: item.assetID, Mime: item.mimeType, Ext: item.ext, Kind: item.kind, Name: item.displayName})
	}

	if err := svc.saveAssetIndex(scope, idx); err != nil {
		return nil, err
	}
	committed = true
	return out, nil
}

func (svc *service) prepareLocalAssetImport(scope string, stagingDir string, input localAssetImportInput) (preparedAssetImport, error) {
	sourcePath, err := normalizeLocalAssetSourcePath(input.Path)
	if err != nil {
		return preparedAssetImport{}, err
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return preparedAssetImport{}, fmt.Errorf("读取源文件失败：%w", err)
	}
	if info.IsDir() {
		return preparedAssetImport{}, errors.New("不能导入文件夹")
	}

	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(sourcePath)), ".")
	if !allowedAssetExts[ext] {
		return preparedAssetImport{}, fmt.Errorf("不支持的附件类型：.%s", ext)
	}
	mimeType := mimeFromExt(ext)
	kind := kindFromMime(mimeType)

	tempFile, err := os.CreateTemp(stagingDir, "asset-import-*")
	if err != nil {
		return preparedAssetImport{}, err
	}
	tempPath := tempFile.Name()
	assetID, size, copyErr := copyFileAndHash(sourcePath, tempFile)
	closeErr := tempFile.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return preparedAssetImport{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return preparedAssetImport{}, closeErr
	}

	fileName := assetKey(assetID, ext)
	relPath, err := svc.assetImportTargetRelPath(scope, assetID, ext, kind)
	if err != nil {
		_ = os.Remove(tempPath)
		return preparedAssetImport{}, err
	}
	targetPath, err := svc.resolvePath(scope, relPath)
	if err != nil {
		_ = os.Remove(tempPath)
		return preparedAssetImport{}, err
	}
	existed := exists(targetPath)
	if existed {
		_ = os.Remove(tempPath)
		tempPath = ""
	}

	modifiedMs := float64(info.ModTime().UnixMilli())
	if existed {
		if targetInfo, err := os.Stat(targetPath); err == nil {
			modifiedMs = float64(targetInfo.ModTime().UnixMilli())
			size = targetInfo.Size()
		}
	}

	return preparedAssetImport{
		tempPath:    tempPath,
		targetPath:  targetPath,
		relPath:     relPath,
		fileName:    fileName,
		assetID:     assetID,
		mimeType:    mimeType,
		ext:         ext,
		kind:        kind,
		displayName: localAssetDisplayName(input.DisplayName, sourcePath),
		size:        size,
		modifiedMs:  modifiedMs,
		existed:     existed,
	}, nil
}

func localAssetDisplayName(input string, sourcePath string) string {
	name := strings.TrimSpace(input)
	if name != "" {
		return name
	}
	return strings.TrimSpace(filepath.Base(sourcePath))
}

func (svc *service) assetImportTargetRelPath(scope string, assetID string, ext string, kind string) (string, error) {
	if relPath, err := svc.resolveAssetPath(scope, assetID, ext); err == nil {
		return relPath, nil
	}
	month := time.Now().Format("2006-01")
	return filepath.ToSlash(filepath.Join(assetsDir, categoryFromKind(kind), month, assetKey(assetID, ext))), nil
}

func (svc *service) assetImportStagingDir(scope string) (string, error) {
	return svc.resolvePath(scope, filepath.Join(assetsDir, ".importing"))
}

func normalizeLocalAssetSourcePath(input string) (string, error) {
	path := strings.TrimSpace(input)
	if path == "" {
		return "", errors.New("源文件路径为空")
	}
	if strings.ContainsRune(path, 0) {
		return "", errors.New("源文件路径包含非法空字节")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func copyFileAndHash(sourcePath string, target *os.File) (string, int64, error) {
	source, err := os.Open(sourcePath)
	if err != nil {
		return "", 0, err
	}
	defer source.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(target, hasher), source)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hasher.Sum(nil)), written, nil
}

func cleanupPreparedImports(prepared []preparedAssetImport) {
	for _, item := range prepared {
		if strings.TrimSpace(item.tempPath) != "" {
			_ = os.Remove(item.tempPath)
		}
	}
}
