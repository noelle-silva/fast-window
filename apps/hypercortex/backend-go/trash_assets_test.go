package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestAssetTrashLifecycle(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "asset-trash-lifecycle"
	ext := "txt"
	key := assetKey(assetID, ext)
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", key))
	mustWriteFile(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)), "hello")
	idx := assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{
		key: newAssetMetadata(assetIndexEntry{
			AssetID:     assetID,
			Ext:         ext,
			Path:        relPath,
			Kind:        "document",
			DisplayName: "Trashable attachment",
			Size:        5,
		}),
	}}
	if err := svc.saveAssetIndex("library", idx); err != nil {
		t.Fatalf("save asset index failed: %v", err)
	}

	if _, err := svc.moveAssetToTrash("library", assetID, ext); err != nil {
		t.Fatalf("move asset to trash failed: %v", err)
	}
	mustNotExist(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)))
	idx, err := svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatalf("load asset index failed: %v", err)
	}
	if _, ok := idx.Assets[key]; ok {
		t.Fatalf("asset index still contains %s after move to trash", key)
	}

	items, err := svc.listTrash("library")
	if err != nil {
		t.Fatalf("list trash failed: %v", err)
	}
	if len(items) != 1 || items[0].Kind != "asset" || items[0].ID != key {
		t.Fatalf("unexpected trash items: %+v", items)
	}

	if _, err := svc.restoreTrashItem("library", mustJSONRaw(t, items[0])); err != nil {
		t.Fatalf("restore asset failed: %v", err)
	}
	mustExist(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)))
	idx, err = svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatalf("reload asset index failed: %v", err)
	}
	if got := idx.Assets[key].Path; got != relPath {
		t.Fatalf("restored asset path = %q, want %q", got, relPath)
	}
}

func TestPermanentlyDeleteAssetTrashItem(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}

	assetID := "asset-trash-delete"
	ext := "txt"
	key := assetKey(assetID, ext)
	relPath := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", key))
	mustWriteFile(t, filepath.Join(svc.libraryDir, filepath.FromSlash(relPath)), "bye")
	if err := svc.saveAssetIndex("library", assetIndex{Version: assetIndexVersion, Assets: map[string]assetIndexEntry{
		key: newAssetMetadata(assetIndexEntry{AssetID: assetID, Ext: ext, Path: relPath, Kind: "document", Size: 3}),
	}}); err != nil {
		t.Fatalf("save asset index failed: %v", err)
	}
	if _, err := svc.moveAssetToTrash("library", assetID, ext); err != nil {
		t.Fatalf("move asset to trash failed: %v", err)
	}
	items, err := svc.listTrash("library")
	if err != nil {
		t.Fatalf("list trash failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("trash items = %d, want 1", len(items))
	}
	trashDirPath := filepath.Join(svc.libraryDir, filepath.FromSlash(items[0].Dir))
	mustExist(t, trashDirPath)
	if err := svc.permanentlyDeleteTrashItem("library", mustJSONRaw(t, items[0])); err != nil {
		t.Fatalf("permanently delete asset failed: %v", err)
	}
	mustNotExist(t, trashDirPath)
}

func mustJSONRaw(t *testing.T, value any) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json failed: %v", err)
	}
	return payload
}
