// Package mindmap 是思维导图面（mindmap）的数据语义半包。
// 它只实现协议要求的内容语义，不感知宿主存储、索引与编排结构。
package mindmap

import (
	"bytes"
	"encoding/json"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

// Plugin 返回思维导图面的协议声明与数据语义实现。
func Plugin() faceplugin.Plugin {
	return faceplugin.Plugin{
		ProtocolVersion: faceplugin.ProtocolVersion,
		Kind:            "mindmap",
		Label:           "思维导图",
		DefaultFaceID:   "mindmap",
		DefaultFileName: "mindmap.json",
		Capabilities: faceplugin.Capabilities{
			Editable:    true,
			Searchable:  true,
			Previewable: true,
			Creatable:   true,
			Deletable:   true,
		},
		NormalizeContent:  normalizeContent,
		EmptyContent:      func(noteID string, noteTitle string) string { return newDocument(noteTitle) },
		NormalizeSettings: normalizeSettings,
		ExtractRefs:       ExtractRefs,
		SearchText:        SearchText,
		SettingsTitle:     "思维导图面设置",
		SettingsIntro:     "思维导图面的默认布局、主题与缩放。",
		Settings:          settingsDeclaration(),
	}
}

// normalizeContent 归一化内容：统一换行；合法 JSON 收敛为紧凑形态，非法则原样返回。
func normalizeContent(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	var buf bytes.Buffer
	if err := json.Compact(&buf, []byte(value)); err == nil {
		return buf.String()
	}
	return value
}

// normalizeSettings 按设置声明收敛合法值：枚举只接受声明选项，数值只接受声明范围。
func normalizeSettings(value map[string]any) map[string]any {
	out := map[string]any{}
	if value == nil {
		return out
	}
	for _, field := range settingsDeclaration() {
		raw, ok := value[field.Key]
		if !ok {
			continue
		}
		if field.Kind == faceplugin.SettingKindNumber {
			if n, valid := asNumber(raw); valid && n >= field.Min && n <= field.Max {
				out[field.Key] = n
			}
			continue
		}
		text := strings.TrimSpace(asString(raw))
		for _, option := range field.Options {
			if option.Value == text {
				out[field.Key] = text
				break
			}
		}
	}
	return out
}

func asNumber(value any) (float64, bool) {
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

func asString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}
