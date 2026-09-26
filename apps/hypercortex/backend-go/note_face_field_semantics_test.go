package main

import "testing"

// P3：字段保留语义——缺失或类型非法的提交不应清空既有值，显式空串才清空。
func TestSaveNoteFacesPreservesFieldsOnMissingOrInvalidInput(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":          "field-keep-1",
		"title":       "字段保留",
		"description": "原简介",
		"resources":   []map[string]any{{"assetId": "asset-a", "ext": "png"}},
		"faceKinds":   []string{"markdown"},
	}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir

	// 缺失 description 与 resources：保留旧值。
	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "field-keep-1",
		"packageDir": packageDir,
		"title":      "字段保留",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "y"},
		},
	}))
	if err != nil {
		t.Fatalf("save without fields failed: %v", err)
	}
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	if manifest.Description != "原简介" {
		t.Fatalf("description not preserved: %q", manifest.Description)
	}
	if len(manifest.Resources) != 1 || manifest.Resources[0].AssetID != "asset-a" {
		t.Fatalf("resources not preserved: %#v", manifest.Resources)
	}

	// 非法类型 resources：保留旧值。
	result, err = svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "field-keep-1",
		"packageDir": packageDir,
		"title":      "字段保留",
		"resources":  "not-a-list",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "z"},
		},
	}))
	if err != nil {
		t.Fatalf("save with invalid resources failed: %v", err)
	}
	manifest = result.(map[string]any)["manifest"].(noteManifest)
	if len(manifest.Resources) != 1 {
		t.Fatalf("invalid resources should keep old value: %#v", manifest.Resources)
	}

	// 显式空串 description：清空生效。
	result, err = svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":          "field-keep-1",
		"packageDir":  packageDir,
		"title":       "字段保留",
		"description": "",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "w"},
		},
	}))
	if err != nil {
		t.Fatalf("save with empty description failed: %v", err)
	}
	manifest = result.(map[string]any)["manifest"].(noteManifest)
	if manifest.Description != "" {
		t.Fatalf("explicit empty description not applied: %q", manifest.Description)
	}
}
