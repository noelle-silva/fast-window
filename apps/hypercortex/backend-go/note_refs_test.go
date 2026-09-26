package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"fast-window-hypercortex-backend/faceplugin"
)

func TestExtractPlaceholderRefsParsesFaceParam(t *testing.T) {
	content := "\r\n[[note_id=target-a]]\r\n[[note_id=target-b|face=html|title=Other|remarks=note]]\r\n[[face=text|note_id=target-c]]\r\n[[note_id=target-a|face=html]]\r\n[[note_id=]]\r\n[[note_id=target-c|face=text|title=dup]]\r\n"
	refs := faceplugin.ExtractPlaceholderRefs(content)
	want := []noteRef{
		{NoteID: "target-a"},
		{NoteID: "target-b", FaceID: "html"},
		{NoteID: "target-c", FaceID: "text"},
		{NoteID: "target-a", FaceID: "html"},
	}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 锁死重复键后写胜出语义：与前端 parseNotePlaceholderBody 行为一致
func TestExtractPlaceholderRefsDuplicateKeysLastWriteWins(t *testing.T) {
	content := "[[note_id=first|note_id=second|face=html|face=text]]\n[[note_id=old-target|note_id=new-target|face=old-face|face=new-face]]\n[[note_id=a|note_id=]]\n[[note_id=a|face=html|face=]]\n"
	refs := faceplugin.ExtractPlaceholderRefs(content)
	want := []noteRef{
		{NoteID: "second", FaceID: "text"},
		{NoteID: "new-target", FaceID: "new-face"},
		{NoteID: "a"},
	}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

func TestExtractPlaceholderRefsInHtmlLikeContent(t *testing.T) {
	refs := faceplugin.ExtractPlaceholderRefs(`<div>[[note_id=target-a|face=html]]</div><p>plain</p>`)
	want := []noteRef{{NoteID: "target-a", FaceID: "html"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 锁死前后端单行占位符语义：占位符内容出现换行不算有效引用
func TestExtractPlaceholderRefsSkipsMultilinePlaceholders(t *testing.T) {
	content := "[[note_id=in-line]]\n[[note_id=break1\n|face=html]]\n[[note_id=\nbreak2]]\n[[note_id=crlf\r\n|face=text]]\n[[note_id=still-valid]]"
	refs := faceplugin.ExtractPlaceholderRefs(content)
	want := []noteRef{{NoteID: "in-line"}, {NoteID: "still-valid"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

// 锁死前后端单行占位符语义：占位符内容出现单个 ] 视为无效占位符，不提取、不索引
func TestExtractPlaceholderRefsSkipsInnerBracketPlaceholders(t *testing.T) {
	content := "[[note_id=a]b]]\n[[note_id=skipped|face=html]x]]\n[[note_id=valid]]\n[[note_id=also-valid|face=text]]"
	refs := faceplugin.ExtractPlaceholderRefs(content)
	want := []noteRef{{NoteID: "valid"}, {NoteID: "also-valid", FaceID: "text"}}
	if !reflect.DeepEqual(refs, want) {
		t.Fatalf("refs = %#v, want %#v", refs, want)
	}
}

func TestDeleteNoteFaceCleansFaceRefs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(svc.libraryDir, notesDir, "2026-09", "delete-face-refs")
	manifest := normalizeManifest(noteManifest{
		ID:        "delete-face-refs-note",
		Title:     "Referer",
		FaceOrder: []string{"text", "html"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
			"html": {ID: "html", Kind: "html", Title: "HTML", File: "html-view.html"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "[[note_id=target-a]]")
	mustWriteFile(t, filepath.Join(noteDir, "html-view.html"), "[[note_id=target-b|face=text]]")

	if _, err := svc.refreshDerivedIndexesForNote("library", filepath.ToSlash(filepath.Join(notesDir, "2026-09", "delete-face-refs")), manifest); err != nil {
		t.Fatal(err)
	}

	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", "delete-face-refs"))
	result, err := svc.deleteNoteFace("library", rel, "html", "trash")
	if err != nil {
		t.Fatalf("deleteNoteFace failed: %v", err)
	}
	next := result.(map[string]any)["manifest"].(noteManifest)
	if next.Faces["text"].ID != "text" || len(next.FaceOrder) != 1 {
		t.Fatalf("manifest after delete = %#v", next)
	}
	idx, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	want := noteRefIndex{
		"delete-face-refs-note": {
			"text": {{NoteID: "target-a"}},
		},
	}
	if !reflect.DeepEqual(idx, want) {
		t.Fatalf("refs = %#v, want %#v", idx, want)
	}

	// Q21：删除的面进入回收站，可恢复回原笔记
	items, err := svc.listTrash("library")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Kind != "face" || items[0].FaceID != "html" || items[0].NoteID != "delete-face-refs-note" {
		t.Fatalf("trash items = %#v", items)
	}
	if _, err := svc.restoreTrashItem("library", mustJSONRaw(t, items[0])); err != nil {
		t.Fatalf("restore face failed: %v", err)
	}
	restored, err := svc.loadNoteManifest("library", rel)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.Faces["html"]; !ok || len(restored.FaceOrder) != 2 || restored.FaceOrder[1] != "html" {
		t.Fatalf("manifest after restore = %#v", restored)
	}
	faceDoc, err := svc.loadNoteFace("library", rel, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !faceDoc.Exists || !strings.Contains(faceDoc.Content, "target-b") {
		t.Fatalf("restored face content = %#v", faceDoc)
	}
	afterRestore, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	wantAfterRestore := noteRefIndex{
		"delete-face-refs-note": {
			"text": {{NoteID: "target-a"}},
			"html": {{NoteID: "target-b", FaceID: "text"}},
		},
	}
	if !reflect.DeepEqual(afterRestore, wantAfterRestore) {
		t.Fatalf("refs after restore = %#v, want %#v", afterRestore, wantAfterRestore)
	}
}

func TestRefsIndexRoundTripPersistsJSONStructure(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	idx := noteRefIndex{
		"note-a": {
			"text": {{NoteID: "note-b"}, {NoteID: "note-c", FaceID: "html"}},
		},
	}
	if err := svc.saveRefIndex("library", idx); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(svc.libraryDir, refsIndexFile))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(raw); got != "{\n  \"note-a\": {\n    \"text\": [\n      {\n        \"noteId\": \"note-b\"\n      },\n      {\n        \"noteId\": \"note-c\",\n        \"faceId\": \"html\"\n      }\n    ]\n  }\n}\n" {
		t.Fatalf("refs json = %s", got)
	}
	loaded, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loaded, idx) {
		t.Fatalf("round trip mismatch: %#v", loaded)
	}
}

func TestMigrationNoteFaceRefsV2RebuildsAndIsIdempotent(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(svc.libraryDir, notesDir, "2026-09", "refs-note-1")
	manifest := normalizeManifest(noteManifest{
		ID:        "refs-note-1",
		Title:     "Referer",
		FaceOrder: []string{"text", "html"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
			"html": {ID: "html", Kind: "html", Title: "HTML", File: "html-view.html"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "[[note_id=target-a|face=html]]\n\n[[note_id=target-a]]")
	mustWriteFile(t, filepath.Join(noteDir, "html-view.html"), "<div>[[note_id=target-b|face=text]]</div>")
	mustWriteFile(t, filepath.Join(svc.libraryDir, refsIndexFile), `{"refs-note-1":["stale-a"]}`)

	if err := svc.migrateNoteFaceRefsV2(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	idx, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	want := noteRefIndex{
		"refs-note-1": {
			"text": {{NoteID: "target-a", FaceID: "html"}, {NoteID: "target-a"}},
			"html": {{NoteID: "target-b", FaceID: "text"}},
		},
	}
	if !reflect.DeepEqual(idx, want) {
		t.Fatalf("refs = %#v, want %#v", idx, want)
	}

	refsPath := filepath.Join(svc.libraryDir, refsIndexFile)
	before, err := os.ReadFile(refsPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.migrateNoteFaceRefsV2(); err != nil {
		t.Fatalf("second migration failed: %v", err)
	}
	after, err := os.ReadFile(refsPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("migration not idempotent:\nbefore: %s\nafter: %s", before, after)
	}
}

func TestRefsMigrationSkipsUnknownFaceKinds(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(svc.libraryDir, notesDir, "2026-09", "refs-note-2")
	manifest := normalizeManifest(noteManifest{
		ID:        "refs-note-2",
		Title:     "Unknown Face",
		FaceOrder: []string{"secret"},
		Faces: map[string]noteFaceManifest{
			"secret": {ID: "secret", Kind: "old-panel", Title: "旧面板", File: "old-panel.data"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "old-panel.data"), "[[note_id=should-not-extract]]")
	if err := svc.migrateNoteFaceRefsV2(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	idx, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	if len(idx) != 0 {
		t.Fatalf("unknown face content must not be extracted: %#v", idx)
	}
}
