package mindmap

import "fast-window-hypercortex-backend/faceplugin"

// settingsDeclaration 声明思维导图面的可配置项（后端为唯一声明源）。
func settingsDeclaration() []faceplugin.SettingField {
	return []faceplugin.SettingField{
		{
			Key:     "layout",
			Kind:    faceplugin.SettingKindEnum,
			Label:   "布局结构",
			Default: "mindMap",
			Options: []faceplugin.SettingOption{
				{Value: "logicalStructure", Label: "逻辑结构图"},
				{Value: "mindMap", Label: "思维导图"},
				{Value: "organizationStructure", Label: "组织结构图"},
				{Value: "timeline", Label: "时间轴"},
				{Value: "fishbone", Label: "鱼骨图"},
			},
		},
		{
			Key:     "theme",
			Kind:    faceplugin.SettingKindEnum,
			Label:   "主题",
			Default: "default",
			Options: []faceplugin.SettingOption{
				{Value: "default", Label: "默认"},
				{Value: "dark", Label: "暗色"},
			},
		},
		{
			Key:             "scale",
			Kind:            faceplugin.SettingKindNumber,
			Label:           "默认缩放",
			GlobalLabel:     "全局默认缩放",
			Format:          "percent",
			Description:     "打开该面时的默认缩放，当前 {value}。",
			NoteDescription: "打开该面时的默认缩放；全局默认 {global}。",
			Default:         1.0,
			Min:             0.2,
			Max:             4,
			Step:            0.1,
		},
	}
}
