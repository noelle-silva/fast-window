package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRunMigrationsUpdatesMetaAndMigrationState(t *testing.T) {
	dataDir := t.TempDir()
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "meta", "index.json"), map[string]any{
		"schemaVersion": 1,
		"dataVersion":   2,
		"roleFolders":   map[string]any{"r1": "Alice"},
		"chatIndexByRole": map[string]any{
			"r1": map[string]any{"chatIds": []any{"c1"}},
		},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "c1.json"), map[string]any{
		"id": "c1",
		"messages": []any{
			map[string]any{"id": "m1", "role": "user", "images": []any{"images/a.png"}},
		},
	})
	writeFileForRunnerTest(t, filepath.Join(dataDir, "ref-images", "images", "a.png"), []byte("png"))

	svc := newService(dataDir)
	if err := svc.runMigrations(); err != nil {
		t.Fatal(err)
	}

	meta := readJSONForRunnerTest(t, filepath.Join(dataDir, "meta", "index.json"))
	if got := int(asInt64(meta["dataVersion"], 0)); got != 4 {
		t.Fatalf("dataVersion = %d", got)
	}
	state := readJSONForRunnerTest(t, filepath.Join(dataDir, "_migrations.json"))
	applied, _ := state["applied"].([]any)
	if len(applied) != 2 {
		t.Fatalf("applied length = %d", len(applied))
	}
	entry, _ := applied[0].(map[string]any)
	if entry["id"] != "2026-05-05-role-chat-packages" {
		t.Fatalf("migration id = %v", entry["id"])
	}
	entry2, _ := applied[1].(map[string]any)
	if entry2["id"] != "2026-05-05-remove-migrated-role-chat-root-images" {
		t.Fatalf("migration id = %v", entry2["id"])
	}
	if _, err := os.Stat(filepath.Join(dataDir, "_migration-backups")); err != nil {
		t.Fatalf("backup dir missing: %v", err)
	}
}

func writeJSONForRunnerTest(t *testing.T, path string, value any) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	writeFileForRunnerTest(t, path, append(payload, '\n'))
}

func writeFileForRunnerTest(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
}

func readJSONForRunnerTest(t *testing.T, path string) map[string]any {
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
