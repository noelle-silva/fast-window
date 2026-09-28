package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureFavoritesNormalizesDirtyDocumentAndWritesBack(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), favoritesFile), `{
  "version": 1,
  "rootFolderId": "legacy-root",
  "folders": {
    "root": { "id": "wrong-root", "title": "", "description": 42 },
    "custom": { "title": "Custom" }
  },
  "refsByFolderId": {
    "root": [
      null,
      {},
      { "id": "", "folderId": "wrong", "kind": "note", "targetId": "n-1", "layout": { "x": -2, "y": 3.7, "w": 0, "h": -1 }, "createdAtMs": 1, "updatedAtMs": 2 },
      { "kind": "note", "targetId": "n-1" },
      { "kind": "unknown", "targetId": "x" },
      { "kind": "asset", "targetId": "asset-1.png" }
    ],
    "missing-folder": [
      { "kind": "folder", "targetId": "custom" }
    ]
  }
}`)

	result, err := svc.ensureFavorites(testRepoID(t, svc))
	if err != nil {
		t.Fatalf("ensureFavorites failed: %v", err)
	}
	doc, ok := result.(favoritesDoc)
	if !ok {
		t.Fatalf("ensureFavorites result = %T, want favoritesDoc", result)
	}
	assertNormalizedDirtyFavorites(t, doc)

	var saved favoritesDoc
	if err := readJSONFile(filepath.Join(testRepoRoot(t, svc), favoritesFile), &saved); err != nil {
		t.Fatalf("read saved favorites failed: %v", err)
	}
	assertNormalizedDirtyFavorites(t, saved)
}

func TestSaveFavoritesNormalizesPayloadBeforeWriting(t *testing.T) {
	svc := newTestService(t)
	raw := json.RawMessage(`{
  "version": 1,
  "folders": { "root": { "title": "Root" } },
  "refsByFolderId": { "root": [null, { "kind": "note", "targetId": "n-1" }, { "kind": "note", "targetId": "n-1" }] }
}`)

	if _, err := svc.saveFavorites(testRepoID(t, svc), raw, 0); err != nil {
		t.Fatalf("saveFavorites failed: %v", err)
	}

	var saved favoritesDoc
	if err := readJSONFile(filepath.Join(testRepoRoot(t, svc), favoritesFile), &saved); err != nil {
		t.Fatalf("read saved favorites failed: %v", err)
	}
	if saved.Version != 1 || saved.RootFolderID != "root" || saved.Folders["root"].ID != "root" {
		t.Fatalf("saved root = %#v", saved)
	}
	refs := saved.RefsByFolderID["root"]
	if len(refs) != 1 {
		t.Fatalf("root refs count = %d, want 1: %#v", len(refs), refs)
	}
	if refs[0].Kind != "note" || refs[0].TargetID != "n-1" || refs[0].FolderID != "root" {
		t.Fatalf("saved ref = %#v", refs[0])
	}
}

func TestEnsureFavoritesRecreatesUnsupportedDocumentVersion(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), favoritesFile), `{"version":2,"folders":{"future":{"title":"Future"}},"refsByFolderId":{"future":[{"kind":"note","targetId":"n-future"}]}}`)

	result, err := svc.ensureFavorites(testRepoID(t, svc))
	if err != nil {
		t.Fatalf("ensureFavorites failed: %v", err)
	}
	doc, ok := result.(favoritesDoc)
	if !ok {
		t.Fatalf("ensureFavorites result = %T, want favoritesDoc", result)
	}
	if doc.Version != 1 || doc.RootFolderID != "root" || len(doc.Folders) != 1 || len(doc.RefsByFolderID["root"]) != 0 {
		t.Fatalf("fresh doc = %#v", doc)
	}
}

func assertNormalizedDirtyFavorites(t *testing.T, doc favoritesDoc) {
	t.Helper()
	if doc.Version != 1 || doc.RootFolderID != "root" {
		t.Fatalf("doc identity = version %d root %q", doc.Version, doc.RootFolderID)
	}
	root, ok := doc.Folders["root"]
	if !ok || root.ID != "root" || root.Title != "根目录" {
		t.Fatalf("root folder = %#v", root)
	}
	if _, ok := doc.Folders["missing-folder"]; !ok {
		t.Fatalf("missing-folder placeholder not created: %#v", doc.Folders)
	}

	rootRefs := doc.RefsByFolderID["root"]
	if len(rootRefs) != 2 {
		t.Fatalf("root refs count = %d, want 2: %#v", len(rootRefs), rootRefs)
	}
	noteRef := rootRefs[0]
	if noteRef.ID != "ref_root__note__n-1" || noteRef.FolderID != "root" || noteRef.Kind != "note" || noteRef.TargetID != "n-1" {
		t.Fatalf("note ref = %#v", noteRef)
	}
	if noteRef.Layout.X != 0 || noteRef.Layout.Y != 3 || noteRef.Layout.W != 1 || noteRef.Layout.H != 1 {
		t.Fatalf("note layout = %#v", noteRef.Layout)
	}
	assetRef := rootRefs[1]
	if assetRef.FolderID != "root" || assetRef.Kind != "asset" || assetRef.TargetID != "asset-1.png" {
		t.Fatalf("asset ref = %#v", assetRef)
	}

	missingRefs := doc.RefsByFolderID["missing-folder"]
	if len(missingRefs) != 1 || missingRefs[0].Kind != "folder" || missingRefs[0].TargetID != "custom" {
		t.Fatalf("missing-folder refs = %#v", missingRefs)
	}
}

