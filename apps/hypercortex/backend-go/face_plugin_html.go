package main

import (
	"strings"

	"fast-window-hypercortex-backend/faceplugin"
)

// htmlFacePlugin 是网页面在当前阶段的宿主内注册（分步迁移的过渡形态）。
// 过程 3 会把它的声明与数据语义搬入独立插件包，本文件随之删除。
func htmlFacePlugin() faceplugin.Plugin {
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
		NormalizeContent:  normalizeTextFaceContent,
		EmptyContent:      func(noteID string, noteTitle string) string { return emptyHTMLDoc(noteID, noteTitle) },
		NormalizeSettings: normalizeHTMLSettings,
		ExtractRefs:       faceplugin.ExtractPlaceholderRefs,
	}
}

func normalizeTextFaceContent(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

// htmlFaceDisplayModes 与前端 htmlFaceDisplay.ts 的 isHtmlFaceDisplayMode 保持同一枚举。
var htmlFaceDisplayModes = map[string]bool{
	"natural":    true,
	"fit-window": true,
	"fixed-fit":  true,
}

func normalizeHTMLSettings(value map[string]any) map[string]any {
	out := map[string]any{}
	if value == nil {
		return out
	}
	if scale := asFloat(value["fixedScale"]); scale >= 0.25 && scale <= 2 {
		out["fixedScale"] = scale
	}
	if mode := strings.TrimSpace(asString(value["displayMode"])); htmlFaceDisplayModes[mode] {
		out["displayMode"] = mode
	}
	return out
}
