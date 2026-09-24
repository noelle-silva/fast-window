package faceplugin

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func testSettingsPlugin(kind string, settings []SettingField) Plugin {
	return Plugin{
		ProtocolVersion:   ProtocolVersion,
		Kind:              kind,
		Label:             "测试面",
		DefaultFaceID:     kind + "-face",
		DefaultFileName:   kind + ".data",
		Capabilities:      Capabilities{Editable: true},
		NormalizeContent:  func(value string) string { return value },
		EmptyContent:      func(noteID string, noteTitle string) string { return "" },
		NormalizeSettings: func(value map[string]any) map[string]any { return value },
		Settings:          settings,
	}
}

func TestRegisterRejectsInvalidSettingsDeclarations(t *testing.T) {
	validEnum := SettingField{Key: "mode", Kind: SettingKindEnum, Label: "模式", Default: "a", Options: []SettingOption{{Value: "a", Label: "A"}}}
	cases := []struct {
		name     string
		settings []SettingField
		want     string
	}{
		{"枚举默认值不在选项中", []SettingField{{Key: "mode", Kind: SettingKindEnum, Label: "模式", Default: "b", Options: []SettingOption{{Value: "a", Label: "A"}}}}, "不在选项中"},
		{"枚举缺少选项", []SettingField{{Key: "mode", Kind: SettingKindEnum, Label: "模式", Default: "a"}}, "缺少选项"},
		{"设置键重复", []SettingField{validEnum, validEnum}, "键重复"},
		{"设置项缺少名称", []SettingField{{Key: "mode", Kind: SettingKindEnum, Default: "a", Options: []SettingOption{{Value: "a", Label: "A"}}}}, "缺少名称"},
		{"数值默认值超出范围", []SettingField{{Key: "scale", Kind: SettingKindNumber, Label: "缩放", Default: 3.0, Min: 0.25, Max: 2, Step: 0.01}}, "超出范围"},
		{"数值范围无效", []SettingField{{Key: "scale", Kind: SettingKindNumber, Label: "缩放", Default: 1, Min: 2, Max: 2, Step: 0.01}}, "取值范围无效"},
		{"数值步长非法", []SettingField{{Key: "scale", Kind: SettingKindNumber, Label: "缩放", Default: 1, Min: 0, Max: 2, Step: 0}}, "步长无效"},
		{"未知设置形态", []SettingField{{Key: "mode", Kind: "toggle", Label: "开关", Default: true}}, "形态非法"},
	}
	for index, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kind := fmt.Sprintf("test-invalid-%d", index)
			err := Register(testSettingsPlugin(kind, tc.settings))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func TestRegisterAcceptsValidSettingsDeclaration(t *testing.T) {
	plugin := testSettingsPlugin("test-valid", []SettingField{
		{Key: "mode", Kind: SettingKindEnum, Label: "模式", Default: "a", Options: []SettingOption{{Value: "a", Label: "A", Description: "选项 A"}}},
		{Key: "scale", Kind: SettingKindNumber, Label: "缩放", GlobalLabel: "全局缩放", Format: "percent", Default: 0.95, Min: 0.25, Max: 2, Step: 0.01},
	})
	if err := Register(plugin); err != nil {
		t.Fatalf("register valid plugin failed: %v", err)
	}
	registered, ok := Get("test-valid")
	if !ok {
		t.Fatal("valid plugin not registered")
	}

	declaration := DeclarationOf(registered)
	raw, err := json.Marshal(declaration)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	settings := payload["settings"].([]any)
	if len(settings) != 2 {
		t.Fatalf("declaration settings = %s", raw)
	}
	enumField := settings[0].(map[string]any)
	if enumField["kind"] != SettingKindEnum || enumField["default"] != "a" {
		t.Fatalf("enum declaration = %#v", enumField)
	}
	if _, ok := enumField["options"].([]any); !ok {
		t.Fatalf("enum declaration missing options: %#v", enumField)
	}
	if _, ok := enumField["min"]; ok {
		t.Fatalf("enum declaration must not contain min: %#v", enumField)
	}
	numberField := settings[1].(map[string]any)
	if numberField["kind"] != SettingKindNumber || numberField["default"] != 0.95 || numberField["min"] != 0.25 || numberField["max"] != float64(2) || numberField["step"] != 0.01 {
		t.Fatalf("number declaration = %#v", numberField)
	}
	if _, ok := numberField["options"]; ok {
		t.Fatalf("number declaration must not contain options: %#v", numberField)
	}
}

func TestDeclarationOfEmptySettingsSerializesAsArray(t *testing.T) {
	declaration := DeclarationOf(testSettingsPlugin("test-empty", nil))
	raw, err := json.Marshal(declaration)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	settings, ok := payload["settings"].([]any)
	if !ok || len(settings) != 0 {
		t.Fatalf("settings = %#v, want empty array", payload["settings"])
	}
}
