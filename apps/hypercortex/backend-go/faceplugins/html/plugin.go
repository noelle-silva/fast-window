// Package html 是网页面（html）的数据语义半包。
// 它只实现协议要求的内容语义，不感知宿主存储、索引与编排结构。
package html

import (
	"encoding/json"
	"fmt"
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

// Plugin 返回网页面的协议声明与数据语义实现。
func Plugin() faceplugin.Plugin {
	return faceplugin.Plugin{
		ProtocolVersion: faceplugin.ProtocolVersion,
		Kind:            "html",
		Label:           "HTML",
		DefaultFaceID:   "html",
		DefaultFileName: "html-view.html",
		Capabilities: faceplugin.Capabilities{
			Editable:    true,
			Searchable:  false,
			Previewable: true,
			Creatable:   true,
			Deletable:   true,
		},
		NormalizeContent:  normalizeContent,
		EmptyContent:      func(noteID string, noteTitle string) string { return emptyDoc(noteID, noteTitle) },
		NormalizeSettings: normalizeSettings,
		ExtractRefs:       faceplugin.ExtractPlaceholderRefs,
	}
}

func normalizeContent(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

// displayModes 与前端 htmlFaceDisplay.ts 的 isHtmlFaceDisplayMode 保持同一枚举。
var displayModes = map[string]bool{
	"natural":    true,
	"fit-window": true,
	"fixed-fit":  true,
}

func normalizeSettings(value map[string]any) map[string]any {
	out := map[string]any{}
	if value == nil {
		return out
	}
	if scale := asFloat(value["fixedScale"]); scale >= 0.25 && scale <= 2 {
		out["fixedScale"] = scale
	}
	if mode := strings.TrimSpace(asString(value["displayMode"])); displayModes[mode] {
		out["displayMode"] = mode
	}
	return out
}

func asFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

func asString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	case json.Number:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}
