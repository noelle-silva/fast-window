package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func readFileText(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s failed: %v", path, err)
	}
	return string(raw)
}

// Q24：一次保存整篇笔记的所有面内容与元数据，面文件、manifest、meta、引用索引一次落盘。
func TestSaveNoteFacesSavesAllFaceContentsInOneCall(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "save-faces-note-1",
		"title":     "批量保存",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "old text"},
		},
	}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir
	time.Sleep(2 * time.Millisecond)

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "save-faces-note-1",
		"packageDir": packageDir,
		"title":      "批量保存（改）",
		"tags":       []string{"a", "b"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "new text [[note_id=other-note]]"},
			{"faceId": "html", "kind": "html", "content": "<div>new html</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save all faces failed: %v", err)
	}
	resultMap := result.(map[string]any)
	manifest := resultMap["manifest"].(noteManifest)
	meta := resultMap["meta"].(noteMeta)
	refs := resultMap["refs"].(map[string][]noteRef)

	textDoc, err := svc.loadNoteFace(testRepoID(t, svc), packageDir, "text")
	if err != nil {
		t.Fatal(err)
	}
	if textDoc.Content != "new text [[note_id=other-note]]" {
		t.Fatalf("text content = %q", textDoc.Content)
	}
	htmlDoc, err := svc.loadNoteFace(testRepoID(t, svc), packageDir, "html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(htmlDoc.Content, "new html") {
		t.Fatalf("html content = %q", htmlDoc.Content)
	}
	if meta.Title != "批量保存（改）" || meta.UpdatedAtMs <= 0 {
		t.Fatalf("meta = %#v", meta)
	}
	if got := strings.Join(manifest.Tags, ","); got != "a,b" {
		t.Fatalf("tags = %q, want a,b", got)
	}

	base := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(packageDir))
	if got := readFileText(t, filepath.Join(base, "text.md")); got != "new text [[note_id=other-note]]" {
		t.Fatalf("text file = %q", got)
	}
	if got := readFileText(t, filepath.Join(base, "html-view.html")); !strings.Contains(got, "new html") {
		t.Fatalf("html file = %q", got)
	}

	// 两个提交面的时间戳都刷新为本次保存时间。
	for _, faceID := range []string{"text", "html"} {
		face := manifest.Faces[faceID]
		if face.UpdatedAtMs < meta.UpdatedAtMs {
			t.Fatalf("face %s updatedAtMs = %v, meta = %v", faceID, face.UpdatedAtMs, meta.UpdatedAtMs)
		}
	}

	// 引用索引随同一次保存刷新。
	if len(refs["text"]) != 1 || refs["text"][0].NoteID != "other-note" {
		t.Fatalf("refs = %#v", refs)
	}
	onDisk, err := svc.loadNoteManifest(testRepoID(t, svc), packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(onDisk.Tags, ","); got != "a,b" {
		t.Fatalf("manifest on disk tags = %q", got)
	}

	// 搜索索引同触发点刷新：文本面新内容可被搜到。
	hits, err := svc.queryNoteSearch(testRepoID(t, svc), "new text", nil)
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	found := false
	for _, hit := range hits.Items {
		if hit.NoteID == "save-faces-note-1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("search hits = %#v", hits.Items)
	}
}

// Q24：批量保存只写提交的面，未提交的面内容与时间戳保持原样。
func TestSaveNoteFacesKeepsUnsubmittedFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	first, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "save-faces-keep-1",
		"title":     "保留未提交面",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "html", "kind": "html", "content": "<div>keep</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save html face failed: %v", err)
	}
	packageDir := first.(map[string]any)["meta"].(noteMeta).Dir
	htmlBefore := first.(map[string]any)["manifest"].(noteManifest).Faces["html"]
	time.Sleep(2 * time.Millisecond)

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":         "save-faces-keep-1",
		"packageDir": packageDir,
		"title":      "保留未提交面",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "only text"},
		},
	}))
	if err != nil {
		t.Fatalf("save all faces failed: %v", err)
	}
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	htmlAfter := manifest.Faces["html"]
	if htmlAfter.UpdatedAtMs != htmlBefore.UpdatedAtMs {
		t.Fatalf("unsubmitted html updatedAtMs changed: before=%v after=%v", htmlBefore.UpdatedAtMs, htmlAfter.UpdatedAtMs)
	}
	base := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(packageDir))
	if got := readFileText(t, filepath.Join(base, "html-view.html")); !strings.Contains(got, "keep") {
		t.Fatalf("unsubmitted html content changed: %q", got)
	}
}

