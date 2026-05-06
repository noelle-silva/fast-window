package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRunMigrationsConvergesPluginEraLayout(t *testing.T) {
	dataDir := t.TempDir()
	legacyAbsolutePath := `\\?\E:\eucli-project\fast-window\src-tauri\target\debug\data\ai-draw\ref-images\old-ref.jpg`
	writeJSONForMigrationTest(t, filepath.Join(dataDir, metaFile), map[string]any{"schemaVersion": 1, "migratedAt": float64(1)})
	writeTestFile(t, filepath.Join(dataDir, pluginReferenceImagesDir, "old-ref.jpg"), []byte{0xff, 0xd8, 0xff})
	writeJSONForMigrationTest(t, filepath.Join(dataDir, legacyPackFile), map[string]any{
		"settings":      map[string]any{"version": float64(3)},
		"taskHistory":   []any{map[string]any{"id": "task-old"}},
		"promptLibrary": map[string]any{"version": float64(1), "folders": []any{}},
		"refLibraryIndex": map[string]any{
			"version":    float64(1),
			"folders":    []any{map[string]any{"id": "folder-a", "name": "收藏夹"}},
			"activeView": map[string]any{"kind": "folder", "folderId": "folder-a"},
			"folderIdsByPath": map[string]any{
				legacyAbsolutePath: []any{"folder-a"},
			},
		},
	})

	svc, err := newService(dataDir, nil)
	if err != nil {
		t.Fatalf("newService failed: %v", err)
	}
	svc.dispose()

	settings := readJSONForMigrationTest(t, filepath.Join(dataDir, "settings.json"))
	if settings["version"] != float64(3) {
		t.Fatalf("settings not migrated: %#v", settings)
	}
	tasks := readJSONListForMigrationTest(t, filepath.Join(dataDir, "taskHistory.json"))
	if len(tasks) != 1 {
		t.Fatalf("taskHistory not migrated: %#v", tasks)
	}
	refIndex := readJSONForMigrationTest(t, filepath.Join(dataDir, "refLibraryIndex.json"))
	folderIDsByPath, _ := refIndex["folderIdsByPath"].(map[string]any)
	if folderIDs := normalizeStringList(folderIDsByPath["old-ref.jpg"]); len(folderIDs) != 1 || folderIDs[0] != "folder-a" {
		t.Fatalf("ref index paths not normalized: %#v", folderIDsByPath)
	}
	if _, exists := folderIDsByPath[legacyAbsolutePath]; exists {
		t.Fatalf("legacy absolute ref path should not remain: %#v", folderIDsByPath)
	}

	meta := readJSONForMigrationTest(t, filepath.Join(dataDir, metaFile))
	if got := intNumber(meta["dataVersion"]); got != aiDrawDataVersion {
		t.Fatalf("dataVersion = %d", got)
	}
	state := readJSONForMigrationTest(t, filepath.Join(dataDir, migrationStateFile))
	applied := anySlice(state["applied"])
	if len(applied) != 1 {
		t.Fatalf("applied migrations = %#v", applied)
	}
	entry, _ := applied[0].(map[string]any)
	if entry["id"] != "2026-05-06-plugin-era-layout" {
		t.Fatalf("migration id = %v", entry["id"])
	}
	recoveryEntries, err := os.ReadDir(filepath.Join(dataDir, "_migration-recovery"))
	if err != nil || len(recoveryEntries) != 1 {
		t.Fatalf("recovery entries = %d err=%v", len(recoveryEntries), err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "_migration-recovery", recoveryEntries[0].Name(), "plan.json")); err != nil {
		t.Fatalf("recovery plan missing: %v", err)
	}
}

func TestRunMigrationsDoesNotCreateRecoveryForFreshDataDir(t *testing.T) {
	dataDir := t.TempDir()
	svc, err := newService(dataDir, nil)
	if err != nil {
		t.Fatalf("newService failed: %v", err)
	}
	svc.dispose()

	meta := readJSONForMigrationTest(t, filepath.Join(dataDir, metaFile))
	if got := intNumber(meta["dataVersion"]); got != aiDrawDataVersion {
		t.Fatalf("dataVersion = %d", got)
	}
	if _, err := os.Stat(filepath.Join(dataDir, migrationStateFile)); !os.IsNotExist(err) {
		t.Fatalf("fresh data dir should not have migration state, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "_migration-recovery")); !os.IsNotExist(err) {
		t.Fatalf("fresh data dir should not have recovery dir, stat err=%v", err)
	}
}

func TestRunMigrationsIsIdempotent(t *testing.T) {
	dataDir := t.TempDir()
	writeJSONForMigrationTest(t, filepath.Join(dataDir, metaFile), map[string]any{"schemaVersion": 1})
	writeJSONForMigrationTest(t, filepath.Join(dataDir, legacyPackFile), map[string]any{"settings": map[string]any{"version": float64(1)}})

	first, err := newService(dataDir, nil)
	if err != nil {
		t.Fatalf("first newService failed: %v", err)
	}
	first.dispose()
	second, err := newService(dataDir, nil)
	if err != nil {
		t.Fatalf("second newService failed: %v", err)
	}
	second.dispose()

	state := readJSONForMigrationTest(t, filepath.Join(dataDir, migrationStateFile))
	if applied := anySlice(state["applied"]); len(applied) != 1 {
		t.Fatalf("migration should apply once, got %#v", applied)
	}
	recoveryEntries, err := os.ReadDir(filepath.Join(dataDir, "_migration-recovery"))
	if err != nil || len(recoveryEntries) != 1 {
		t.Fatalf("recovery should be created once, entries=%d err=%v", len(recoveryEntries), err)
	}
}

func writeJSONForMigrationTest(t *testing.T, path string, value any) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, append(payload, '\n'))
}

func readJSONForMigrationTest(t *testing.T, path string) map[string]any {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func readJSONListForMigrationTest(t *testing.T, path string) []any {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value []any
	if err := json.Unmarshal(payload, &value); err != nil {
		t.Fatal(err)
	}
	return value
}
