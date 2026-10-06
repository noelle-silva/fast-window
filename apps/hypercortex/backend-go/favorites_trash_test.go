package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// 收藏夹回收站全生命周期：快照进站、与其它条目同列、恢复时把收藏夹信息、页面条目清单
// 与别处指向它的引用一并原样放回；删除期间这些引用随本体移除并打包。
func TestFolderTrashLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	createdA, err := svc.createFavoriteFolder(scope, "", "资料夹", "写点说明")
	if err != nil {
		t.Fatalf("create folder A failed: %v", err)
	}
	folderA := createdA.(map[string]any)["folderId"].(string)
	createdNote, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "收藏的笔记"}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	noteID := createdNote.(map[string]any)["meta"].(noteMeta).ID
	if _, err := svc.addFavoriteItem(scope, folderA, "note", noteID); err != nil {
		t.Fatalf("add note into A failed: %v", err)
	}
	createdB, err := svc.createFavoriteFolder(scope, "", "目标夹 B", "")
	if err != nil {
		t.Fatalf("create folder B failed: %v", err)
	}
	folderB := createdB.(map[string]any)["folderId"].(string)
	if _, err := svc.addFavoriteItem(scope, folderB, "folder", folderA); err != nil {
		t.Fatalf("add folder ref into B failed: %v", err)
	}

	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := trashFolderMeta{Folder: doc.Folders[folderA], Refs: doc.RefsByFolderID[folderA]}
	for _, ref := range doc.RefsByFolderID[folderB] {
		if ref.Kind == "folder" && ref.TargetID == folderA {
			snapshot.InboundRefs = append(snapshot.InboundRefs, ref)
		}
	}
	if len(snapshot.InboundRefs) != 1 {
		t.Fatalf("inbound refs = %#v", snapshot.InboundRefs)
	}
	if _, err := svc.moveFolderToTrash(scope, mustJSONRaw(t, snapshot)); err != nil {
		t.Fatalf("move folder to trash failed: %v", err)
	}

	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatalf("list trash failed: %v", err)
	}
	if len(items) != 1 || items[0].Kind != "folder" || items[0].ID != folderA || items[0].Title != "资料夹" {
		t.Fatalf("unexpected trash items: %+v", items)
	}

	// 模拟界面侧「删除引用与本体」：移除收藏夹本体、页面条目清单，以及别处指向它的引用。
	delete(doc.Folders, folderA)
	delete(doc.RefsByFolderID, folderA)
	keptB := []favoriteItemRef{}
	for _, ref := range doc.RefsByFolderID[folderB] {
		if ref.Kind == "folder" && ref.TargetID == folderA {
			continue
		}
		keptB = append(keptB, ref)
	}
	doc.RefsByFolderID[folderB] = keptB
	if _, err := svc.saveFavoritesDoc(scope, doc); err != nil {
		t.Fatal(err)
	}
	afterDelete, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := afterDelete.Folders[folderA]; ok {
		t.Fatalf("folder A should be gone after delete")
	}
	for _, ref := range afterDelete.RefsByFolderID[folderB] {
		if ref.Kind == "folder" && ref.TargetID == folderA {
			t.Fatalf("ref from B to A should be removed with the entity: %+v", afterDelete.RefsByFolderID[folderB])
		}
	}

	result, err := svc.restoreTrashItem(scope, mustJSONRaw(t, items[0]))
	if err != nil {
		t.Fatalf("restore folder failed: %v", err)
	}
	payload, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("restore payload = %#v", result)
	}
	restored, ok := payload["favorites"].(favoritesDoc)
	if !ok {
		t.Fatalf("restore payload missing favorites: %#v", result)
	}
	folder := restored.Folders[folderA]
	if folder.Title != "资料夹" || folder.Description != "写点说明" {
		t.Fatalf("restored folder = %#v", folder)
	}
	refs := restored.RefsByFolderID[folderA]
	if len(refs) != 1 || refs[0].Kind != "note" || refs[0].TargetID != noteID || refs[0].ID != snapshot.Refs[0].ID {
		t.Fatalf("restored refs = %#v", refs)
	}
	revived := false
	for _, ref := range restored.RefsByFolderID[folderB] {
		if ref.Kind == "folder" && ref.TargetID == folderA {
			revived = true
		}
	}
	if !revived {
		t.Fatalf("ref from B to A should revive after restore: %+v", restored.RefsByFolderID[folderB])
	}

	trashDirPath := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(items[0].Dir))
	mustNotExist(t, trashDirPath)
	remaining, err := svc.listTrash(scope)
	if err != nil {
		t.Fatalf("list trash after restore failed: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("trash should be empty after restore: %+v", remaining)
	}
}

// 收藏夹进回收站：根收藏夹与空标识快速失败。
func TestFolderTrashRejectsRootAndBlank(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	rootSnapshot := trashFolderMeta{Folder: favoriteFolder{ID: "root", Title: "根目录"}}
	if _, err := svc.moveFolderToTrash(scope, mustJSONRaw(t, rootSnapshot)); err == nil || !strings.Contains(err.Error(), "根收藏夹不能删除") {
		t.Fatalf("root err = %v", err)
	}
	if _, err := svc.moveFolderToTrash(scope, mustJSONRaw(t, trashFolderMeta{})); err == nil || !strings.Contains(err.Error(), "标识为空") {
		t.Fatalf("blank err = %v", err)
	}
}

// 收藏夹回收站条目可永久删除，目录随删除清理。
func TestPermanentlyDeleteFolderTrashItem(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	snapshot := trashFolderMeta{Folder: favoriteFolder{ID: "folder-x", Title: "待清空"}}
	if _, err := svc.moveFolderToTrash(scope, mustJSONRaw(t, snapshot)); err != nil {
		t.Fatalf("move folder to trash failed: %v", err)
	}
	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatalf("list trash failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("trash items = %d, want 1", len(items))
	}
	trashDirPath := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(items[0].Dir))
	mustExist(t, trashDirPath)
	if err := svc.permanentlyDeleteTrashItem(scope, mustJSONRaw(t, items[0])); err != nil {
		t.Fatalf("permanently delete folder failed: %v", err)
	}
	mustNotExist(t, trashDirPath)
}

// 收藏夹回收站条目随自动清理一并移除。
func TestFolderTrashAutoCleanup(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	snapshot := trashFolderMeta{Folder: favoriteFolder{ID: "folder-old", Title: "过期夹"}}
	if _, err := svc.moveFolderToTrash(scope, mustJSONRaw(t, snapshot)); err != nil {
		t.Fatalf("move folder to trash failed: %v", err)
	}
	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatalf("list trash failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("trash items = %d, want 1", len(items))
	}
	trashDirPath, err := svc.resolvePath(scope, items[0].Dir)
	if err != nil {
		t.Fatal(err)
	}
	meta := trashMeta{}
	if err := readJSONFile(filepath.Join(trashDirPath, trashMetaFile), &meta); err != nil {
		t.Fatal(err)
	}
	meta.DeletedAtMs = 1
	if err := writeJSONFile(filepath.Join(trashDirPath, trashMetaFile), meta); err != nil {
		t.Fatal(err)
	}

	result, err := svc.maybeAutoCleanupTrash(scope, 1)
	if err != nil {
		t.Fatalf("auto cleanup failed: %v", err)
	}
	if deleted := result.(map[string]int)["deletedCount"]; deleted != 1 {
		t.Fatalf("deletedCount = %d, want 1", deleted)
	}
	mustNotExist(t, trashDirPath)
}
