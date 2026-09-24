package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Q25：无面笔记允许落盘，但至少要有一个标题。
func TestSaveFaceLessNoteRequiresTitle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	result, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":          "faceless-note-1",
		"title":       "只有标题",
		"description": "无面笔记",
	}))
	if err != nil {
		t.Fatalf("save faceless note failed: %v", err)
	}
	meta := result.(map[string]any)["meta"].(noteMeta)
	manifest, err := svc.loadNoteManifest("library", meta.Dir)
	if err != nil {
		t.Fatalf("load manifest failed: %v", err)
	}
	if len(manifest.Faces) != 0 || len(manifest.FaceOrder) != 0 {
		t.Fatalf("faceless manifest = %#v", manifest)
	}
	if manifest.Title != "只有标题" {
		t.Fatalf("faceless title = %q", manifest.Title)
	}
	if _, err := svc.loadNoteFace("library", meta.Dir, "text"); err == nil {
		t.Fatal("faceless note must not expose a text face")
	}

	if _, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":    "faceless-note-2",
		"title": "",
	})); err == nil || !strings.Contains(err.Error(), "标题") {
		t.Fatalf("expected title rejection for faceless note, got %v", err)
	}
}

// Q30：面级时间戳随生命周期推进，面更新与笔记更新同步。
func TestNoteFaceTimestampLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	first, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":    "face-ts-note-1",
		"title": "时间戳",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "hello"},
		},
	}))
	if err != nil {
		t.Fatalf("first save failed: %v", err)
	}
	firstMeta := first.(map[string]any)["meta"].(noteMeta)
	manifest1, err := svc.loadNoteManifest("library", firstMeta.Dir)
	if err != nil {
		t.Fatal(err)
	}
	textFace := manifest1.Faces["text"]
	if textFace.CreatedAtMs <= 0 || textFace.UpdatedAtMs <= 0 {
		t.Fatalf("text face timestamps missing: %#v", textFace)
	}
	if textFace.UpdatedAtMs != manifest1.UpdatedAtMs {
		t.Fatalf("face updated %v != note updated %v", textFace.UpdatedAtMs, manifest1.UpdatedAtMs)
	}

	second, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":         "face-ts-note-1",
		"packageDir": firstMeta.Dir,
		"title":      "时间戳",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "hello again"},
		},
	}))
	if err != nil {
		t.Fatalf("second save failed: %v", err)
	}
	secondMeta := second.(map[string]any)["meta"].(noteMeta)
	manifest2, err := svc.loadNoteManifest("library", secondMeta.Dir)
	if err != nil {
		t.Fatal(err)
	}
	textFace2 := manifest2.Faces["text"]
	if textFace2.CreatedAtMs != textFace.CreatedAtMs {
		t.Fatalf("text face created changed: %v -> %v", textFace.CreatedAtMs, textFace2.CreatedAtMs)
	}
	if textFace2.UpdatedAtMs < textFace.UpdatedAtMs {
		t.Fatalf("text face updated went backwards: %v -> %v", textFace.UpdatedAtMs, textFace2.UpdatedAtMs)
	}

	faceResult, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":         "face-ts-note-1",
		"packageDir": secondMeta.Dir,
		"title":      "时间戳",
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>x</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save html face failed: %v", err)
	}
	manifest3 := faceResult.(map[string]any)["manifest"].(noteManifest)
	htmlFace := manifest3.Faces["html"]
	if htmlFace.CreatedAtMs <= 0 || htmlFace.UpdatedAtMs <= 0 {
		t.Fatalf("html face timestamps missing: %#v", htmlFace)
	}
	if htmlFace.CreatedAtMs != htmlFace.UpdatedAtMs {
		t.Fatalf("new face created != updated: %#v", htmlFace)
	}
	if manifest3.UpdatedAtMs != htmlFace.UpdatedAtMs {
		t.Fatalf("note updated %v != newest face updated %v", manifest3.UpdatedAtMs, htmlFace.UpdatedAtMs)
	}
}

