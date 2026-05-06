package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServiceReadsPluginEraImageDirectories(t *testing.T) {
	dataDir := t.TempDir()
	writeTestFile(t, filepath.Join(dataDir, pluginOutputImagesDir, "old-output.png"), []byte{0x89, 'P', 'N', 'G'})
	writeTestFile(t, filepath.Join(dataDir, pluginReferenceImagesDir, "old-ref.jpg"), []byte{0xff, 0xd8, 0xff})

	svc, err := newService(dataDir, nil)
	if err != nil {
		t.Fatalf("newService failed: %v", err)
	}
	defer svc.dispose()

	outputPaths, err := svc.outputImages.list()
	if err != nil {
		t.Fatalf("output list failed: %v", err)
	}
	if len(outputPaths) != 1 || outputPaths[0] != "old-output.png" {
		t.Fatalf("expected plugin output image, got %#v", outputPaths)
	}

	refPaths, err := svc.referenceImages.list()
	if err != nil {
		t.Fatalf("reference list failed: %v", err)
	}
	if len(refPaths) != 1 || refPaths[0] != "old-ref.jpg" {
		t.Fatalf("expected plugin reference image, got %#v", refPaths)
	}
}

func TestServiceReadsLegacyShardAndPackData(t *testing.T) {
	t.Run("legacy shard", func(t *testing.T) {
		dataDir := t.TempDir()
		store := newJSONStore()
		if err := store.write(filepath.Join(dataDir, filepath.FromSlash(legacyShardDir), "settings.json"), map[string]any{"version": float64(7)}); err != nil {
			t.Fatalf("write legacy shard failed: %v", err)
		}

		svc, err := newService(dataDir, nil)
		if err != nil {
			t.Fatalf("newService failed: %v", err)
		}
		defer svc.dispose()

		value, err := svc.readShard("settings")
		if err != nil {
			t.Fatalf("readShard failed: %v", err)
		}
		got, ok := value.(map[string]any)
		if !ok || got["version"] != float64(7) {
			t.Fatalf("expected legacy shard settings, got %#v", value)
		}
	})

	t.Run("legacy pack", func(t *testing.T) {
		dataDir := t.TempDir()
		store := newJSONStore()
		legacyPack := map[string]any{
			"settings":    map[string]any{"version": float64(3)},
			"taskHistory": []any{map[string]any{"id": "task-old"}},
		}
		if err := store.write(filepath.Join(dataDir, legacyPackFile), legacyPack); err != nil {
			t.Fatalf("write legacy pack failed: %v", err)
		}

		svc, err := newService(dataDir, nil)
		if err != nil {
			t.Fatalf("newService failed: %v", err)
		}
		defer svc.dispose()

		settings, err := svc.readShard("settings")
		if err != nil {
			t.Fatalf("read settings failed: %v", err)
		}
		settingsMap, ok := settings.(map[string]any)
		if !ok || settingsMap["version"] != float64(3) {
			t.Fatalf("expected legacy pack settings, got %#v", settings)
		}

		tasks, err := svc.readShard("taskHistory")
		if err != nil {
			t.Fatalf("read task history failed: %v", err)
		}
		taskItems, ok := tasks.([]any)
		if !ok || len(taskItems) != 1 {
			t.Fatalf("expected legacy pack task history, got %#v", tasks)
		}
	})
}

func TestServiceNormalizesPluginEraReferenceLibraryIndexPaths(t *testing.T) {
	dataDir := t.TempDir()
	store := newJSONStore()
	writeTestFile(t, filepath.Join(dataDir, pluginReferenceImagesDir, "old-ref.jpg"), []byte{0xff, 0xd8, 0xff})
	legacyAbsolutePath := `\\?\E:\eucli-project\fast-window\src-tauri\target\debug\data\ai-draw\ref-images\old-ref.jpg`
	index := map[string]any{
		"version":    float64(1),
		"folders":    []any{map[string]any{"id": "folder-a", "name": "收藏夹"}},
		"activeView": map[string]any{"kind": "folder", "folderId": "folder-a"},
		"folderIdsByPath": map[string]any{
			legacyAbsolutePath: []any{"folder-a"},
		},
		"folderItemOrderByFolderId": map[string]any{
			"folder-a": []any{legacyAbsolutePath},
		},
	}
	if err := store.write(filepath.Join(dataDir, "refLibraryIndex.json"), index); err != nil {
		t.Fatalf("write refLibraryIndex failed: %v", err)
	}

	svc, err := newService(dataDir, nil)
	if err != nil {
		t.Fatalf("newService failed: %v", err)
	}
	defer svc.dispose()

	value, err := svc.readShard("refLibraryIndex")
	if err != nil {
		t.Fatalf("read refLibraryIndex failed: %v", err)
	}
	got, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected index object, got %#v", value)
	}
	folderIDsByPath, ok := got["folderIdsByPath"].(map[string]any)
	if !ok {
		t.Fatalf("expected folderIdsByPath, got %#v", got["folderIdsByPath"])
	}
	folderIDs := normalizeStringList(folderIDsByPath["old-ref.jpg"])
	if len(folderIDs) != 1 || folderIDs[0] != "folder-a" {
		t.Fatalf("expected normalized folder IDs, got %#v", folderIDsByPath)
	}
	if _, exists := folderIDsByPath[legacyAbsolutePath]; exists {
		t.Fatalf("legacy absolute path should be normalized, got %#v", folderIDsByPath)
	}

	orderByFolderID, ok := got["folderItemOrderByFolderId"].(map[string]any)
	if !ok {
		t.Fatalf("expected folderItemOrderByFolderId, got %#v", got["folderItemOrderByFolderId"])
	}
	order := normalizeStringList(orderByFolderID["folder-a"])
	if len(order) != 1 || order[0] != "old-ref.jpg" {
		t.Fatalf("expected normalized item order, got %#v", orderByFolderID)
	}
}

func writeTestFile(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatalf("write file failed: %v", err)
	}
}
