package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

func readJSONFile(path string, out any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return os.ErrNotExist
	}
	return json.Unmarshal(raw, out)
}

func writeJSONFile(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return writeFileAtomic(path, payload)
}

func writeRawJSONFile(path string, raw json.RawMessage) error {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		return errors.New("JSON 内容为空")
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	return writeJSONFile(path, value)
}

func (svc *service) tryLoadJSON(scope string, rel string) (any, error) {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return nil, err
	}
	var value any
	if err := readJSONFile(target, &value); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		// 损坏或不可读时快速失败：交由上层报告，禁止以「不存在」处理并覆盖写空配置。
		return nil, fmt.Errorf("读取 %s 失败：%w", rel, err)
	}
	return value, nil
}

func (svc *service) ensureJSON(scope string, rel string, fallback any) (any, error) {
	existing, err := svc.tryLoadJSON(scope, rel)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return nil, err
	}
	if err := writeJSONFile(target, fallback); err != nil {
		return nil, err
	}
	return fallback, nil
}

func (svc *service) writeRawJSON(scope string, rel string, raw json.RawMessage) error {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	return writeRawJSONFile(target, raw)
}
