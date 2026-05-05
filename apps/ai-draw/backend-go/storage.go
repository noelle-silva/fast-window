package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type jsonStore struct {
	mu sync.Mutex
}

func newJSONStore() *jsonStore {
	return &jsonStore{}
}

func (store *jsonStore) read(path string) (any, error) {
	bytes, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取 JSON 失败: %w", err)
	}
	if strings.TrimSpace(string(bytes)) == "" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal(bytes, &value); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %s: %w", path, err)
	}
	return value, nil
}

func (store *jsonStore) write(path string, value any) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("创建 JSON 目录失败: %w", err)
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 JSON 失败: %w", err)
	}
	payload = append(payload, '\n')
	return atomicWriteFile(path, payload, 0o644)
}

func atomicWriteFile(path string, payload []byte, perm os.FileMode) error {
	tmp := fmt.Sprintf("%s.tmp-%d", path, timeNowNano())
	if err := os.WriteFile(tmp, payload, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func timeNowNano() int64 {
	return nowMs() * 1_000_000
}
