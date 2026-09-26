package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	configFileName = "eucli-studio-client-config.json"
)

type clientConfig struct {
	EucliBoxURL          string           `json:"eucliBoxUrl"`
	EucliBoxKey          string           `json:"eucliBoxKey"`
	EucliBoxDisconnected bool             `json:"eucliBoxDisconnected,omitempty"`
	Projection           projectionConfig `json:"projection"`
	// ClientState 是客户端自己的本地状态（与 eucli-box 业务投影无关），
	// 例如「是否引导过」这类只影响客户端体验的记忆；随客户端数据持久化。
	ClientState map[string]any `json:"clientState,omitempty"`
}

type projectionConfig struct {
	UpdatedAt         int64             `json:"updatedAt,omitempty"`
	UI                map[string]any    `json:"ui,omitempty"`
	Settings          map[string]any    `json:"settings,omitempty"`
	RoleOrder         []string          `json:"roleOrder,omitempty"`
	GroupOrder        []string          `json:"groupOrder,omitempty"`
	RoleFolders       map[string]string `json:"roleFolders,omitempty"`
	GroupFolders      map[string]string `json:"groupFolders,omitempty"`
	ProviderFolders   map[string]string `json:"providerFolders,omitempty"`
	ModelGroupFolders map[string]string `json:"modelGroupFolders,omitempty"`
	ActiveChatByRole  map[string]string `json:"activeChatByRole,omitempty"`
	ActiveChatByGroup map[string]string `json:"activeChatByGroup,omitempty"`
}

type configStore struct {
	path string
	dir  string
	mu   sync.Mutex
}

func newConfigStore(dataDir string) (*configStore, error) {
	dir := strings.TrimSpace(dataDir)
	if dir == "" {
		return nil, errors.New("FW_APP_DATA_DIR is required")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &configStore{path: filepath.Join(dir, configFileName), dir: dir}, nil
}

func (s *configStore) dataDir() string {
	return s.dir
}

func (s *configStore) load() (clientConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *configStore) loadLocked() (clientConfig, error) {
	var cfg clientConfig
	payload, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return cfg, err
	}
	cfg.EucliBoxURL = normalizeBaseURL(cfg.EucliBoxURL)
	cfg.EucliBoxKey = strings.TrimSpace(cfg.EucliBoxKey)
	cfg.Projection = normalizeProjection(cfg.Projection)
	return cfg, nil
}

// saveConnection 只更新连接信息；投影数据由 updateProjection 单独维护，
// 保存连接时不能整份覆盖，否则会清掉客户端外观设置与投影索引。
// eucliBoxDisconnected 是用户主动「退出连接」的挂起标记：地址与 Key 保留，自动连接暂停。
func (s *configStore) saveConnection(url string, key string, disconnected bool) (clientConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.loadLocked()
	if err != nil {
		return clientConfig{}, err
	}
	cfg.EucliBoxURL = normalizeBaseURL(url)
	cfg.EucliBoxKey = strings.TrimSpace(key)
	cfg.EucliBoxDisconnected = disconnected
	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return clientConfig{}, err
	}
	if err := os.WriteFile(s.path, append(payload, '\n'), 0o600); err != nil {
		return clientConfig{}, err
	}
	return cfg, nil
}

func (s *configStore) updateProjection(fn func(*projectionConfig)) (projectionConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.loadLocked()
	if err != nil {
		return projectionConfig{}, err
	}
	projection := normalizeProjection(cfg.Projection)
	fn(&projection)
	projection = normalizeProjection(projection)
	projection.UpdatedAt = nowMillis()
	cfg.Projection = projection
	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return projectionConfig{}, err
	}
	if err := os.WriteFile(s.path, append(payload, '\n'), 0o600); err != nil {
		return projectionConfig{}, err
	}
	return cfg.Projection, nil
}

func normalizeProjection(value projectionConfig) projectionConfig {
	if value.UI == nil {
		value.UI = map[string]any{}
	}
	if value.Settings == nil {
		value.Settings = map[string]any{}
	}
	if value.RoleOrder == nil {
		value.RoleOrder = []string{}
	}
	if value.GroupOrder == nil {
		value.GroupOrder = []string{}
	}
	if value.RoleFolders == nil {
		value.RoleFolders = map[string]string{}
	}
	if value.GroupFolders == nil {
		value.GroupFolders = map[string]string{}
	}
	if value.ProviderFolders == nil {
		value.ProviderFolders = map[string]string{}
	}
	if value.ModelGroupFolders == nil {
		value.ModelGroupFolders = map[string]string{}
	}
	if value.ActiveChatByRole == nil {
		value.ActiveChatByRole = map[string]string{}
	}
	if value.ActiveChatByGroup == nil {
		value.ActiveChatByGroup = map[string]string{}
	}
	return value
}

func (s *configStore) loadClientState() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	return normalizeClientState(cfg.ClientState), nil
}

func (s *configStore) updateClientState(fn func(map[string]any)) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	state := normalizeClientState(cfg.ClientState)
	fn(state)
	cfg.ClientState = state
	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(s.path, append(payload, '\n'), 0o600); err != nil {
		return nil, err
	}
	return state, nil
}

func normalizeClientState(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func (s *configStore) requireConfigured() (clientConfig, error) {
	cfg, err := s.load()
	if err != nil {
		return clientConfig{}, err
	}
	if strings.TrimSpace(cfg.EucliBoxURL) == "" {
		return clientConfig{}, newError("EUCLI_BOX_NOT_CONFIGURED", "eucli-box 地址未配置")
	}
	return cfg, nil
}

func normalizeBaseURL(value string) string {
	url := strings.TrimSpace(value)
	url = strings.TrimRight(url, "/")
	return url
}
