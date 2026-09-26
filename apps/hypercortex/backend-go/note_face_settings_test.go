package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Q33/Q34/Q35：笔记级面设置以补丁语义写入笔记包：null 删除字段、其余字段合并保留。
func TestSaveNoteFaceSettingsPatchSemantics(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":    "face-settings-note-1",
		"title": "设置补丁",
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>hi</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save html face failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir
	// 初始设置经统一设置通道写入，随后以补丁语义逐步调整。
	if _, err := svc.saveNoteFaceSettings(testRepoID(t, svc), packageDir, "html", mustJSONRaw(t, map[string]any{"fixedScale": 0.8, "displayMode": "fit-window"})); err != nil {
		t.Fatalf("save face settings failed: %v", err)
	}
	manifest, err := svc.loadNoteManifest(testRepoID(t, svc), packageDir)
	if err != nil {
		t.Fatal(err)
	}
	htmlFace := manifest.Faces["html"]
	if got := asFloat(htmlFace.Settings["fixedScale"]); got != 0.8 {
		t.Fatalf("fixedScale = %v, want 0.8", got)
	}
	if got := asString(htmlFace.Settings["displayMode"]); got != "fit-window" {
		t.Fatalf("displayMode = %q, want fit-window", got)
	}

	// 只改缩放：显示方式必须保留。
	patched, err := svc.saveNoteFaceSettings(testRepoID(t, svc), packageDir, "html", mustJSONRaw(t, map[string]any{"fixedScale": 0.5}))
	if err != nil {
		t.Fatalf("save face settings failed: %v", err)
	}
	patchedManifest := patched.(map[string]any)["manifest"].(noteManifest)
	patchedFace := patchedManifest.Faces["html"]
	if got := asFloat(patchedFace.Settings["fixedScale"]); got != 0.5 {
		t.Fatalf("patched fixedScale = %v, want 0.5", got)
	}
	if got := asString(patchedFace.Settings["displayMode"]); got != "fit-window" {
		t.Fatalf("displayMode lost by patch: %q", got)
	}

	// null 删除缩放：显示方式仍然保留。
	cleared, err := svc.saveNoteFaceSettings(testRepoID(t, svc), packageDir, "html", mustJSONRaw(t, map[string]any{"fixedScale": nil}))
	if err != nil {
		t.Fatalf("clear fixedScale failed: %v", err)
	}
	clearedFace := cleared.(map[string]any)["manifest"].(noteManifest).Faces["html"]
	if _, ok := clearedFace.Settings["fixedScale"]; ok {
		t.Fatalf("fixedScale not cleared: %#v", clearedFace.Settings)
	}
	if got := asString(clearedFace.Settings["displayMode"]); got != "fit-window" {
		t.Fatalf("displayMode lost by clear: %q", got)
	}

	// 非法显示方式被协议丢弃，合法值可改写。
	invalid, err := svc.saveNoteFaceSettings(testRepoID(t, svc), packageDir, "html", mustJSONRaw(t, map[string]any{"displayMode": "weird"}))
	if err != nil {
		t.Fatalf("save invalid displayMode failed: %v", err)
	}
	invalidFace := invalid.(map[string]any)["manifest"].(noteManifest).Faces["html"]
	if _, ok := invalidFace.Settings["displayMode"]; ok {
		t.Fatalf("invalid displayMode not rejected: %#v", invalidFace.Settings)
	}
	valid, err := svc.saveNoteFaceSettings(testRepoID(t, svc), packageDir, "html", mustJSONRaw(t, map[string]any{"displayMode": "natural"}))
	if err != nil {
		t.Fatalf("save displayMode failed: %v", err)
	}
	validFace := valid.(map[string]any)["manifest"].(noteManifest).Faces["html"]
	if got := asString(validFace.Settings["displayMode"]); got != "natural" {
		t.Fatalf("displayMode = %q, want natural", got)
	}
}

