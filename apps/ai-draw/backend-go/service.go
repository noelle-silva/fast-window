package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
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
	outputImages := newImageStore(filepath.Join(dataDir, "outputs"))
	svc := &service{
		dataDir:         dataDir,
		store:           newJSONStore(),
		outputImages:    outputImages,
		referenceImages: newImageStore(filepath.Join(dataDir, "reference-images")),
		generation:      newGenerationService(outputImages, newOpenAIImageProvider(nil), sink),
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
	meta := map[string]any{"schemaVersion": 1, "createdAt": nowMs()}
	return svc.store.write(metaPath, meta)
}

func (svc *service) readShard(key string) (any, error) {
	return svc.store.read(filepath.Join(svc.dataDir, shardFile(key)))
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
