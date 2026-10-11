package main

import (
	"encoding/json"
	"testing"
)

// 声明单源：listFacePlugins 返回全部已注册面插件的声明，网页面设置文案逐字固化。
func TestListFacePluginsDeclaresMarkdownHtmlAndMindmap(t *testing.T) {
	svc := newTestService(t)

	result, err := svc.dispatch("hypercortex.notes.listFacePlugins", nil)
	if err != nil {
		t.Fatalf("list face plugins failed: %v", err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal declarations failed: %v", err)
	}
	var declarations []map[string]any
	if err := json.Unmarshal(raw, &declarations); err != nil {
		t.Fatalf("unmarshal declarations failed: %v", err)
	}
	if len(declarations) != 3 {
		t.Fatalf("declarations = %s", raw)
	}
	byKind := map[string]map[string]any{}
	for _, declaration := range declarations {
		byKind[declaration["kind"].(string)] = declaration
	}

	markdown, ok := byKind["markdown"]
	if !ok {
		t.Fatalf("markdown declaration missing: %s", raw)
	}
	if markdown["label"] != "文本" || markdown["defaultFaceId"] != "text" || markdown["defaultFileName"] != "text.md" || markdown["protocolVersion"] != float64(1) {
		t.Fatalf("markdown declaration = %#v", markdown)
	}
	markdownCapabilities := markdown["capabilities"].(map[string]any)
	if markdownCapabilities["editable"] != true || markdownCapabilities["searchable"] != true || markdownCapabilities["previewable"] != true || markdownCapabilities["creatable"] != true || markdownCapabilities["deletable"] != true {
		t.Fatalf("markdown capabilities = %#v", markdownCapabilities)
	}
	markdownSettings, ok := markdown["settings"].([]any)
	if !ok || len(markdownSettings) != 0 {
		t.Fatalf("markdown settings = %#v, want empty array", markdown["settings"])
	}
	if _, ok := markdown["settingsTitle"]; ok {
		t.Fatalf("markdown must not declare settingsTitle: %#v", markdown)
	}

	html, ok := byKind["html"]
	if !ok {
		t.Fatalf("html declaration missing: %s", raw)
	}
	if html["label"] != "HTML" || html["defaultFaceId"] != "html" || html["defaultFileName"] != "html-view.html" || html["protocolVersion"] != float64(1) {
		t.Fatalf("html declaration = %#v", html)
	}
	capabilities := html["capabilities"].(map[string]any)
	if capabilities["editable"] != true || capabilities["searchable"] != false || capabilities["previewable"] != true || capabilities["creatable"] != true || capabilities["deletable"] != true {
		t.Fatalf("html capabilities = %#v", capabilities)
	}
	if html["settingsTitle"] != "HTML 面显示策略" {
		t.Fatalf("settingsTitle = %#v", html["settingsTitle"])
	}
	if html["settingsIntro"] != "控制「HTML 面」的 iframe 在查看（非编辑）状态下的尺寸行为。" {
		t.Fatalf("settingsIntro = %#v", html["settingsIntro"])
	}

	htmlSettings, ok := html["settings"].([]any)
	if !ok || len(htmlSettings) != 2 {
		t.Fatalf("html settings = %#v, want 2 fields", html["settings"])
	}
	assertHtmlDisplayModeSetting(t, htmlSettings[0].(map[string]any))
	assertHtmlFixedScaleSetting(t, htmlSettings[1].(map[string]any))

	mindmap, ok := byKind["mindmap"]
	if !ok {
		t.Fatalf("mindmap declaration missing: %s", raw)
	}
	if mindmap["label"] != "思维导图" || mindmap["defaultFaceId"] != "mindmap" || mindmap["defaultFileName"] != "mindmap.json" || mindmap["protocolVersion"] != float64(1) {
		t.Fatalf("mindmap declaration = %#v", mindmap)
	}
	mindmapCapabilities := mindmap["capabilities"].(map[string]any)
	if mindmapCapabilities["editable"] != true || mindmapCapabilities["searchable"] != true || mindmapCapabilities["previewable"] != true || mindmapCapabilities["creatable"] != true || mindmapCapabilities["deletable"] != true {
		t.Fatalf("mindmap capabilities = %#v", mindmapCapabilities)
	}
	if mindmap["settingsTitle"] != "思维导图面设置" || mindmap["settingsIntro"] != "思维导图面的默认布局、主题与缩放。" {
		t.Fatalf("mindmap settings texts = %#v", mindmap)
	}
	mindmapSettings, ok := mindmap["settings"].([]any)
	if !ok || len(mindmapSettings) != 3 {
		t.Fatalf("mindmap settings = %#v, want 3 fields", mindmap["settings"])
	}
	assertMindmapLayoutSetting(t, mindmapSettings[0].(map[string]any))
	assertMindmapThemeSetting(t, mindmapSettings[1].(map[string]any))
	assertMindmapScaleSetting(t, mindmapSettings[2].(map[string]any))
}

func assertMindmapLayoutSetting(t *testing.T, field map[string]any) {
	t.Helper()
	if field["key"] != "layout" || field["kind"] != "enum" || field["label"] != "布局结构" || field["default"] != "mindMap" {
		t.Fatalf("layout field = %#v", field)
	}
	options, ok := field["options"].([]any)
	if !ok || len(options) != 5 {
		t.Fatalf("layout options = %#v", field["options"])
	}
	wantValues := []string{"logicalStructure", "mindMap", "organizationStructure", "timeline", "fishbone"}
	for index, want := range wantValues {
		if options[index].(map[string]any)["value"] != want {
			t.Fatalf("layout option %d = %#v, want value %s", index, options[index], want)
		}
	}
}

func assertMindmapThemeSetting(t *testing.T, field map[string]any) {
	t.Helper()
	if field["key"] != "theme" || field["kind"] != "enum" || field["label"] != "主题" || field["default"] != "default" {
		t.Fatalf("theme field = %#v", field)
	}
	options, ok := field["options"].([]any)
	if !ok || len(options) != 2 {
		t.Fatalf("theme options = %#v", field["options"])
	}
	if options[0].(map[string]any)["value"] != "default" || options[1].(map[string]any)["value"] != "dark" {
		t.Fatalf("theme options = %#v", field["options"])
	}
}

func assertMindmapScaleSetting(t *testing.T, field map[string]any) {
	t.Helper()
	if field["key"] != "scale" || field["kind"] != "number" || field["label"] != "默认缩放" || field["globalLabel"] != "全局默认缩放" || field["format"] != "percent" {
		t.Fatalf("scale field = %#v", field)
	}
	if field["description"] != "打开该面时的默认缩放，当前 {value}。" || field["noteDescription"] != "打开该面时的默认缩放；全局默认 {global}。" {
		t.Fatalf("scale description = %#v", field)
	}
	if field["default"] != float64(1) || field["min"] != 0.2 || field["max"] != float64(4) || field["step"] != 0.1 {
		t.Fatalf("scale range = %#v", field)
	}
	if _, ok := field["options"]; ok {
		t.Fatalf("scale must not contain options: %#v", field)
	}
}

func assertHtmlDisplayModeSetting(t *testing.T, field map[string]any) {
	t.Helper()
	if field["key"] != "displayMode" || field["kind"] != "enum" || field["label"] != "HTML 面显示方式" || field["default"] != "fixed-fit" {
		t.Fatalf("displayMode field = %#v", field)
	}
	for _, absent := range []string{"globalLabel", "description", "noteDescription", "format", "min", "max", "step"} {
		if _, ok := field[absent]; ok {
			t.Fatalf("displayMode must not contain %s: %#v", absent, field)
		}
	}
	options, ok := field["options"].([]any)
	if !ok || len(options) != 3 {
		t.Fatalf("displayMode options = %#v", field["options"])
	}
	wantOptions := []map[string]any{
		{"value": "natural", "label": "自然撑开", "description": "iframe 高度随内容自动伸展，滚动由外层页面接管。"},
		{"value": "fit-window", "label": "随窗口自适应", "description": "iframe 铺满当前可用区域，内容在 iframe 内部独立滚动。"},
		{"value": "fixed-fit", "label": "固定视口缩放", "description": "以 1280×900 固定视口渲染，自动缩放以确保内容完整可见，可手动调整缩放比例。"},
	}
	for index, want := range wantOptions {
		option := options[index].(map[string]any)
		if option["value"] != want["value"] || option["label"] != want["label"] || option["description"] != want["description"] {
			t.Fatalf("displayMode option %d = %#v, want %#v", index, option, want)
		}
	}
}

func assertHtmlFixedScaleSetting(t *testing.T, field map[string]any) {
	t.Helper()
	if field["key"] != "fixedScale" || field["kind"] != "number" || field["label"] != "HTML 面缩放比例" {
		t.Fatalf("fixedScale field = %#v", field)
	}
	if field["globalLabel"] != "全局默认缩放比例" || field["format"] != "percent" {
		t.Fatalf("fixedScale labels = %#v", field)
	}
	if field["description"] != "仅用于“固定视口缩放”模式。默认值为 {value}；如果某篇笔记保存了自己的缩放比例，则优先使用笔记自己的值。" {
		t.Fatalf("fixedScale description = %#v", field["description"])
	}
	if field["noteDescription"] != "仅用于“固定视口缩放”模式；拖动结束后自动保存为这篇笔记自己的比例，全局默认为 {global}。" {
		t.Fatalf("fixedScale noteDescription = %#v", field["noteDescription"])
	}
	if field["default"] != 0.95 || field["min"] != 0.25 || field["max"] != float64(2) || field["step"] != 0.01 {
		t.Fatalf("fixedScale range = %#v", field)
	}
	if _, ok := field["options"]; ok {
		t.Fatalf("fixedScale must not contain options: %#v", field)
	}
}
