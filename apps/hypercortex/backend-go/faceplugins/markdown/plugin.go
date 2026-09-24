// Package markdown 是文本面（markdown）的数据语义半包。
// 它只实现协议要求的内容语义，不感知宿主存储、索引与编排结构。
package markdown

import (
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

// Plugin 返回文本面的协议声明与数据语义实现。
func Plugin() faceplugin.Plugin {
	return faceplugin.Plugin{
		ProtocolVersion: faceplugin.ProtocolVersion,
		Kind:            "markdown",
		Label:           "文本",
		DefaultFaceID:   "text",
		DefaultFileName: "text.md",
		Capabilities: faceplugin.Capabilities{
			Editable:    true,
			Searchable:  true,
			Previewable: true,
			Creatable:   true,
			Deletable:   true,
		},
		NormalizeContent:  normalizeContent,
		EmptyContent:      func(noteID string, noteTitle string) string { return "" },
		NormalizeSettings: normalizePlainSettings,
		ExtractRefs:       faceplugin.ExtractPlaceholderRefs,
		SearchText:        SearchText,
	}
}

func normalizeContent(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

func normalizePlainSettings(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	out := map[string]any{}
	for k, v := range value {
		key := strings.TrimSpace(k)
		if key != "" {
			out[key] = v
		}
	}
	return out
}
