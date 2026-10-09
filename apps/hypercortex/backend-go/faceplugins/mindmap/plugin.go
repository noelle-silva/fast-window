// Package mindmap 是思维导图面（mindmap）的数据语义半包。
// 它只实现协议要求的内容语义，不感知宿主存储、索引与编排结构。
package mindmap

import (
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
		EmptyContent:      func(noteID string, noteTitle string) string { return "" },
		NormalizeSettings: normalizeSettings,
		ExtractRefs:       ExtractRefs,
		SearchText:        SearchText,
		SettingsTitle:     "思维导图面设置",
		SettingsIntro:     "思维导图面的可配置项。",
		Settings:          settingsDeclaration(),
	}
}

func normalizeContent(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

func normalizeSettings(value map[string]any) map[string]any {
	out := map[string]any{}
	if value == nil {
		return out
	}
	for key, item := range value {
		trimmed := strings.TrimSpace(key)
		if trimmed != "" {
			out[trimmed] = item
		}
	}
	return out
}
