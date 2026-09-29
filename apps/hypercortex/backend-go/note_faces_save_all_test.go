package main

import (
	"fmt"
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
	}), 0)
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
	}), 0)
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
	hits, err := svc.queryNoteSearch(noteSearchQuery{Scope: testRepoID(t, svc), Query: "new text"})
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
	}), 0)
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
	}), 0)
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
	}), 0)
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
	}), 0)
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
	}), 0)
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir

	saved, err := svc.saveNoteFaceOrder(testRepoID(t, svc), packageDir, []string{"html", "text", "html", "ghost"}, 0)
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
	again, err := svc.saveNoteFaceOrder(testRepoID(t, svc), packageDir, []string{"html"}, 0)
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

// 全量覆盖写的防覆盖保险丝：与 patch 共用同一版本语义——期望版本不一致时拒绝写入并回报当前版本，
// 一致时写入成功且结果携带新版本，可闭环用于下一次写入。
func TestSaveNoteFacesExpectedVersionGuard(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":    "fuse-save-note-1",
		"title": "全量保险丝",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "原始正文"},
		},
	}), 0)
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir
	version := created.(map[string]any)["meta"].(noteMeta).UpdatedAtMs

	saveInput := func() map[string]any {
		return map[string]any{
			"id":         "fuse-save-note-1",
			"packageDir": packageDir,
			"title":      "全量保险丝（改）",
			"faces": []map[string]any{
				{"faceId": "text", "kind": "markdown", "content": "被拒绝的正文"},
			},
		}
	}

	// 期望版本不一致：拒绝写入，内容与版本保持不变，错误回报当前版本。
	_, err = svc.saveNoteFaces(scope, mustJSONRaw(t, saveInput()), version+1000)
	if err == nil {
		t.Fatal("mismatching expectedVersion must be rejected")
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%.0f", version)) {
		t.Fatalf("rejection must report current version %.0f: %v", version, err)
	}
	manifest, err := svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Title != "全量保险丝" || manifest.UpdatedAtMs != version {
		t.Fatalf("rejected save must not write: title = %q, version = %.0f", manifest.Title, manifest.UpdatedAtMs)
	}

	// 期望版本一致：写入成功，结果携带写入后的新版本。
	result, err := svc.saveNoteFaces(scope, mustJSONRaw(t, saveInput()), version)
	if err != nil {
		t.Fatalf("matching expectedVersion must be accepted: %v", err)
	}
	nextVersion, ok := result.(map[string]any)["version"].(float64)
	if !ok {
		t.Fatalf("save result must carry new version: %#v", result)
	}
	manifest, err = svc.loadNoteManifest(scope, packageDir)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.UpdatedAtMs != nextVersion || manifest.Title != "全量保险丝（改）" {
		t.Fatalf("saved manifest = %#v", manifest)
	}

	// 闭环：用返回的新版本继续修改被接受。
	if _, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":         "fuse-save-note-1",
		"packageDir": packageDir,
		"title":      "全量保险丝（再改）",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "第二次正文"},
		},
	}), nextVersion); err != nil {
		t.Fatalf("closed-loop save with returned version failed: %v", err)
	}

	// 目标笔记不存在而声明了期望版本：快速失败。
	if _, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":         "fuse-save-missing",
		"packageDir": "Notes/2099-01/fuse-save-missing",
		"title":      "不存在",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "x"},
		},
	}), version); err == nil {
		t.Fatal("expectedVersion for a missing note must be rejected")
	}
}

// RPC 入口必须把 saveFaces 的 expectedVersion 参数交给防覆盖保险丝，且不传该参数时保持原有语义。
func TestSaveFacesDispatchHonorsExpectedVersion(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":    "fuse-rpc-note-1",
		"title": "RPC 全量保险丝",
		"faces": []map[string]any{
			{"faceId": "text", "kind": "markdown", "content": "RPC 原始正文"},
		},
	}), 0)
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	packageDir := created.(map[string]any)["meta"].(noteMeta).Dir
	version := created.(map[string]any)["meta"].(noteMeta).UpdatedAtMs

	// 期望版本不一致：RPC 调用被拒绝。
	if _, err := svc.dispatch("hypercortex.notes.saveFaces", mustJSONRaw(t, map[string]any{
		"scope":           scope,
		"expectedVersion": version + 1000,
		"input": map[string]any{
			"id":         "fuse-rpc-note-1",
			"packageDir": packageDir,
			"title":      "被拒绝",
			"faces": []map[string]any{
				{"faceId": "text", "kind": "markdown", "content": "被拒绝的正文"},
			},
		},
	})); err == nil {
		t.Fatal("dispatch must reject mismatching expectedVersion")
	}

	// 期望版本一致：写入成功，结果携带新版本。
	result, err := svc.dispatch("hypercortex.notes.saveFaces", mustJSONRaw(t, map[string]any{
		"scope":           scope,
		"expectedVersion": version,
		"input": map[string]any{
			"id":         "fuse-rpc-note-1",
			"packageDir": packageDir,
			"title":      "RPC 已改",
			"faces": []map[string]any{
				{"faceId": "text", "kind": "markdown", "content": "RPC 新正文"},
			},
		},
	}))
	if err != nil {
		t.Fatalf("dispatch with matching expectedVersion failed: %v", err)
	}
	if _, ok := result.(map[string]any)["version"].(float64); !ok {
		t.Fatalf("dispatch result must carry new version: %#v", result)
	}

	// 不提供 expectedVersion：保险丝关闭，写入照常成功。
	if _, err := svc.dispatch("hypercortex.notes.saveFaces", mustJSONRaw(t, map[string]any{
		"scope": scope,
		"input": map[string]any{
			"id":         "fuse-rpc-note-1",
			"packageDir": packageDir,
			"title":      "RPC 再改",
			"faces": []map[string]any{
				{"faceId": "text", "kind": "markdown", "content": "RPC 再改正文"},
			},
		},
	})); err != nil {
		t.Fatalf("saveFaces without expectedVersion must keep working: %v", err)
	}
}
