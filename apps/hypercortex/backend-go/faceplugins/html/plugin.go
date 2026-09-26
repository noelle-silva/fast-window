// Package html 是网页面（html）的数据语义半包。
// 它只实现协议要求的内容语义，不感知宿主存储、索引与编排结构。
package html

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
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
		ExtractRefs:       ExtractRefs,
		SettingsTitle:     "HTML 面显示策略",
		SettingsIntro:     "控制「HTML 面」的 iframe 在查看（非编辑）状态下的尺寸行为。",
		Settings:          settingsDeclaration(),
	}
}

// settingsDeclaration 声明网页面可配置项：显示方式与缩放比例（后端为唯一声明源）。
func settingsDeclaration() []faceplugin.SettingField {
	return []faceplugin.SettingField{
		{
			Key:     "displayMode",
			Kind:    faceplugin.SettingKindEnum,
			Label:   "HTML 面显示方式",
			Default: "fixed-fit",
			Options: []faceplugin.SettingOption{
				{Value: "natural", Label: "自然撑开", Description: "iframe 高度随内容自动伸展，滚动由外层页面接管。"},
				{Value: "fit-window", Label: "随窗口自适应", Description: "iframe 铺满当前可用区域，内容在 iframe 内部独立滚动。"},
				{Value: "fixed-fit", Label: "固定视口缩放", Description: "以 1280×900 固定视口渲染，自动缩放以确保内容完整可见，可手动调整缩放比例。"},
			},
		},
		{
			Key:             "fixedScale",
			Kind:            faceplugin.SettingKindNumber,
			Label:           "HTML 面缩放比例",
			GlobalLabel:     "全局默认缩放比例",
			Format:          "percent",
			Description:     "仅用于“固定视口缩放”模式。默认值为 {value}；如果某篇笔记保存了自己的缩放比例，则优先使用笔记自己的值。",
			NoteDescription: "仅用于“固定视口缩放”模式；拖动结束后自动保存为这篇笔记自己的比例，全局默认为 {global}。",
			Default:         0.95,
			Min:             0.25,
			Max:             2,
			Step:            0.01,
		},
	}
}

func normalizeContent(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

// normalizeSettings 从声明派生合法值收敛：显示方式只接受声明中的枚举值，缩放只接受声明范围。
func normalizeSettings(value map[string]any) map[string]any {
	out := map[string]any{}
	if value == nil {
		return out
	}
	for _, field := range settingsDeclaration() {
		switch field.Key {
		case "fixedScale":
			if scale := asFloat(value["fixedScale"]); scale >= field.Min && scale <= field.Max {
				out["fixedScale"] = scale
			}
		case "displayMode":
			mode := strings.TrimSpace(asString(value["displayMode"]))
			for _, option := range field.Options {
				if option.Value == mode {
					out["displayMode"] = mode
					break
				}
			}
		}
	}
	return out
}

// NormalizeLegacyDisplayMode 归一化旧版全局字段（htmlFaceDisplayMode）的显示方式：
// 合法枚举保留，非法值回落到声明默认（值域从设置声明派生，避免双事实源）。
func NormalizeLegacyDisplayMode(value any) string {
	field, ok := settingFieldByKey("displayMode")
	if !ok {
		return ""
	}
	mode := strings.TrimSpace(asString(value))
	for _, option := range field.Options {
		if option.Value == mode {
			return mode
		}
	}
	fallback, _ := field.Default.(string)
	return fallback
}

// NormalizeLegacyFixedScale 归一化旧版全局字段（htmlFaceFixedScaleDefault）的缩放比例：
// 数值或数字字符串解析后收敛到声明范围，无效值回落到声明默认。
func NormalizeLegacyFixedScale(value any) float64 {
	field, ok := settingFieldByKey("fixedScale")
	if !ok {
		return 0
	}
	fallback, _ := field.Default.(float64)
	n, valid := legacyNumber(value)
	if !valid || math.IsNaN(n) || math.IsInf(n, 0) {
		return fallback
	}
	if n < field.Min {
		return field.Min
	}
	if n > field.Max {
		return field.Max
	}
	return n
}

// settingFieldByKey 按键取设置声明字段。
func settingFieldByKey(key string) (faceplugin.SettingField, bool) {
	for _, field := range settingsDeclaration() {
		if field.Key == key {
			return field, true
		}
	}
	return faceplugin.SettingField{}, false
}

// legacyNumber 解析旧字段里的数值：接受数值与数字字符串，其余视为无效。
func legacyNumber(value any) (float64, bool) {
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
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f, err == nil
	default:
		return 0, false
	}
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
