// Package faceplugin 定义笔记面插件协议：声明、能力、数据语义接口与统一注册表。
// 宿主只通过本协议认识面；插件包不感知宿主的存储、索引与编排结构。
package faceplugin

import (
	"encoding/json"
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

// 设置项形态标识。
const (
	SettingKindEnum   = "enum"
	SettingKindNumber = "number"
)

// SettingOption 是枚举设置项的一个可选值。
type SettingOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// SettingField 是插件声明的一个可配置项。
// Default 承载枚举的字符串默认值或数值形态的数值默认值；
// 对外 JSON 形态由 Kind 决定：枚举带 options，数值带 min/max/step。
type SettingField struct {
	Key             string
	Kind            string
	Label           string
	GlobalLabel     string
	Description     string
	NoteDescription string
	Format          string
	Default         any
	Options         []SettingOption
	Min             float64
	Max             float64
	Step            float64
}

// MarshalJSON 按设置项形态输出声明 JSON：枚举不带范围字段，数值不带选项。
func (field SettingField) MarshalJSON() ([]byte, error) {
	switch field.Kind {
	case SettingKindEnum:
		payload := struct {
			Key             string          `json:"key"`
			Kind            string          `json:"kind"`
			Label           string          `json:"label"`
			GlobalLabel     string          `json:"globalLabel,omitempty"`
			Description     string          `json:"description,omitempty"`
			NoteDescription string          `json:"noteDescription,omitempty"`
			Format          string          `json:"format,omitempty"`
			Default         any             `json:"default"`
			Options         []SettingOption `json:"options"`
		}{Key: field.Key, Kind: field.Kind, Label: field.Label, GlobalLabel: field.GlobalLabel, Description: field.Description, NoteDescription: field.NoteDescription, Format: field.Format, Default: field.Default, Options: field.Options}
		return json.Marshal(payload)
	case SettingKindNumber:
		payload := struct {
			Key             string  `json:"key"`
			Kind            string  `json:"kind"`
			Label           string  `json:"label"`
			GlobalLabel     string  `json:"globalLabel,omitempty"`
			Description     string  `json:"description,omitempty"`
			NoteDescription string  `json:"noteDescription,omitempty"`
			Format          string  `json:"format,omitempty"`
			Default         any     `json:"default"`
			Min             float64 `json:"min"`
			Max             float64 `json:"max"`
			Step            float64 `json:"step"`
		}{Key: field.Key, Kind: field.Kind, Label: field.Label, GlobalLabel: field.GlobalLabel, Description: field.Description, NoteDescription: field.NoteDescription, Format: field.Format, Default: field.Default, Min: field.Min, Max: field.Max, Step: field.Step}
		return json.Marshal(payload)
	default:
		return nil, fmt.Errorf("未知设置项形态：%s", field.Kind)
	}
}

// Declaration 是插件对外的声明（声明单源）：宿主与界面只通过它认识面。
type Declaration struct {
	Kind            string         `json:"kind"`
	Label           string         `json:"label"`
	DefaultFaceID   string         `json:"defaultFaceId"`
	DefaultFileName string         `json:"defaultFileName"`
	Capabilities    Capabilities   `json:"capabilities"`
	ProtocolVersion int            `json:"protocolVersion"`
	SettingsTitle   string         `json:"settingsTitle,omitempty"`
	SettingsIntro   string         `json:"settingsIntro,omitempty"`
	Settings        []SettingField `json:"settings"`
}

// DeclarationOf 把一个已注册插件映射为对外声明；settings 始终序列化为数组。
func DeclarationOf(plugin Plugin) Declaration {
	settings := plugin.Settings
	if settings == nil {
		settings = []SettingField{}
	}
	return Declaration{
		Kind:            plugin.Kind,
		Label:           plugin.Label,
		DefaultFaceID:   plugin.DefaultFaceID,
		DefaultFileName: plugin.DefaultFileName,
		Capabilities:    plugin.Capabilities,
		ProtocolVersion: plugin.ProtocolVersion,
		SettingsTitle:   plugin.SettingsTitle,
		SettingsIntro:   plugin.SettingsIntro,
		Settings:        settings,
	}
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
	// SettingsTitle 是笔记设置区该面设置块的标题；空表示由界面使用默认展示。
	SettingsTitle string
	// SettingsIntro 是设置块的说明文案。
	SettingsIntro string
	// Settings 是可配置项声明。
	Settings []SettingField
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
	if err := validateSettings(kind, plugin.Settings); err != nil {
		return err
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

// ListDeclarations 返回全部已注册插件的对外声明，顺序与 List 一致。
func ListDeclarations() []Declaration {
	plugins := List()
	declarations := make([]Declaration, 0, len(plugins))
	for _, plugin := range plugins {
		declarations = append(declarations, DeclarationOf(plugin))
	}
	return declarations
}

// validateSettings 校验设置声明的合法性（键唯一、形态已知、默认值有效），装配期快速失败。
func validateSettings(kind string, settings []SettingField) error {
	seen := map[string]bool{}
	for _, field := range settings {
		key := strings.TrimSpace(field.Key)
		if key == "" {
			return fmt.Errorf("面插件 %q 的设置项缺少键", kind)
		}
		if seen[key] {
			return fmt.Errorf("面插件 %q 的设置项键重复：%s", kind, key)
		}
		seen[key] = true
		if strings.TrimSpace(field.Label) == "" {
			return fmt.Errorf("面插件 %q 的设置项 %s 缺少名称", kind, key)
		}
		switch field.Kind {
		case SettingKindEnum:
			if err := validateEnumSetting(kind, key, field); err != nil {
				return err
			}
		case SettingKindNumber:
			if err := validateNumberSetting(kind, key, field); err != nil {
				return err
			}
		default:
			return fmt.Errorf("面插件 %q 的设置项 %s 形态非法：%q", kind, key, field.Kind)
		}
	}
	return nil
}

func validateEnumSetting(kind string, key string, field SettingField) error {
	if len(field.Options) == 0 {
		return fmt.Errorf("面插件 %q 的枚举设置项 %s 缺少选项", kind, key)
	}
	defaultValue, ok := field.Default.(string)
	if !ok {
		return fmt.Errorf("面插件 %q 的枚举设置项 %s 默认值必须是字符串", kind, key)
	}
	optionValues := map[string]bool{}
	for _, option := range field.Options {
		value := strings.TrimSpace(option.Value)
		if value == "" || strings.TrimSpace(option.Label) == "" {
			return fmt.Errorf("面插件 %q 的枚举设置项 %s 选项无效", kind, key)
		}
		if optionValues[value] {
			return fmt.Errorf("面插件 %q 的枚举设置项 %s 选项重复：%s", kind, key, value)
		}
		optionValues[value] = true
	}
	if !optionValues[defaultValue] {
		return fmt.Errorf("面插件 %q 的枚举设置项 %s 默认值 %q 不在选项中", kind, key, defaultValue)
	}
	return nil
}

func validateNumberSetting(kind string, key string, field SettingField) error {
	if field.Min >= field.Max {
		return fmt.Errorf("面插件 %q 的数值设置项 %s 取值范围无效", kind, key)
	}
	if field.Step <= 0 {
		return fmt.Errorf("面插件 %q 的数值设置项 %s 步长无效", kind, key)
	}
	defaultValue, ok := settingNumber(field.Default)
	if !ok {
		return fmt.Errorf("面插件 %q 的数值设置项 %s 默认值必须是数值", kind, key)
	}
	if defaultValue < field.Min || defaultValue > field.Max {
		return fmt.Errorf("面插件 %q 的数值设置项 %s 默认值 %v 超出范围 [%v, %v]", kind, key, defaultValue, field.Min, field.Max)
	}
	return nil
}

func settingNumber(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}