// 永久删除模式：不产生回收站条目，内容文件直接清理。
func TestDeleteNoteFacePermanentModeSkipsTrash(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(svc.libraryDir, notesDir, "2026-09", "delete-face-permanent")
	manifest := normalizeManifest(noteManifest{
		ID:        "delete-face-permanent-note",
		Title:     "永久删除",
		FaceOrder: []string{"text", "html"},
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
	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", "delete-face-permanent"))

	if _, err := svc.deleteNoteFace("library", rel, "html", "permanent"); err != nil {
		t.Fatalf("deleteNoteFace failed: %v", err)
	}
	if _, err := svc.loadNoteFace("library", rel, "html"); err == nil {
		t.Fatal("html face still exists after permanent delete")
	}
	items, err := svc.listTrash("library")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("permanent delete produced trash items: %#v", items)
	}
}

// Q20：恢复旧版本按快照原样恢复，快照中存在的面会回归（含后来被删的面）。
func TestRestoreNoteVersionResurrectsDeletedFace(t *testing.T) {
	svc := newTestService(t)
	packageDir := createVersionedTestNote(t, svc)

	if _, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":          "20260522010101001",
		"packageDir":  packageDir,
		"title":       "Versioned Note",
		"description": "Original description",
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>[[note_id=html-target]]</div>"},
		},
	})); err != nil {
		t.Fatalf("save html face failed: %v", err)
	}
	version, err := svc.publishNoteVersion("library", packageDir, "With html")
	if err != nil {
		t.Fatalf("publish version failed: %v", err)
	}
	if _, err := svc.deleteNoteFace("library", packageDir, "html", "permanent"); err != nil {
		t.Fatalf("delete html face failed: %v", err)
	}
	without, err := svc.loadNoteManifest("library", packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := without.Faces["html"]; ok {
		t.Fatalf("html face still present after delete: %#v", without.Faces)
	}

	if _, err := svc.restoreNoteVersion("library", packageDir, version.VersionID); err != nil {
		t.Fatalf("restore version failed: %v", err)
	}
	restored, err := svc.loadNoteManifest("library", packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.Faces["html"]; !ok {
		t.Fatalf("deleted face not resurrected by version restore: %#v", restored.Faces)
	}
	faceDoc, err := svc.loadNoteFace("library", packageDir, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !faceDoc.Exists || !strings.Contains(faceDoc.Content, "html-target") {
		t.Fatalf("resurrected face content = %#v", faceDoc)
	}
	refs, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	if got := refs["20260522010101001"]["html"]; len(got) != 1 || got[0].NoteID != "html-target" {
		t.Fatalf("resurrected face refs = %#v", refs)
	}
}

// Q30：时间戳不计入版本内容，仅保存动作不会产生重复版本。
func TestPublishVersionIgnoresTimestampOnlyChanges(t *testing.T) {
	svc := newTestService(t)
	packageDir := createVersionedTestNote(t, svc)
	if _, err := svc.publishNoteVersion("library", packageDir, "First release"); err != nil {
		t.Fatalf("publish version failed: %v", err)
	}

	if _, err := svc.saveNoteFaces("library", mustJSONRaw(t, map[string]any{
		"id":          "20260522010101001",
		"packageDir":  packageDir,
		"title":       "Versioned Note",
		"description": "Original description",
		"tags":        []string{"release"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "# Alpha\n\nfirst body"},
		},
	})); err != nil {
		t.Fatalf("re-save note failed: %v", err)
	}
	if _, err := svc.publishNoteVersion("library", packageDir, "Same content"); err == nil || !strings.Contains(err.Error(), "无需重复发布") {
		t.Fatalf("expected duplicate publish rejection after timestamp-only save, got %v", err)
	}
}

// 面已入回收站但所属笔记被永久删除时，恢复必须失败并说明原因。
func TestRestoreFaceTrashFailsWhenNoteMissing(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(svc.libraryDir, notesDir, "2026-09", "orphan-face-restore")
	manifest := normalizeManifest(noteManifest{
		ID:        "orphan-face-restore-note",
		Title:     "回收站孤儿面",
		FaceOrder: []string{"text", "html"},
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
	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", "orphan-face-restore"))

	if _, err := svc.deleteNoteFace("library", rel, "html", "trash"); err != nil {
		t.Fatalf("deleteNoteFace failed: %v", err)
	}
	if err := svc.permanentlyDeleteNoteDir("library", manifest.ID, rel); err != nil {
		t.Fatalf("permanently delete note failed: %v", err)
	}
	items, err := svc.listTrash("library")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Kind != "face" {
		t.Fatalf("trash items = %#v", items)
	}
	if _, err := svc.restoreTrashItem("library", mustJSONRaw(t, items[0])); err == nil || !strings.Contains(err.Error(), "所属笔记不存在") {
		t.Fatalf("expected missing note rejection, got %v", err)
	}
}
