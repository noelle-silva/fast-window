package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// createNote：按提交的元数据与 faceKinds 建立笔记包；
// 面文件、manifest、笔记索引与派生索引（搜索/引用）随创建一次落盘。
func TestCreateNoteCreatesPackageWithFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	result, err := svc.dispatch("hypercortex.notes.create", mustJSONRaw(t, map[string]any{
		"scope": testRepoID(t, svc),
		"input": map[string]any{
			"id":          "create-note-1",
			"title":       "创建空笔记",
			"description": "简介",
			"tags":        []string{"a", "b", "a"},
			"createdAtMs": float64(1700000000000),
			"faceKinds":   []string{"markdown", "html"},
		},
	}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	resultMap := result.(map[string]any)
	if _, ok := resultMap["doc"]; ok {
		t.Fatalf("create result must not carry legacy doc: %#v", resultMap)
	}
	meta := resultMap["meta"].(noteMeta)
	manifest := resultMap["manifest"].(noteManifest)

	if meta.ID != "create-note-1" || meta.Title != "创建空笔记" || meta.Description != "简介" || meta.Dir == "" {
		t.Fatalf("meta = %#v", meta)
	}
	if meta.CreatedAtMs != 1700000000000 || meta.UpdatedAtMs <= 0 {
		t.Fatalf("meta times = %#v", meta)
	}
	if got := strings.Join(manifest.Tags, ","); got != "a,b" {
		t.Fatalf("tags = %q, want a,b", got)
	}
	if got := strings.Join(manifest.FaceOrder, ","); got != "text,html" {
		t.Fatalf("faceOrder = %q, want text,html", got)
	}
	if len(manifest.Faces) != 2 {
		t.Fatalf("faces = %#v", manifest.Faces)
	}

	base := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(meta.Dir))
	mustExist(t, filepath.Join(base, manifestFile))
	if got := readFileText(t, filepath.Join(base, "text.md")); got != "" {
		t.Fatalf("text.md = %q, want empty", got)
	}
	htmlRaw := readFileText(t, filepath.Join(base, "html-view.html"))
	if !strings.Contains(htmlRaw, "hypercortex-note-id") || !strings.Contains(htmlRaw, "创建空笔记") {
		t.Fatalf("html-view.html = %q", htmlRaw)
	}

	textDoc, err := svc.loadNoteFace(testRepoID(t, svc), meta.Dir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if !textDoc.Exists || textDoc.Content != "" {
		t.Fatalf("text face doc = %#v", textDoc)
	}
	htmlDoc, err := svc.loadNoteFace(testRepoID(t, svc), meta.Dir, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !htmlDoc.Exists || !strings.Contains(htmlDoc.Content, "hypercortex-note-id") {
		t.Fatalf("html face doc = %#v", htmlDoc)
	}

	onDisk, err := svc.loadNoteManifest(testRepoID(t, svc), meta.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if onDisk.ID != "create-note-1" || strings.Join(onDisk.FaceOrder, ",") != "text,html" {
		t.Fatalf("manifest on disk = %#v", onDisk)
	}

	idx, err := svc.loadNoteIndex(testRepoID(t, svc))
	if err != nil {
		t.Fatal(err)
	}
	if idx.Notes["create-note-1"].Dir != meta.Dir {
		t.Fatalf("note index = %#v", idx.Notes["create-note-1"])
	}

	// 派生索引已刷新：标题可被搜索命中；空内容笔记不产生引用条目。
	hits, err := svc.queryNoteSearch(testRepoID(t, svc), "创建空笔记", nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, hit := range hits.Items {
		if hit.NoteID == "create-note-1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("search hits = %#v", hits.Items)
	}
	refs, err := svc.loadRefIndex(testRepoID(t, svc))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := refs["create-note-1"]; ok {
		t.Fatalf("refs for empty note = %#v", refs["create-note-1"])
	}
}

// createNote：未提交 id 时自动生成；faceKinds 为空但有标题时允许创建无面笔记。
func TestCreateNoteWithoutIdOrFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	result, err := svc.createNote(testRepoID(t, svc), mustJSONRaw(t, map[string]any{"title": "仅标题"}))
	if err != nil {
		t.Fatalf("create note without faces failed: %v", err)
	}
	meta := result.(map[string]any)["meta"].(noteMeta)
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	if meta.ID == "" || meta.Title != "仅标题" || meta.Dir == "" {
		t.Fatalf("meta = %#v", meta)
	}
	if len(manifest.Faces) != 0 || len(manifest.FaceOrder) != 0 {
		t.Fatalf("manifest faces = %#v, faceOrder = %#v", manifest.Faces, manifest.FaceOrder)
	}
	mustExist(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(meta.Dir), manifestFile))
}

// createNote：无标题且无面时快速失败，不产生任何笔记包。
func TestCreateNoteRejectsUntitledNoteWithoutFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	_, err := svc.createNote(testRepoID(t, svc), mustJSONRaw(t, map[string]any{"id": "create-note-untitled"}))
	if err == nil || !strings.Contains(err.Error(), "至少需要一个标题") {
		t.Fatalf("err = %v, want 标题校验错误", err)
	}
	desiredDir, err := notePackageDirForID("create-note-untitled")
	if err != nil {
		t.Fatal(err)
	}
	mustNotExist(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(desiredDir)))
}

// createNote：目标笔记已存在时快速失败，不覆盖既有笔记的标题与面。
func TestCreateNoteRejectsExistingPackage(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	first, err := svc.createNote(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "create-note-dup",
		"title":     "原始标题",
		"faceKinds": []string{"markdown"},
	}))
	if err != nil {
		t.Fatalf("first create failed: %v", err)
	}
	meta := first.(map[string]any)["meta"].(noteMeta)

	_, err = svc.createNote(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "create-note-dup",
		"title":     "重复创建",
		"faceKinds": []string{"markdown", "html"},
	}))
	if err == nil || !strings.Contains(err.Error(), "笔记已存在") {
		t.Fatalf("err = %v, want 笔记已存在", err)
	}

	onDisk, err := svc.loadNoteManifest(testRepoID(t, svc), meta.Dir)
	if err != nil {
		t.Fatal(err)
	}
	if onDisk.Title != "原始标题" || len(onDisk.Faces) != 1 {
		t.Fatalf("existing note overwritten: %#v", onDisk)
	}
}