// 收藏夹文档的防覆盖保险丝：版本不一致时拒绝写入并回报当前版本；
// 一致时写入成功并返回新版本，可闭环用于下一次写入；缺省时保持原有语义。
func TestSaveFavoritesExpectedVersionGuard(t *testing.T) {
	svc := newTestService(t)
	scope := testRepoID(t, svc)

	created, err := svc.saveFavorites(scope, json.RawMessage(`{"version":1,"folders":{"root":{"title":"根目录"}},"refsByFolderId":{"root":[]}}`), 0)
	if err != nil {
		t.Fatalf("create favorites failed: %v", err)
	}
	version := created.(map[string]any)["version"].(float64)
	if version <= 0 {
		t.Fatalf("created version = %v", version)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if doc.UpdatedAtMs != version {
		t.Fatalf("stored version %.0f != created version %.0f", doc.UpdatedAtMs, version)
	}

	// 期望版本不一致：拒绝写入，内容与版本保持不变，错误回报当前版本。
	_, err = svc.saveFavorites(scope, json.RawMessage(`{"version":1,"folders":{"root":{"title":"被拒绝"},"extra":{"title":"新夹"}},"refsByFolderId":{"root":[],"extra":[]}}`), version+1000)
	if err == nil {
		t.Fatal("mismatching expectedVersion must be rejected")
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%.0f", version)) {
		t.Fatalf("rejection must report current version %.0f: %v", version, err)
	}
	afterReject, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if afterReject.UpdatedAtMs != version || afterReject.Folders["root"].Title != "根目录" {
		t.Fatalf("rejected save must not write: %#v", afterReject)
	}

	// 期望版本一致：写入成功并返回新版本。
	updated, err := svc.saveFavorites(scope, json.RawMessage(`{"version":1,"folders":{"root":{"title":"已改名"},"extra":{"title":"新夹"}},"refsByFolderId":{"root":[],"extra":[]}}`), version)
	if err != nil {
		t.Fatalf("matching expectedVersion must be accepted: %v", err)
	}
	nextVersion := updated.(map[string]any)["version"].(float64)
	stored, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if stored.UpdatedAtMs != nextVersion || stored.Folders["root"].Title != "已改名" {
		t.Fatalf("saved doc = %#v", stored)
	}

	// 闭环：用返回的新版本继续修改被接受；不带期望版本的保存保持原有语义。
	if _, err := svc.saveFavorites(scope, json.RawMessage(`{"version":1,"folders":{"root":{"title":"闭环"},"extra":{"title":"新夹"}},"refsByFolderId":{"root":[],"extra":[]}}`), nextVersion); err != nil {
		t.Fatalf("closed-loop save failed: %v", err)
	}
	if _, err := svc.saveFavorites(scope, json.RawMessage(`{"version":1,"folders":{"root":{"title":"直写"},"extra":{"title":"新夹"}},"refsByFolderId":{"root":[],"extra":[]}}`), 0); err != nil {
		t.Fatalf("save without expectedVersion must keep working: %v", err)
	}
}

// 目标收藏夹不存在而声明了期望版本：快速失败且不落盘。
func TestSaveFavoritesExpectedVersionForMissingDocRejected(t *testing.T) {
	svc := newTestService(t)
	scope := testRepoID(t, svc)
	favoritesPath := filepath.Join(testRepoRoot(t, svc), favoritesFile)
	mustNotExist(t, favoritesPath)

	if _, err := svc.saveFavorites(scope, json.RawMessage(`{"version":1,"folders":{"root":{"title":"根目录"}},"refsByFolderId":{"root":[]}}`), 123); err == nil {
		t.Fatal("expectedVersion for a missing favorites doc must be rejected")
	}
	mustNotExist(t, favoritesPath)
}

// RPC 入口必须把 favorites.save 的 expectedVersion 交给防覆盖保险丝，且缺省时保持原有语义。
func TestSaveFavoritesDispatchHonorsExpectedVersion(t *testing.T) {
	svc := newTestService(t)
	scope := testRepoID(t, svc)

	created, err := svc.dispatch("hypercortex.favorites.save", mustJSONRaw(t, map[string]any{
		"scope": scope,
		"doc": map[string]any{
			"version":        1,
			"folders":        map[string]any{"root": map[string]any{"title": "根目录"}},
			"refsByFolderId": map[string]any{"root": []any{}},
		},
	}))
	if err != nil {
		t.Fatalf("dispatch create failed: %v", err)
	}
	version := created.(map[string]any)["version"].(float64)

	// 期望版本不一致：RPC 调用被拒绝。
	if _, err := svc.dispatch("hypercortex.favorites.save", mustJSONRaw(t, map[string]any{
		"scope":           scope,
		"expectedVersion": version + 1000,
		"doc": map[string]any{
			"version":        1,
			"folders":        map[string]any{"root": map[string]any{"title": "被拒绝"}},
			"refsByFolderId": map[string]any{"root": []any{}},
		},
	})); err == nil {
		t.Fatal("dispatch must reject mismatching expectedVersion")
	}

	// 期望版本一致：写入成功并返回新版本。
	matched, err := svc.dispatch("hypercortex.favorites.save", mustJSONRaw(t, map[string]any{
		"scope":           scope,
		"expectedVersion": version,
		"doc": map[string]any{
			"version":        1,
			"folders":        map[string]any{"root": map[string]any{"title": "RPC 已改"}},
			"refsByFolderId": map[string]any{"root": []any{}},
		},
	}))
	if err != nil {
		t.Fatalf("dispatch with matching expectedVersion failed: %v", err)
	}
	if newVersion, ok := matched.(map[string]any)["version"].(float64); !ok || newVersion <= 0 {
		t.Fatalf("dispatch result must carry new version: %#v", matched)
	}
}
