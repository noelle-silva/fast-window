package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// P0-4：提交目录内已有其他笔记时，归属不匹配必须快速失败，且不得改名或覆盖该目录。
func TestSaveNoteFacesRejectsMismatchedPackageOwner(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	created, err := svc.createNote(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "guard-owner-a",
		"title":     "A",
		"faceKinds": []string{"markdown"},
	}))
	if err != nil {
		t.Fatalf("create note A failed: %v", err)
	}
	dirA := created.(map[string]any)["meta"].(noteMeta).Dir

	_, err = svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "guard-owner-b",
		"packageDir": dirA,
		"title":      "B",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "stolen"},
		},
	}))
	if err == nil || !strings.Contains(err.Error(), "归属不匹配") {
		t.Fatalf("expected ownership rejection, got %v", err)
	}
	manifest, err := svc.loadNoteManifest(testRepoID(t, svc), dirA)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ID != "guard-owner-a" || manifest.Title != "A" {
		t.Fatalf("note A mutated: %#v", manifest)
	}
}

// 归属一致的目录改名（历史目录名 → 规范目录名）仍应正常工作。
func TestSaveNoteFacesAllowsOwnerMatchedRename(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "legacy-dir-name")
	manifest := normalizeManifest(noteManifest{
		ID:        "legacy-rename-id",
		Title:     "历史命名",
		FaceOrder: []string{"text"},
		Faces: map[string]noteFaceManifest{
			"text": {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "old")
	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", "legacy-dir-name"))

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "legacy-rename-id",
		"packageDir": rel,
		"title":      "历史命名",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "new"},
		},
	}))
	if err != nil {
		t.Fatalf("owner-matched rename save failed: %v", err)
	}
	savedDir := result.(map[string]any)["meta"].(noteMeta).Dir
	if filepath.ToSlash(savedDir) == rel {
		t.Fatalf("expected package renamed to canonical dir, got %s", savedDir)
	}
	faceDoc, err := svc.loadNoteFace(testRepoID(t, svc), savedDir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if faceDoc.Content != "new" {
		t.Fatalf("renamed note content = %q", faceDoc.Content)
	}
}

// P0-4：已存在的面不允许在保存时被静默改变类型。
func TestSaveNoteFacesRejectsFaceKindChange(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "guard-kind-1",
		"title":     "类型守卫",
		"faceKinds": []string{"markdown", "html"},
	}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir

	_, err = svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "guard-kind-1",
		"packageDir": packageDir,
		"title":      "类型守卫",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "html", "content": "<div>hijack</div>"},
		},
	}))
	if err == nil || !strings.Contains(err.Error(), "类型不匹配") {
		t.Fatalf("expected kind mismatch rejection, got %v", err)
	}
}

// P0-4：同一笔记内两个面不得共用同一落盘文件名。
func TestSaveNoteFacesRejectsDuplicateFaceFiles(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "guard-file-1",
		"title":     "文件重名",
		"faceKinds": []string{"markdown"},
	}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir

	_, err = svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "guard-file-1",
		"packageDir": packageDir,
		"title":      "文件重名",
		"faces": []map[string]any{
			{"faceId": "text2", "kind": "markdown", "content": "dup"},
		},
	}))
	if err == nil || !strings.Contains(err.Error(), "重名") {
		t.Fatalf("expected duplicate file rejection, got %v", err)
	}
}

// P0-4：清单损坏时拒绝保存，损坏文件保持原样。
func TestSaveNoteFacesRejectsCorruptManifest(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), notesDir, "2026-09", "guard-corrupt")
	mustWriteFile(t, filepath.Join(noteDir, manifestFile), "{not-json")
	rel := filepath.ToSlash(filepath.Join(notesDir, "2026-09", "guard-corrupt"))

	_, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "guard-corrupt-id",
		"packageDir": rel,
		"title":      "损坏",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "x"},
		},
	}))
	if err == nil || !strings.Contains(err.Error(), "读取笔记清单失败") {
		t.Fatalf("expected corrupt manifest rejection, got %v", err)
	}
	if got := readFileText(t, filepath.Join(noteDir, manifestFile)); got != "{not-json" {
		t.Fatalf("corrupt manifest overwritten: %q", got)
	}
}

// P0-5：面内容写入中途失败时整体回滚，已写面恢复为事务前的旧内容。
func TestSaveNoteFacesRollsBackOnWriteFailure(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	rel, err := notePackageDirForID("guard-rollback-id")
	if err != nil {
		t.Fatal(err)
	}
	noteDir := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(rel))
	manifest := normalizeManifest(noteManifest{
		ID:        "guard-rollback-id",
		Title:     "回滚",
		FaceOrder: []string{"text", "blocked"},
		Faces: map[string]noteFaceManifest{
			"text":    {ID: "text", Kind: "markdown", Title: "文本", File: "text.md"},
			"blocked": {ID: "blocked", Kind: "html", Title: "阻塞", File: "blocked/blocked.html"},
		},
	})
	if err := writeJSONFile(filepath.Join(noteDir, manifestFile), manifest); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), "old")
	// 用同名文件占住目录位置，使第二个面的写入必然失败。
	mustWriteFile(t, filepath.Join(noteDir, "blocked"), "placeholder")

	_, err = svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "guard-rollback-id",
		"packageDir": rel,
		"title":      "回滚",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "new"},
			{"faceId": "blocked", "kind": "html", "content": "<div>new</div>"},
		},
	}))
	if err == nil {
		t.Fatal("expected face write failure")
	}
	if got := readFileText(t, filepath.Join(noteDir, "text.md")); got != "old" {
		t.Fatalf("text.md not rolled back: %q", got)
	}
	onDisk, err := svc.loadNoteManifest(testRepoID(t, svc), rel)
	if err != nil {
		t.Fatal(err)
	}
	if onDisk.UpdatedAtMs != manifest.UpdatedAtMs {
		t.Fatalf("manifest unexpectedly updated: onDisk=%v before=%v", onDisk.UpdatedAtMs, manifest.UpdatedAtMs)
	}
}