// Q47/Q48：新笔记按 faceKinds 创建默认面，并按清单顺序建立面顺序，面文件同步落盘。
func TestSaveNoteFaceFaceKindsCreatesDefaultFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "face-kinds-note-1",
		"title":     "默认面",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "hello"},
		},
	}))
	if err != nil {
		t.Fatalf("save note with faceKinds failed: %v", err)
	}
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	meta := result.(map[string]any)["meta"].(noteMeta)
	if len(manifest.Faces) != 2 {
		t.Fatalf("faces = %#v", manifest.Faces)
	}
	if got := strings.Join(manifest.FaceOrder, ","); got != "text,html" {
		t.Fatalf("faceOrder = %q, want text,html", got)
	}
	base := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(meta.Dir))
	mustExist(t, filepath.Join(base, "text.md"))
	mustExist(t, filepath.Join(base, "html-view.html"))

	textDoc, err := svc.loadNoteFace(testRepoID(t, svc), meta.Dir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if textDoc.Content != "hello" {
		t.Fatalf("text body = %q", textDoc.Content)
	}
	htmlDoc, err := svc.loadNoteFace(testRepoID(t, svc), meta.Dir, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !htmlDoc.Exists || !strings.Contains(htmlDoc.Content, "hypercortex-note-id") {
		t.Fatalf("html face not initialized: %#v", htmlDoc)
	}

	// 再次保存：面不重复创建，面顺序保持不变。
	second, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "face-kinds-note-1",
		"packageDir": meta.Dir,
		"title":      "默认面",
		"faceKinds":  []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "hello again"},
		},
	}))
	if err != nil {
		t.Fatalf("second save failed: %v", err)
	}
	secondManifest := second.(map[string]any)["manifest"].(noteManifest)
	if len(secondManifest.Faces) != 2 {
		t.Fatalf("faces duplicated: %#v", secondManifest.Faces)
	}
	if got := strings.Join(secondManifest.FaceOrder, ","); got != "text,html" {
		t.Fatalf("faceOrder changed on re-save: %q", got)
	}
}

// Q47/Q48：草稿首次保存时以批量保存通道落盘，按 faceKinds 补齐缺失的默认面。
func TestSaveNoteFaceFaceKindsCreatesMissingFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "face-kinds-html-1",
		"title":     "HTML 默认",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>draft</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save html face with faceKinds failed: %v", err)
	}
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	meta := result.(map[string]any)["meta"].(noteMeta)
	if got := strings.Join(manifest.FaceOrder, ","); got != "text,html" {
		t.Fatalf("faceOrder = %q, want text,html", got)
	}
	base := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(meta.Dir))
	mustExist(t, filepath.Join(base, "text.md"))
	mustExist(t, filepath.Join(base, "html-view.html"))
	faceDoc, err := svc.loadNoteFace(testRepoID(t, svc), meta.Dir, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(faceDoc.Content, "draft") {
		t.Fatalf("html content = %q", faceDoc.Content)
	}
}

// Q28：已有笔记保存时 faceKinds 仅补齐缺失面，不改变笔记级面顺序。
func TestFaceKindsDoNotReorderExistingNote(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "face-order-existing")
	manifest := normalizeManifest(noteManifest{
		ID:        "face-order-existing-note",
		Title:     "顺序保持",
		FaceOrder: []string{"html", "text"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
			"html": {ID: "html", Kind: "html", Title: "HTML", File: "html-view.html"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "text")
	mustWriteFile(t, filepath.Join(noteDir, "html-view.html"), "<div>html</div>")
	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", "face-order-existing"))

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "face-order-existing-note",
		"packageDir": rel,
		"faceKinds":  []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "updated"},
		},
	}))
	if err != nil {
		t.Fatalf("save note face failed: %v", err)
	}
	saved := result.(map[string]any)["manifest"].(noteManifest)
	if got := strings.Join(saved.FaceOrder, ","); got != "html,text" {
		t.Fatalf("existing face order overwritten: %q", got)
	}
}

// Q35：保存 HTML 面内容不会丢弃同一容器内的显示方式设置。
func TestSaveHtmlFaceKeepsDisplayModeSettings(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":    "html-settings-keep-1",
		"title": "保留设置",
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>one</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save html face failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir
	if _, err := svc.saveNoteFaceSettings(testRepoID(t, svc), packageDir, "html", mustJSONRaw(t, map[string]any{"displayMode": "natural"})); err != nil {
		t.Fatalf("save displayMode failed: %v", err)
	}

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "html-settings-keep-1",
		"packageDir": packageDir,
		"title":      "保留设置",
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>two</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save html face content failed: %v", err)
	}
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	if got := asString(manifest.Faces["html"].Settings["displayMode"]); got != "natural" {
		t.Fatalf("displayMode lost on content save: %q", got)
	}
	faceDoc, err := svc.loadNoteFace(testRepoID(t, svc), packageDir, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(faceDoc.Content, "two") {
		t.Fatalf("html content = %q", faceDoc.Content)
	}
}
