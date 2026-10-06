package main

import (
	"path/filepath"
	"testing"
)

// 笔记进回收站：把它在收藏夹里的所有引用随本体打包进该笔记的回收站元数据，恢复时引用原样放回。
func TestNoteTrashPacksAndRestoresRefs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	created, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "被删笔记"}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	note := created.(map[string]any)["meta"].(noteMeta)

	folderA := createFolderForTest(t, svc, scope, "夹 A")
	folderB := createFolderForTest(t, svc, scope, "夹 B")
	if _, err := svc.addFavoriteItem(scope, folderA, "note", note.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addFavoriteItem(scope, folderB, "note", note.ID); err != nil {
		t.Fatal(err)
	}

	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	refs := append(append([]favoriteItemRef{}, doc.RefsByFolderID[folderA]...), doc.RefsByFolderID[folderB]...)
	if len(refs) != 2 {
		t.Fatalf("refs = %#v", refs)
	}

	if _, err := svc.moveNoteToTrash(scope, mustJSONRaw(t, note), mustJSONRaw(t, refs)); err != nil {
		t.Fatalf("move note to trash failed: %v", err)
	}

	noteItem := findTrashItem(t, svc, scope, "note", note.ID)
	meta := readTrashMetaAt(t, svc, noteItem.Dir)
	if len(meta.Refs) != 2 {
		t.Fatalf("packed refs = %#v", meta.Refs)
	}

	// 模拟界面侧「删除引用与本体」：引用随本体一并移除后保存文档。
	for _, fid := range []string{folderA, folderB} {
		doc.RefsByFolderID[fid] = nil
	}
	if _, err := svc.saveFavoritesDoc(scope, doc); err != nil {
		t.Fatal(err)
	}

	result, err := svc.restoreTrashItem(scope, mustJSONRaw(t, noteItem))
	if err != nil {
		t.Fatalf("restore note failed: %v", err)
	}
	favorites, ok := result.(map[string]any)["favorites"].(favoritesDoc)
	if !ok {
		t.Fatalf("restore missing favorites: %#v", result)
	}
	if got := len(favorites.RefsByFolderID[folderA]); got != 1 {
		t.Fatalf("folder A refs = %d, want 1", got)
	}
	if got := len(favorites.RefsByFolderID[folderB]); got != 1 {
		t.Fatalf("folder B refs = %d, want 1", got)
	}
	if favorites.RefsByFolderID[folderA][0].ID != refs[0].ID {
		t.Fatalf("restored ref id = %q, want %q", favorites.RefsByFolderID[folderA][0].ID, refs[0].ID)
	}
}

// 附件进回收站：把它在收藏夹里的所有引用随本体打包，恢复时引用原样放回。
func TestAssetTrashPacksAndRestoresRefs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	assetID := "asset-ref-pack"
	ext := "txt"
	key := assetKey(assetID, ext)
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", key))
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(relPath)), "hi")
	if err := svc.saveAssetIndex(scope, assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{
		key: newAssetMetadata(assetIndexEntry{AssetID: assetID, Ext: ext, Path: relPath, Kind: "document", Size: 2}),
	}}); err != nil {
		t.Fatalf("save asset index failed: %v", err)
	}

	folderA := createFolderForTest(t, svc, scope, "附件夹")
	if _, err := svc.addFavoriteItem(scope, folderA, "asset", key); err != nil {
		t.Fatal(err)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	refs := doc.RefsByFolderID[folderA]
	if len(refs) != 1 {
		t.Fatalf("refs = %#v", refs)
	}

	if _, err := svc.moveAssetToTrash(scope, assetID, ext, mustJSONRaw(t, refs)); err != nil {
		t.Fatalf("move asset to trash failed: %v", err)
	}
	assetItem := findTrashItem(t, svc, scope, "asset", key)
	if len(readTrashMetaAt(t, svc, assetItem.Dir).Refs) != 1 {
		t.Fatalf("packed asset refs missing")
	}

	doc.RefsByFolderID[folderA] = nil
	if _, err := svc.saveFavoritesDoc(scope, doc); err != nil {
		t.Fatal(err)
	}

	result, err := svc.restoreTrashItem(scope, mustJSONRaw(t, assetItem))
	if err != nil {
		t.Fatalf("restore asset failed: %v", err)
	}
	favorites, ok := result.(map[string]any)["favorites"].(favoritesDoc)
	if !ok {
		t.Fatalf("restore missing favorites: %#v", result)
	}
	if got := len(favorites.RefsByFolderID[folderA]); got != 1 {
		t.Fatalf("restored asset refs = %d, want 1", got)
	}
	if favorites.RefsByFolderID[folderA][0].ID != refs[0].ID {
		t.Fatalf("restored ref id = %q, want %q", favorites.RefsByFolderID[folderA][0].ID, refs[0].ID)
	}
}

func createFolderForTest(t *testing.T, svc *service, scope string, title string) string {
	t.Helper()
	created, err := svc.createFavoriteFolder(scope, "", title, "")
	if err != nil {
		t.Fatalf("create folder %q failed: %v", title, err)
	}
	return created.(map[string]any)["folderId"].(string)
}

func findTrashItem(t *testing.T, svc *service, scope string, kind string, id string) trashItem {
	t.Helper()
	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatalf("list trash failed: %v", err)
	}
	for _, item := range items {
		if item.Kind == kind && item.ID == id {
			return item
		}
	}
	t.Fatalf("trash item %s/%s not found: %+v", kind, id, items)
	return trashItem{}
}

func readTrashMetaAt(t *testing.T, svc *service, dir string) trashMeta {
	t.Helper()
	meta := trashMeta{}
	if err := readJSONFile(filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(dir), trashMetaFile), &meta); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	return meta
}
