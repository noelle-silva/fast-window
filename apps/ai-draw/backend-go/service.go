package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	pluginOutputImagesDir    = "output-images"
	pluginReferenceImagesDir = "ref-images"
	legacyShardDir           = "files/storage"
	legacyPackFile           = "ai-draw.json"

	appOutputImagesDir    = "outputs"
	appReferenceImagesDir = "reference-images"
)

type service struct {
	dataDir         string
	store           *jsonStore
	outputImages    *imageStore
	referenceImages *imageStore
	generation      *generationService
}

func newService(dataDir string, sink eventSink) (*service, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	if sink == nil {
		sink = noopEventSink{}
	}
	outputImages := newImageStore(resolvePluginCompatibleDir(dataDir, pluginOutputImagesDir, appOutputImagesDir))
	svc := &service{
		dataDir:         dataDir,
		store:           newJSONStore(),
		outputImages:    outputImages,
		referenceImages: newImageStore(resolvePluginCompatibleDir(dataDir, pluginReferenceImagesDir, appReferenceImagesDir)),
		generation:      newGenerationService(outputImages, newOpenAIImageProvider(nil), sink),
	}
	if err := svc.runMigrations(); err != nil {
		return nil, err
	}
	if err := svc.ensureMeta(); err != nil {
		return nil, err
	}
	return svc, nil
}

func (svc *service) dispatch(method string, params json.RawMessage) (any, error) {
	switch method {
	case methodProtocolHello:
		payload, err := decodeMap(params)
		if err != nil {
			return nil, err
		}
		if intNumber(payload["clientProtocolVersion"]) != protocolVersion {
			return nil, newDirectError(errorProtocolVersionUnsupported, "direct 协议版本不兼容")
		}
		return map[string]any{"serverProtocolVersion": protocolVersion, "appId": "ai-draw"}, nil
	case "settings.read":
		return svc.readShard("settings")
	case "settings.write":
		return nil, svc.writeShardFromParam(params, "settings", "settings")
	case "taskHistory.read":
		return svc.readShard("taskHistory")
	case "taskHistory.write":
		return nil, svc.writeShardFromParam(params, "taskHistory", "items")
	case "promptLibrary.read":
		return svc.readShard("promptLibrary")
	case "promptLibrary.write":
		return nil, svc.writeShardFromParam(params, "promptLibrary", "library")
	case "referenceLibrary.read":
		return svc.readShard("refLibraryIndex")
	case "referenceLibrary.write":
		return nil, svc.writeShardFromParam(params, "refLibraryIndex", "index")
	case "outputImages.getOutputDir":
		return map[string]any{"outputDir": svc.outputImages.currentRootDir()}, nil
	case "outputImages.setOutputDir":
		return svc.setOutputDir(params)
	case "outputImages.list":
		paths, err := svc.outputImages.list()
		return map[string]any{"paths": paths}, err
	case "outputImages.read":
		return svc.imageRead(params, svc.outputImages)
	case "outputImages.saveBase64":
		return svc.imageSave(params, svc.outputImages)
	case "outputImages.delete":
		return nil, svc.imageDelete(params, svc.outputImages)
	case "referenceImages.list":
		paths, err := svc.referenceImages.list()
		return map[string]any{"paths": paths}, err
	case "referenceImages.read":
		return svc.imageRead(params, svc.referenceImages)
	case "referenceImages.saveBase64":
		return svc.imageSave(params, svc.referenceImages)
	case "referenceImages.delete":
		return nil, svc.imageDelete(params, svc.referenceImages)
	case "generation.get":
		return svc.generation.get(params)
	case "generation.list":
		return svc.generation.list(params)
	case "generation.cancel":
		return svc.generation.cancel(params)
	case "generation.createNormal":
		return svc.generation.createNormal(params)
	case "generation.createLocalEdit":
		return svc.generation.createLocalEdit(params)
	default:
		return nil, newDirectError(errorMethodNotFound, fmt.Sprintf("未知方法：%s", method))
	}
}

func (svc *service) dispose() {
	if svc.generation != nil {
		svc.generation.dispose()
	}
}

func (svc *service) ensureMeta() error {
	metaPath := filepath.Join(svc.dataDir, "_meta.json")
	if _, err := os.Stat(metaPath); err == nil {
		return nil
	}
	now := nowMs()
	meta := map[string]any{"schemaVersion": aiDrawSchemaVersion, "dataVersion": aiDrawDataVersion, "createdAt": now, "updatedAt": now}
	return svc.store.write(metaPath, meta)
}

func (svc *service) readShard(key string) (any, error) {
	fileName := shardFile(key)
	value, err := svc.store.read(filepath.Join(svc.dataDir, fileName))
	if err != nil || value != nil {
		if err != nil {
			return nil, err
		}
		return svc.normalizeShardValue(key, value)
	}

	value, err = svc.store.read(filepath.Join(svc.dataDir, filepath.FromSlash(legacyShardDir), fileName))
	if err != nil || value != nil {
		if err != nil {
			return nil, err
		}
		return svc.normalizeShardValue(key, value)
	}

	legacyPack, err := svc.store.read(filepath.Join(svc.dataDir, legacyPackFile))
	if err != nil || legacyPack == nil {
		return nil, err
	}
	legacyMap, ok := legacyPack.(map[string]any)
	if !ok {
		return nil, nil
	}
	return svc.normalizeShardValue(key, legacyMap[key])
}

func (svc *service) normalizeShardValue(key string, value any) (any, error) {
	if key != "refLibraryIndex" || value == nil {
		return value, nil
	}
	paths, err := svc.referenceImages.list()
	if err != nil {
		return value, nil
	}
	return normalizeRefLibraryIndexPaths(value, paths), nil
}