// Q24：草稿首次批量保存一次性生成目录、全部提交面与笔记索引。
func TestSaveNoteFacesCreatesNoteWithAllFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	result, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "save-faces-draft-1",
		"title":     "草稿落盘",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "draft text"},
			{"faceId": "html", "kind": "html", "content": "<div>draft html</div>"},
		},
	}))
	if err != nil {
		t.Fatalf("save all faces failed: %v", err)
	}
	meta := result.(map[string]any)["meta"].(noteMeta)
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	if meta.Dir == "" {
		t.Fatalf("meta dir empty: %#v", meta)
	}
	if got := strings.Join(manifest.FaceOrder, ","); got != "text,html" {
		t.Fatalf("faceOrder = %q, want text,html", got)
	}
	base := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(meta.Dir))
	mustExist(t, filepath.Join(base, manifestFile))
	if got := readFileText(t, filepath.Join(base, "text.md")); got != "draft text" {
		t.Fatalf("text file = %q", got)
	}
	if got := readFileText(t, filepath.Join(base, "html-view.html")); !strings.Contains(got, "draft html") {
		t.Fatalf("html file = %q", got)
	}
	idx, err := svc.loadNoteIndex(testRepoID(t, svc))
	if err != nil {
		t.Fatal(err)
	}
	if idx.Notes["save-faces-draft-1"].Dir != meta.Dir {
		t.Fatalf("note index dir = %q", idx.Notes["save-faces-draft-1"].Dir)
	}
}

// Q24：提交未知面类型时快速失败，不产生任何磁盘副作用。
func TestSaveNoteFacesRejectsUnknownFaceKindWithoutSideEffects(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}

	_, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "save-faces-invalid-1",
		"title":     "非法面",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "weird", "kind": "weird", "content": "x"},
		},
	}))
	if err == nil {
		t.Fatal("expected error for unknown face kind")
	}
	desiredDir, err := notePackageDirForID("save-faces-invalid-1")
	if err != nil {
		t.Fatal(err)
	}
	mustNotExist(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(desiredDir)))
}

// Q35：笔记级面顺序保存后参与优先级解析；非法与重复项被剔除，未列出的面补齐不丢失。
func TestSaveNoteFaceOrderNormalizesAndKeepsAllFaces(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":        "save-face-order-1",
		"title":     "面顺序",
		"faceKinds": []string{"markdown", "html"},
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": ""},
		},
	}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir

	saved, err := svc.saveNoteFaceOrder(testRepoID(t, svc), packageDir, []string{"html", "text", "html", "ghost"})
	if err != nil {
		t.Fatalf("save face order failed: %v", err)
	}
	manifest := saved.(map[string]any)["manifest"].(noteManifest)
	if got := strings.Join(manifest.FaceOrder, ","); got != "html,text" {
		t.Fatalf("faceOrder = %q, want html,text", got)
	}
	meta := saved.(map[string]any)["meta"].(noteMeta)
	if meta.UpdatedAtMs <= 0 {
		t.Fatalf("meta not updated: %#v", meta)
	}

	// 未列出的面自动补齐，不因排序丢失。
	again, err := svc.saveNoteFaceOrder(testRepoID(t, svc), packageDir, []string{"html"})
	if err != nil {
		t.Fatalf("save partial order failed: %v", err)
	}
	againOrder := again.(map[string]any)["manifest"].(noteManifest).FaceOrder
	if got := strings.Join(againOrder, ","); got != "html,text" {
		t.Fatalf("partial order = %q, want html,text", got)
	}
	onDisk, err := svc.loadNoteManifest(testRepoID(t, svc), packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(onDisk.FaceOrder, ","); got != "html,text" {
		t.Fatalf("manifest on disk faceOrder = %q", got)
	}
}
