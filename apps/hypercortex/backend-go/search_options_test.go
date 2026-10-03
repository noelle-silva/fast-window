package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

// TestSearchCatalogExportsFieldsFacesAndAssetKinds 校验搜索目录出口：
// 笔记/附件的匹配维度、可搜面类型、附件类型全部由后端给出，前端无需保留镜像。
func TestSearchCatalogExportsFieldsFacesAndAssetKinds(t *testing.T) {
	catalog := buildSearchCatalog()

	wantNoteFields := []searchFieldOption{
		{Key: "title", Label: "标题"},
		{Key: "description", Label: "简介"},
		{Key: "tags", Label: "标签"},
		{Key: "content", Label: "正文"},
	}
	if !reflect.DeepEqual(catalog.NoteFields, wantNoteFields) {
		t.Fatalf("noteFields = %#v, want %#v", catalog.NoteFields, wantNoteFields)
	}

	wantAssetFields := []searchFieldOption{
		{Key: "name", Label: "名称"},
		{Key: "remark", Label: "备注"},
		{Key: "tags", Label: "标签"},
	}
	if !reflect.DeepEqual(catalog.AssetFields, wantAssetFields) {
		t.Fatalf("assetFields = %#v, want %#v", catalog.AssetFields, wantAssetFields)
	}

	// 可搜面类型只含声明了搜索文本实现的面（测试装配下仅 markdown）。
	wantFaces := []noteSearchFaceKindInfo{{Kind: "markdown", Label: "文本"}}
	if !reflect.DeepEqual(catalog.NoteFaceKinds, wantFaces) {
		t.Fatalf("noteFaceKinds = %#v, want %#v", catalog.NoteFaceKinds, wantFaces)
	}

	// 附件类型从文件类型目录派生：图片 / 音频 / 视频 / 文档。
	wantKinds := []searchKindOption{
		{Kind: "image", Label: "图片"},
		{Kind: "audio", Label: "音频"},
		{Kind: "video", Label: "视频"},
		{Kind: "document", Label: "文档"},
	}
	if !reflect.DeepEqual(catalog.AssetKinds, wantKinds) {
		t.Fatalf("assetKinds = %#v, want %#v", catalog.AssetKinds, wantKinds)
	}
}

func TestSearchOptionsDispatch(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	out, err := svc.dispatch("hypercortex.search.options", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("dispatch search.options failed: %v", err)
	}
	catalog, ok := out.(searchCatalog)
	if !ok {
		t.Fatalf("search.options result type = %T", out)
	}
	if len(catalog.NoteFields) != 4 || len(catalog.AssetFields) != 3 || len(catalog.AssetKinds) == 0 {
		t.Fatalf("catalog = %#v", catalog)
	}
}
