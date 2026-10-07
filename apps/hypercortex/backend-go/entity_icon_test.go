package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// 1x1 PNG：用于验证图片图标的落盘、引用与清理。
const testPngDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

func TestNoteIconLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	created, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "图标笔记"}))
	if err != nil {
		t.Fatalf("create note failed: %v", err)
	}
	meta := created.(map[string]any)["meta"].(noteMeta)
	dir := meta.Dir

	// 图标库种类：清单与索引都携带名称。
	result, err := svc.updateNoteIcon(scope, mustJSONRaw(t, map[string]any{
		"packageDir": dir,
		"icon":       map[string]any{"kind": "library", "name": "Star"},
	}), 0)
	if err != nil {
		t.Fatalf("set library icon failed: %v", err)
	}
	manifest := result.(map[string]any)["manifest"].(noteManifest)
	if manifest.Icon == nil || manifest.Icon.Kind != "library" || manifest.Icon.Name != "Star" {
		t.Fatalf("library icon = %#v", manifest.Icon)
	}
	idx, err := svc.loadNoteIndex(scope)
	if err != nil {
		t.Fatal(err)
	}
	if idx.Notes[meta.ID].Icon == nil || idx.Notes[meta.ID].Icon.Name != "Star" {
		t.Fatalf("index icon = %#v", idx.Notes[meta.ID].Icon)
	}

	// SVG 种类：文本直接进元数据，不落文件。
	svg := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`
	result, err = svc.updateNoteIcon(scope, mustJSONRaw(t, map[string]any{
		"packageDir": dir,
		"icon":       map[string]any{"kind": "svg", "svg": svg},
	}), 0)
	if err != nil {
		t.Fatalf("set svg icon failed: %v", err)
	}
	manifest = result.(map[string]any)["manifest"].(noteManifest)
	if manifest.Icon == nil || manifest.Icon.Kind != "svg" || manifest.Icon.SVG != svg {
		t.Fatalf("svg icon = %#v", manifest.Icon)
	}

	// 图片种类：文件落在笔记包的 assets/ 子目录，元数据记相对笔记包的引用。
	result, err = svc.updateNoteIcon(scope, mustJSONRaw(t, map[string]any{
		"packageDir": dir,
		"icon":       map[string]any{"kind": "image", "dataUrl": testPngDataURL},
	}), 0)
	if err != nil {
		t.Fatalf("set image icon failed: %v", err)
	}
	manifest = result.(map[string]any)["manifest"].(noteManifest)
	if manifest.Icon == nil || manifest.Icon.Kind != "image" {
		t.Fatalf("image icon = %#v", manifest.Icon)
	}
	if !strings.HasPrefix(manifest.Icon.Path, noteAssetsDir+"/") {
		t.Fatalf("note icon path = %q, want under %s/", manifest.Icon.Path, noteAssetsDir)
	}
	iconAbs := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(dir), filepath.FromSlash(manifest.Icon.Path))
	mustExist(t, iconAbs)

	// 恢复默认：清空图标并随即清理旧图片文件。
	result, err = svc.updateNoteIcon(scope, mustJSONRaw(t, map[string]any{
		"packageDir": dir,
		"icon":       map[string]any{"kind": "default"},
	}), 0)
	if err != nil {
		t.Fatalf("reset note icon failed: %v", err)
	}
	manifest = result.(map[string]any)["manifest"].(noteManifest)
	if manifest.Icon != nil {
		t.Fatalf("icon should be cleared, got %#v", manifest.Icon)
	}
	mustNotExist(t, iconAbs)
}

func TestFolderIconLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	created, err := svc.createFavoriteFolder(scope, "", "图标夹", "")
	if err != nil {
		t.Fatalf("create folder failed: %v", err)
	}
	folderID := created.(map[string]any)["folderId"].(string)

	result, err := svc.updateFolderIcon(scope, mustJSONRaw(t, map[string]any{
		"folderId": folderID,
		"icon":     map[string]any{"kind": "image", "dataUrl": testPngDataURL},
	}))
	if err != nil {
		t.Fatalf("set folder icon failed: %v", err)
	}
	folder := result.(map[string]any)["folder"].(favoriteFolder)
	if folder.Icon == nil || folder.Icon.Kind != "image" {
		t.Fatalf("folder icon = %#v", folder.Icon)
	}
	iconAbs := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(folder.Icon.Path))
	mustExist(t, iconAbs)
	if !strings.HasPrefix(folder.Icon.Path, iconsDir+"/") {
		t.Fatalf("folder icon path = %q, want under %s/", folder.Icon.Path, iconsDir)
	}

	// 读取图片返回 data URL。
	dataURL, err := svc.readEntityIconImage(scope, mustJSONRaw(t, map[string]any{
		"targetKind": "folder",
		"path":       folder.Icon.Path,
	}))
	if err != nil {
		t.Fatalf("read folder icon image failed: %v", err)
	}
	if !strings.HasPrefix(dataURL, "data:image/png;base64,") {
		t.Fatalf("read icon data url = %q", dataURL)
	}

	// 恢复默认清理文件。
	if _, err := svc.updateFolderIcon(scope, mustJSONRaw(t, map[string]any{
		"folderId": folderID,
		"icon":     map[string]any{"kind": "default"},
	})); err != nil {
		t.Fatalf("reset folder icon failed: %v", err)
	}
	mustNotExist(t, iconAbs)
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Folders[folderID].Icon != nil {
		t.Fatalf("folder icon should be cleared: %#v", doc.Folders[folderID].Icon)
	}
}

func TestAssetIconLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	assetID := "asset-icon-lifecycle"
	ext := "txt"
	key := assetKey(assetID, ext)
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", key))
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(relPath)), "hello")
	if err := svc.saveAssetIndex(scope, assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{
		key: newAssetMetadata(assetIndexEntry{AssetID: assetID, Ext: ext, Path: relPath, Kind: "document", Size: 5}),
	}}); err != nil {
		t.Fatal(err)
	}

	result, err := svc.updateAssetIcon(scope, mustJSONRaw(t, map[string]any{
		"assetId": assetID,
		"ext":     ext,
		"icon":    map[string]any{"kind": "image", "dataUrl": testPngDataURL},
	}))
	if err != nil {
		t.Fatalf("set asset icon failed: %v", err)
	}
	item := result.(map[string]any)["asset"].(assetPoolItem)
	if item.Icon == nil || item.Icon.Kind != "image" {
		t.Fatalf("asset icon = %#v", item.Icon)
	}
	iconAbs := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(item.Icon.Path))
	mustExist(t, iconAbs)

	// 恢复默认清理文件。
	if _, err := svc.updateAssetIcon(scope, mustJSONRaw(t, map[string]any{
		"assetId": assetID,
		"ext":     ext,
		"icon":    map[string]any{"kind": "default"},
	})); err != nil {
		t.Fatalf("reset asset icon failed: %v", err)
	}
	mustNotExist(t, iconAbs)
	idx, err := svc.ensureAssetIndex(scope)
	if err != nil {
		t.Fatal(err)
	}
	if idx.Assets[key].Icon != nil {
		t.Fatalf("asset icon should be cleared: %#v", idx.Assets[key].Icon)
	}
}

// 笔记图片图标在回收站列表里可读：图标在笔记包内随包进站，展示路径指向回收站包目录。
func TestNoteIconFollowsTrash(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	created, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": "带图标笔记"}))
	if err != nil {
		t.Fatal(err)
	}
	meta := created.(map[string]any)["meta"].(noteMeta)
	if _, err := svc.updateNoteIcon(scope, mustJSONRaw(t, map[string]any{
		"packageDir": meta.Dir,
		"icon":       map[string]any{"kind": "image", "dataUrl": testPngDataURL},
	}), 0); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.moveNoteToTrash(scope, mustJSONRaw(t, meta), nil); err != nil {
		t.Fatalf("move note to trash failed: %v", err)
	}
	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatal(err)
	}
	var noteItem trashItem
	for _, item := range items {
		if item.Kind == "note" && item.ID == meta.ID {
			noteItem = item
		}
	}
	if noteItem.ID == "" {
		t.Fatalf("note trash item not found: %+v", items)
	}
	if noteItem.Icon == nil || noteItem.Icon.Kind != "image" {
		t.Fatalf("note trash icon = %#v", noteItem.Icon)
	}
	mustExist(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(noteItem.Icon.Path)))
	if _, err := svc.readEntityIconImage(scope, mustJSONRaw(t, map[string]any{"targetKind": "asset", "path": noteItem.Icon.Path})); err != nil {
		t.Fatalf("read note trash icon failed: %v", err)
	}
}

// 收藏夹图片图标随回收站条目进出：进站移入条目目录，恢复移回 Icons/。
func TestFolderIconFollowsTrash(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	created, err := svc.createFavoriteFolder(scope, "", "带图标夹", "")
	if err != nil {
		t.Fatal(err)
	}
	folderID := created.(map[string]any)["folderId"].(string)
	if _, err := svc.updateFolderIcon(scope, mustJSONRaw(t, map[string]any{
		"folderId": folderID,
		"icon":     map[string]any{"kind": "image", "dataUrl": testPngDataURL},
	})); err != nil {
		t.Fatal(err)
	}
	doc, _, err := svc.tryLoadFavorites(scope)
	if err != nil {
		t.Fatal(err)
	}
	iconPath := doc.Folders[folderID].Icon.Path
	iconAbs := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(iconPath))

	snapshot := trashFolderMeta{Folder: doc.Folders[folderID], Refs: doc.RefsByFolderID[folderID]}
	if _, err := svc.moveFolderToTrash(scope, mustJSONRaw(t, snapshot)); err != nil {
		t.Fatalf("move folder to trash failed: %v", err)
	}
	mustNotExist(t, iconAbs)

	// 模拟界面侧「删除引用与本体」：移除收藏夹本体与页面条目清单。
	delete(doc.Folders, folderID)
	delete(doc.RefsByFolderID, folderID)
	if _, err := svc.saveFavoritesDoc(scope, doc); err != nil {
		t.Fatal(err)
	}

	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatal(err)
	}
	var folderItem trashItem
	for _, item := range items {
		if item.Kind == "folder" && item.ID == folderID {
			folderItem = item
		}
	}
	if folderItem.ID == "" {
		t.Fatalf("folder trash item not found: %+v", items)
	}
	// 回收站列表的展示图标指向条目目录里的图标文件，可直接读取渲染。
	if folderItem.Icon == nil || folderItem.Icon.Kind != "image" {
		t.Fatalf("folder trash icon = %#v", folderItem.Icon)
	}
	mustExist(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(folderItem.Icon.Path)))
	if _, err := svc.readEntityIconImage(scope, mustJSONRaw(t, map[string]any{"targetKind": "asset", "path": folderItem.Icon.Path})); err != nil {
		t.Fatalf("read folder trash icon failed: %v", err)
	}

	if _, err := svc.restoreTrashItem(scope, mustJSONRaw(t, folderItem)); err != nil {
		t.Fatalf("restore folder failed: %v", err)
	}
	mustExist(t, iconAbs)
}

// 附件图片图标随回收站条目进出：进站移入条目目录，恢复移回 Icons/。
func TestAssetIconFollowsTrash(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatal(err)
	}
	scope := testRepoID(t, svc)

	assetID := "asset-icon-trash"
	ext := "txt"
	key := assetKey(assetID, ext)
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", key))
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(relPath)), "hello")
	if err := svc.saveAssetIndex(scope, assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{
		key: newAssetMetadata(assetIndexEntry{AssetID: assetID, Ext: ext, Path: relPath, Kind: "document", Size: 5}),
	}}); err != nil {
		t.Fatal(err)
	}
	result, err := svc.updateAssetIcon(scope, mustJSONRaw(t, map[string]any{
		"assetId": assetID,
		"ext":     ext,
		"icon":    map[string]any{"kind": "image", "dataUrl": testPngDataURL},
	}))
	if err != nil {
		t.Fatal(err)
	}
	iconPath := result.(map[string]any)["asset"].(assetPoolItem).Icon.Path
	iconAbs := filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(iconPath))

	if _, err := svc.moveAssetToTrash(scope, assetID, ext, nil); err != nil {
		t.Fatalf("move asset to trash failed: %v", err)
	}
	mustNotExist(t, iconAbs)

	items, err := svc.listTrash(scope)
	if err != nil {
		t.Fatal(err)
	}
	var assetItem trashItem
	for _, item := range items {
		if item.Kind == "asset" && item.ID == key {
			assetItem = item
		}
	}
	if assetItem.ID == "" {
		t.Fatalf("asset trash item not found: %+v", items)
	}
	// 回收站列表的展示图标指向条目目录里的图标文件，可直接读取渲染。
	if assetItem.Icon == nil || assetItem.Icon.Kind != "image" {
		t.Fatalf("asset trash icon = %#v", assetItem.Icon)
	}
	mustExist(t, filepath.Join(testRepoRoot(t, svc), filepath.FromSlash(assetItem.Icon.Path)))
	if _, err := svc.restoreTrashItem(scope, mustJSONRaw(t, assetItem)); err != nil {
		t.Fatalf("restore asset failed: %v", err)
	}
	mustExist(t, iconAbs)
}
