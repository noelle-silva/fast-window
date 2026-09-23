// Package faceplugin 定义笔记面插件协议：声明、能力、数据语义接口与统一注册表。
// 宿主只通过本协议认识面；插件包不感知宿主的存储、索引与编排结构。
package faceplugin

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// ProtocolVersion 是当前协议版本；插件声明的版本必须一致才能注册。
const ProtocolVersion = 1

// Capabilities 是面类型的能力画像（随笔记描述文件持久化，字段形态保持不变）。
type Capabilities struct {
	Editable    bool `json:"editable"`
	Searchable  bool `json:"searchable"`
	Previewable bool `json:"previewable"`
	Creatable   bool `json:"creatable"`
	Deletable   bool `json:"deletable"`
}

// Ref 是系统引用占位符解析出的引用目标。
type Ref struct {
	NoteID string `json:"noteId"`
	FaceID string `json:"faceId,omitempty"`
}

// Plugin 是一个面插件的数据语义半包：声明 + 实现。
type Plugin struct {
	// ProtocolVersion 必须等于当前协议版本。
	ProtocolVersion int
	// Kind 是面类型的唯一标识，同时是引用语法中的 face 值。
	Kind string
	// Label 是界面展示名。
	Label string
	// DefaultFaceID 是新建面时的默认面标识。
	DefaultFaceID string
	// DefaultFileName 是新建面时的默认落盘文件名。
	DefaultFileName string
	// Capabilities 是能力画像。
	Capabilities Capabilities
	// NormalizeContent 把提交内容收敛为协议认可的规范形态。
	NormalizeContent func(string) string
	// EmptyContent 生成新建面的初始内容。
	EmptyContent func(noteID string, noteTitle string) string
	// NormalizeSettings 收敛面设置字段集合。
	NormalizeSettings func(map[string]any) map[string]any
	// ExtractRefs 从内容提取系统引用；为 nil 表示不产出引用。
	ExtractRefs func(string) []Ref
	// SearchText 把内容转为可搜文本；与 Capabilities.Searchable 必须一致。
	SearchText func(string) string
}

var (
	registryMu     sync.Mutex
	registry       = map[string]Plugin{}
	defaultFaceIDs = map[string]string{}
)

// Register 在装配期注册插件；任何声明与实现的不一致都在这里快速失败。
func Register(plugin Plugin) error {
	if plugin.ProtocolVersion != ProtocolVersion {
		return fmt.Errorf("面插件 %q 协议版本不匹配：%d != %d", plugin.Kind, plugin.ProtocolVersion, ProtocolVersion)
	}
	kind := strings.TrimSpace(plugin.Kind)
	if kind == "" {
		return errors.New("面插件缺少类型标识")
	}
	if strings.TrimSpace(plugin.Label) == "" {
		return fmt.Errorf("面插件 %q 缺少展示名", kind)
	}
	defaultFaceID := strings.TrimSpace(plugin.DefaultFaceID)
	if defaultFaceID == "" {
		return fmt.Errorf("面插件 %q 缺少默认面标识", kind)
	}
	if strings.TrimSpace(plugin.DefaultFileName) == "" {
		return fmt.Errorf("面插件 %q 缺少默认文件名", kind)
	}
	if plugin.NormalizeContent == nil || plugin.EmptyContent == nil || plugin.NormalizeSettings == nil {
		return fmt.Errorf("面插件 %q 缺少必要的数据语义实现", kind)
	}
	if plugin.Capabilities.Searchable != (plugin.SearchText != nil) {
		return fmt.Errorf("面插件 %q 的可搜能力与搜索文本实现不一致", kind)
	}

	registryMu.Lock()
	defer registryMu.Unlock()
	if _, exists := registry[kind]; exists {
		return fmt.Errorf("面插件类型标识重复：%s", kind)
	}
	if owner, exists := defaultFaceIDs[defaultFaceID]; exists {
		return fmt.Errorf("面插件默认面标识重复：%s（已被 %s 使用）", defaultFaceID, owner)
	}
	plugin.Kind = kind
	plugin.DefaultFaceID = defaultFaceID
	registry[kind] = plugin
	defaultFaceIDs[defaultFaceID] = kind
	return nil
}

// Get 按类型标识查询插件。
func Get(kind string) (Plugin, bool) {
	registryMu.Lock()
	defer registryMu.Unlock()
	plugin, ok := registry[strings.TrimSpace(kind)]
	return plugin, ok
}

// Require 按类型标识查询插件，缺失时返回统一错误。
func Require(kind string) (Plugin, error) {
	plugin, ok := Get(kind)
	if !ok {
		return Plugin{}, errors.New("未知笔记面类型")
	}
	return plugin, nil
}

// List 返回全部已注册插件，按类型标识排序，保证装配与展示顺序稳定。
func List() []Plugin {
	registryMu.Lock()
	plugins := make([]Plugin, 0, len(registry))
	for _, plugin := range registry {
		plugins = append(plugins, plugin)
	}
	registryMu.Unlock()
	sort.Slice(plugins, func(i, j int) bool { return plugins[i].Kind < plugins[j].Kind })
	return plugins
}
