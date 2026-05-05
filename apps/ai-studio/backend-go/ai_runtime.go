package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	assistantStreamKeyPrefix = "bg.stream."
	assistantFinalKeyPrefix  = "engine.v1/final/"
	assistantMidRunKeyPrefix = "engine.v1/mid-run/"
	uiChatUpdatedNoticeKey   = "ui/notice/chat-updated"
)

func newService(dataDir string) *service {
	svc := &service{dataDir: dataDir}
	svc.ai = newAIRunQueue(svc)
	return svc
}

func assistantStreamStorageKey(assistantMid string) string {
	return "runtime/" + assistantStreamKeyPrefix + strings.TrimSpace(assistantMid)
}

func assistantFinalStorageKey(assistantMid string) string {
	return "runtime/" + assistantFinalKeyPrefix + strings.TrimSpace(assistantMid)
}

func assistantMidRunStorageKey(assistantMid string) string {
	return "runtime/" + assistantMidRunKeyPrefix + strings.TrimSpace(assistantMid)
}

func uiChatUpdatedNoticeStorageKey() string {
	return "runtime/" + uiChatUpdatedNoticeKey
}

func requestAssistantMid(params json.RawMessage) string {
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	return strings.TrimSpace(asString(payload["assistantMid"]))
}

func (svc *service) storageSetByKey(key string, value any) error {
	path, err := svc.storagePathForKey(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	prepared, err := svc.prepareStorageValueForSet(key, value)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(prepared, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return atomicWriteFile(path, data, 0o644)
}

func (svc *service) storageRemoveByKey(key string) error {
	path, err := svc.storagePathForKey(key)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (svc *service) imageReadDataURLByRel(relPath string) (string, error) {
	path, _, err := svc.imagePathForRel(relPath)
	if err != nil {
		return "", err
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	mime := imageMimeFromExt(filepath.Ext(path))
	if !strings.HasPrefix(mime, "image/") {
		return "", fmt.Errorf("unsupported image MIME: %s", mime)
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(payload), nil
}
