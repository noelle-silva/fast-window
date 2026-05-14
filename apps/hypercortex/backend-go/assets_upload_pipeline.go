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

type assetUploadFileInput struct {
	Path        string `json:"path"`
	DisplayName string `json:"displayName"`
}

type preparedAssetUploadFile struct {
	tempPath    string
	targetPath  string
	relPath     string
	fileIndex   int
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

type committedAssetUploadFile struct {
	fileIndex int
	resource  resourceRef
}

func (svc *service) dispatchAssetUploadTask(method string, params json.RawMessage) (any, bool, error) {
	switch method {
	case "hypercortex.assets.upload.start":
		result, err := svc.startAssetUploadTask(requireScope(params), rawField(params, "files"))
		return result, true, err
	case "hypercortex.assets.upload.list":
		return svc.listAssetUploadTasks(), true, nil
	case "hypercortex.assets.upload.pause":
		result, err := svc.pauseAssetUploadTask(stringField(params, "taskId"))
		return result, true, err
	case "hypercortex.assets.upload.resume":
		result, err := svc.resumeAssetUploadTask(stringField(params, "taskId"))
		return result, true, err
	case "hypercortex.assets.upload.cancel":
		result, err := svc.cancelAssetUploadTask(stringField(params, "taskId"))
		return result, true, err
	default:
		return nil, false, nil
	}
}

func (svc *service) startAssetUploadTask(scope string, raw json.RawMessage) (assetUploadTaskSnapshot, error) {
	var inputs []assetUploadFileInput
	if err := json.Unmarshal(raw, &inputs); err != nil {
		return assetUploadTaskSnapshot{}, err
	}
	if len(inputs) == 0 {
		return assetUploadTaskSnapshot{}, errors.New("没有选择任何附件")
	}
	task := svc.uploadTasks.create(scope, newAssetUploadTaskFiles(inputs))
	go svc.runAssetUploadTask(task, inputs)
	return task.snapshot(), nil
}

func (svc *service) runAssetUploadTask(task *assetUploadTask, inputs []assetUploadFileInput) {
	if err := task.markRunning(); err != nil {
		if errors.Is(err, errAssetUploadCanceled) {
			task.markCanceled()
			return
		}
		task.markFailed(err)
		return
	}
	result, err := svc.runAssetUploadPipeline(task.Scope, inputs, task)
	if err != nil {
		if errors.Is(err, errAssetUploadCanceled) {
			task.markCanceled()
			return
		}
		task.markFailed(err)
		return
	}
	task.markCompleted(result)
}

func (svc *service) listAssetUploadTasks() []assetUploadTaskSnapshot {
	return svc.uploadTasks.list()
}

func (svc *service) pauseAssetUploadTask(taskID string) (assetUploadTaskSnapshot, error) {
	task, ok := svc.uploadTasks.get(taskID)
	if !ok {
		return assetUploadTaskSnapshot{}, errors.New("上传任务不存在")
	}
	return task.pause(), nil
}

func (svc *service) resumeAssetUploadTask(taskID string) (assetUploadTaskSnapshot, error) {
	task, ok := svc.uploadTasks.get(taskID)
	if !ok {
		return assetUploadTaskSnapshot{}, errors.New("上传任务不存在")
	}
	return task.resume(), nil
}

func (svc *service) cancelAssetUploadTask(taskID string) (assetUploadTaskSnapshot, error) {
	task, ok := svc.uploadTasks.get(taskID)
	if !ok {
		return assetUploadTaskSnapshot{}, errors.New("上传任务不存在")
	}
	return task.cancel(), nil
}

func (svc *service) runAssetUploadPipeline(scope string, inputs []assetUploadFileInput, task *assetUploadTask) ([]resourceRef, error) {
	if len(inputs) == 0 {
		return []resourceRef{}, nil
	}

	stagingDir, err := svc.assetUploadStagingDir(scope)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return nil, err
	}

	prepared := []preparedAssetUploadFile{}
	for index, input := range inputs {
		item, err := svc.prepareAssetUploadFile(scope, stagingDir, input, task, index)
		if err != nil {
			if task != nil && !errors.Is(err, errAssetUploadCanceled) {
				task.failFile(index, err)
			}
			cleanupPreparedUploadFiles(prepared)
			return nil, err
		}
		prepared = append(prepared, item)
	}
	if task != nil {
		if err := task.waitIfPausedOrCanceled(); err != nil {
			cleanupPreparedUploadFiles(prepared)
			return nil, err
		}
		if err := task.beginCommit(); err != nil {
			cleanupPreparedUploadFiles(prepared)
			return nil, err
		}
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()

	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		cleanupPreparedUploadFiles(prepared)
		return nil, err
	}
	createdTargets := []string{}
	committedTargets := map[string]bool{}
	committed := false
	defer func() {
		cleanupPreparedUploadFiles(prepared)
		if !committed {
			for _, target := range createdTargets {
				_ = os.Remove(target)
			}
		}
	}()

	out := make([]resourceRef, 0, len(prepared))
	committedFiles := make([]committedAssetUploadFile, 0, len(prepared))
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
		ref := resourceRef{AssetID: item.assetID, Mime: item.mimeType, Ext: item.ext, Kind: item.kind, Name: item.displayName}
		out = append(out, ref)
		committedFiles = append(committedFiles, committedAssetUploadFile{fileIndex: item.fileIndex, resource: ref})
	}

	if err := svc.saveAssetIndex(scope, idx); err != nil {
		return nil, err
	}
	committed = true
	if task != nil {
		for _, item := range committedFiles {
			task.completeFile(item.fileIndex, item.resource)
		}
	}
	return out, nil
}

