package main

import (
	"encoding/json"
	"strings"
)

const clientStateStoragePrefix = "client-state/"

// clientStateLogicalKey 解析「客户端状态」的 storage key：
// client-state/ 前缀之后的键名为客户端状态区里的键。
func clientStateLogicalKey(storageKey string) (string, bool) {
	key := strings.TrimSpace(storageKey)
	if !strings.HasPrefix(key, clientStateStoragePrefix) {
		return "", false
	}
	logicalKey := strings.TrimPrefix(key, clientStateStoragePrefix)
	if strings.TrimSpace(logicalKey) == "" {
		return "", false
	}
	return logicalKey, true
}

// handleClientStateStorage 处理 client-state/ 前缀的本地状态读写：
// 它只依赖客户端数据文件、随客户端持久化，不需要 eucli-box 连接；
// 非该前缀的请求原样交回通用分发。
func (s *service) handleClientStateStorage(method string, params json.RawMessage) (bool, any, error) {
	switch method {
	case "aiChat.storageGet":
		key, err := storageKey(params)
		if err != nil {
			return true, nil, err
		}
		logicalKey, ok := clientStateLogicalKey(key)
		if !ok {
			return false, nil, nil
		}
		state, err := s.config.loadClientState()
		if err != nil {
			return true, nil, err
		}
		value, exists := state[logicalKey]
		if !exists {
			return true, nil, nil
		}
		return true, value, nil
	case "aiChat.storageSet":
		key, value, err := storageSetPayload(params)
		if err != nil {
			return true, nil, err
		}
		logicalKey, ok := clientStateLogicalKey(key)
		if !ok {
			return false, nil, nil
		}
		if _, err := s.config.updateClientState(func(state map[string]any) { state[logicalKey] = value }); err != nil {
			return true, nil, err
		}
		return true, map[string]any{}, nil
	case "aiChat.storageRemove":
		key, err := storageKey(params)
		if err != nil {
			return true, nil, err
		}
		logicalKey, ok := clientStateLogicalKey(key)
		if !ok {
			return false, nil, nil
		}
		if _, err := s.config.updateClientState(func(state map[string]any) { delete(state, logicalKey) }); err != nil {
			return true, nil, err
		}
		return true, map[string]any{}, nil
	default:
		return false, nil, nil
	}
}