func (svc *service) writeShardFromParam(params json.RawMessage, key string, paramName string) error {
	payload, err := decodeMap(params)
	if err != nil {
		return err
	}
	value, ok := payload[paramName]
	if !ok {
		value = nil
	}
	return svc.store.write(filepath.Join(svc.dataDir, shardFile(key)), value)
}

func (svc *service) imageRead(params json.RawMessage, store *imageStore) (any, error) {
	payload, err := decodeMap(params)
	if err != nil {
		return nil, err
	}
	dataURL, err := store.read(asString(payload["path"]))
	return map[string]any{"dataUrl": dataURL}, err
}

func (svc *service) setOutputDir(params json.RawMessage) (any, error) {
	payload, err := decodeMap(params)
	if err != nil {
		return nil, err
	}
	outputDir := asString(payload["outputDir"])
	if err := ensureWritableOutputDir(outputDir); err != nil {
		return nil, err
	}
	svc.outputImages.setRootDir(outputDir)
	return map[string]any{"outputDir": svc.outputImages.currentRootDir()}, nil
}

func (svc *service) imageSave(params json.RawMessage, store *imageStore) (any, error) {
	payload, err := decodeMap(params)
	if err != nil {
		return nil, err
	}
	savedPath, err := store.saveBase64(asString(payload["dataUrlOrBase64"]))
	return map[string]any{"savedPath": savedPath}, err
}

func (svc *service) imageDelete(params json.RawMessage, store *imageStore) error {
	payload, err := decodeMap(params)
	if err != nil {
		return err
	}
	return store.delete(asString(payload["path"]))
}

func shardFile(key string) string {
	switch key {
	case "settings":
		return "settings.json"
	case "taskHistory":
		return "taskHistory.json"
	case "promptLibrary":
		return "promptLibrary.json"
	case "refLibraryIndex":
		return "refLibraryIndex.json"
	default:
		return key + ".json"
	}
}

func resolvePluginCompatibleDir(dataDir string, pluginDir string, appDir string) string {
	pluginPath := filepath.Join(dataDir, pluginDir)
	if isDir(pluginPath) {
		return pluginPath
	}
	appPath := filepath.Join(dataDir, appDir)
	if isDir(appPath) {
		return appPath
	}
	return pluginPath
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func normalizeRefLibraryIndexPaths(value any, availablePaths []string) any {
	index, ok := value.(map[string]any)
	if !ok {
		return value
	}
	lookup := buildRefPathLookup(availablePaths)
	if len(lookup) == 0 {
		return value
	}

	if rawFolderIDs, ok := index["folderIdsByPath"].(map[string]any); ok {
		next := make(map[string]any)
		for rawPath, rawIDs := range rawFolderIDs {
			path, ok := matchRefPath(rawPath, lookup)
			if !ok {
				continue
			}
			ids := normalizeStringList(rawIDs)
			if len(ids) == 0 {
				continue
			}
			next[path] = mergeStringLists(normalizeStringList(next[path]), ids)
		}
		index["folderIdsByPath"] = next
	}

	if rawOrderByFolder, ok := index["folderItemOrderByFolderId"].(map[string]any); ok {
		next := make(map[string]any)
		for folderID, rawOrder := range rawOrderByFolder {
			seen := make(map[string]bool)
			order := make([]string, 0)
			for _, rawPath := range normalizeStringList(rawOrder) {
				path, ok := matchRefPath(rawPath, lookup)
				if !ok || seen[path] {
					continue
				}
				seen[path] = true
				order = append(order, path)
			}
			if len(order) > 0 {
				next[folderID] = order
			}
		}
		index["folderItemOrderByFolderId"] = next
	}

	return index
}

func buildRefPathLookup(paths []string) map[string]string {
	lookup := make(map[string]string)
	for _, rawPath := range paths {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		for _, key := range []string{refPathLookupKey(path), refPathLookupKey(refPathBase(path))} {
			if key != "" {
				lookup[key] = path
			}
		}
	}
	return lookup
}

func matchRefPath(rawPath string, lookup map[string]string) (string, bool) {
	path := strings.TrimSpace(rawPath)
	if path == "" {
		return "", false
	}
	if matched, ok := lookup[refPathLookupKey(path)]; ok {
		return matched, true
	}
	matched, ok := lookup[refPathLookupKey(refPathBase(path))]
	return matched, ok
}

func refPathLookupKey(path string) string {
	value := strings.TrimSpace(path)
	value = strings.TrimPrefix(value, `\\?\`)
	value = strings.ReplaceAll(value, "\\", "/")
	return strings.ToLower(value)
}

func refPathBase(path string) string {
	value := strings.TrimSpace(path)
	value = strings.ReplaceAll(value, "\\", "/")
	value = strings.TrimRight(value, "/")
	index := strings.LastIndex(value, "/")
	if index >= 0 {
		return value[index+1:]
	}
	return value
}

func normalizeStringList(value any) []string {
	switch items := value.(type) {
	case []any:
		out := make([]string, 0, len(items))
		for _, item := range items {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	case []string:
		out := make([]string, 0, len(items))
		for _, item := range items {
			text := strings.TrimSpace(item)
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func mergeStringLists(first []string, second []string) []string {
	out := make([]string, 0, len(first)+len(second))
	seen := make(map[string]bool)
	for _, list := range [][]string{first, second} {
		for _, item := range list {
			text := strings.TrimSpace(item)
			if text == "" || seen[text] {
				continue
			}
			seen[text] = true
			out = append(out, text)
		}
	}
	return out
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

func asString(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func intNumber(value any) int {
	switch n := value.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		v, _ := n.Int64()
		return int(v)
	default:
		return 0
	}
}