func (svc *service) prepareAssetUploadFile(scope string, stagingDir string, input assetUploadFileInput, task *assetUploadTask, fileIndex int) (preparedAssetUploadFile, error) {
	sourcePath, err := normalizeAssetUploadSourcePath(input.Path)
	if err != nil {
		return preparedAssetUploadFile{}, err
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return preparedAssetUploadFile{}, fmt.Errorf("读取源文件失败：%w", err)
	}
	if info.IsDir() {
		return preparedAssetUploadFile{}, errors.New("不能导入文件夹")
	}

	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(sourcePath)), ".")
	if !allowedAssetExts[ext] {
		return preparedAssetUploadFile{}, fmt.Errorf("不支持的附件类型：.%s", ext)
	}
	mimeType := mimeFromExt(ext)
	kind := kindFromMime(mimeType)
	if task != nil {
		if err := task.startFile(fileIndex); err != nil {
			return preparedAssetUploadFile{}, err
		}
	}

	tempFile, err := os.CreateTemp(stagingDir, "asset-upload-*")
	if err != nil {
		return preparedAssetUploadFile{}, err
	}
	tempPath := tempFile.Name()
	assetID, size, copyErr := copyFileAndHash(sourcePath, tempFile, task, fileIndex)
	closeErr := tempFile.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return preparedAssetUploadFile{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return preparedAssetUploadFile{}, closeErr
	}

	fileName := assetKey(assetID, ext)
	relPath, err := svc.assetUploadTargetRelPath(scope, assetID, ext, kind)
	if err != nil {
		_ = os.Remove(tempPath)
		return preparedAssetUploadFile{}, err
	}
	targetPath, err := svc.resolvePath(scope, relPath)
	if err != nil {
		_ = os.Remove(tempPath)
		return preparedAssetUploadFile{}, err
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

	return preparedAssetUploadFile{
		tempPath:    tempPath,
		targetPath:  targetPath,
		relPath:     relPath,
		fileIndex:   fileIndex,
		fileName:    fileName,
		assetID:     assetID,
		mimeType:    mimeType,
		ext:         ext,
		kind:        kind,
		displayName: assetUploadDisplayName(input.DisplayName, sourcePath),
		size:        size,
		modifiedMs:  modifiedMs,
		existed:     existed,
	}, nil
}

func assetUploadDisplayName(input string, sourcePath string) string {
	name := strings.TrimSpace(input)
	if name != "" {
		return name
	}
	return strings.TrimSpace(filepath.Base(sourcePath))
}

func (svc *service) assetUploadTargetRelPath(scope string, assetID string, ext string, kind string) (string, error) {
	if relPath, err := svc.resolveAssetPath(scope, assetID, ext); err == nil {
		return relPath, nil
	}
	month := time.Now().Format("2006-01")
	return filepath.ToSlash(filepath.Join(assetsDir, categoryFromKind(kind), month, assetKey(assetID, ext))), nil
}

func (svc *service) assetUploadStagingDir(scope string) (string, error) {
	return svc.resolvePath(scope, filepath.Join(assetsDir, ".uploading"))
}

func normalizeAssetUploadSourcePath(input string) (string, error) {
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

func copyFileAndHash(sourcePath string, target *os.File, task *assetUploadTask, fileIndex int) (string, int64, error) {
	source, err := os.Open(sourcePath)
	if err != nil {
		return "", 0, err
	}
	defer source.Close()

	hasher := sha256.New()
	writer := io.MultiWriter(target, hasher)
	buffer := make([]byte, 1024*1024)
	var written int64
	for {
		if task != nil {
			if err := task.waitIfPausedOrCanceled(); err != nil {
				return "", written, err
			}
		}
		n, readErr := source.Read(buffer)
		if n > 0 {
			if _, err := writer.Write(buffer[:n]); err != nil {
				return "", written, err
			}
			written += int64(n)
			if task != nil {
				if err := task.addProgress(fileIndex, int64(n)); err != nil {
					return "", written, err
				}
			}
		}
		if readErr == nil {
			continue
		}
		if readErr == io.EOF {
			break
		}
		return "", written, readErr
	}
	return hex.EncodeToString(hasher.Sum(nil)), written, nil
}

func cleanupPreparedUploadFiles(prepared []preparedAssetUploadFile) {
	for _, item := range prepared {
		if strings.TrimSpace(item.tempPath) != "" {
			_ = os.Remove(item.tempPath)
		}
	}
}
