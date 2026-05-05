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
		"settings": map[string]any{
			"providers": []any{map[string]any{"id": "OpenAI", "name": "OpenAI"}},
		},
		"roleOrder":   []any{"r1"},
		"roleFolders": map[string]any{"r1": "Alice"},
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
	if got := int(asInt64(meta["dataVersion"], 0)); got != 7 {
		t.Fatalf("dataVersion = %d", got)
	}
	state := readJSONForRunnerTest(t, filepath.Join(dataDir, "_migrations.json"))
	applied, _ := state["applied"].([]any)
	if len(applied) != 5 {
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
	entry3, _ := applied[2].(map[string]any)
	if entry3["id"] != "2026-05-05-ref-images-to-data-tree" {
		t.Fatalf("migration id = %v", entry3["id"])
	}
	entry4, _ := applied[3].(map[string]any)
	if entry4["id"] != "2026-05-05-split-meta-indexes" {
		t.Fatalf("migration id = %v", entry4["id"])
	}
	entry5, _ := applied[4].(map[string]any)
	if entry5["id"] != "2026-05-05-chat-index-summaries" {
		t.Fatalf("migration id = %v", entry5["id"])
	}
	if _, ok := meta["chatIndexByRole"]; ok {
		t.Fatal("chatIndexByRole should be removed from meta")
	}
	if _, err := os.Stat(filepath.Join(dataDir, "chats", "index.json")); err != nil {
		t.Fatalf("chats index missing: %v", err)
	}
	roleChatIndex := readJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "index.json"))
	chatMetas, _ := roleChatIndex["chatMetas"].([]any)
	if len(chatMetas) != 1 || asMap(chatMetas[0])["id"] != "c1" {
		t.Fatalf("chatMetas = %#v", roleChatIndex["chatMetas"])
	}
	if _, err := os.Stat(filepath.Join(dataDir, "providers", "OpenAI", "provider.json")); err != nil {
		t.Fatalf("provider missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "ref-images")); !os.IsNotExist(err) {
		t.Fatalf("ref-images should be removed, stat err=%v", err)
	}
	recoveryEntries, err := os.ReadDir(filepath.Join(dataDir, "_migration-recovery"))
	if err != nil {
		t.Fatalf("recovery dir missing: %v", err)
	}
	if len(recoveryEntries) != 5 {
		t.Fatalf("recovery dir entries = %d", len(recoveryEntries))
	}
	planPayload, err := os.ReadFile(filepath.Join(dataDir, "_migration-recovery", recoveryEntries[0].Name(), "plan.json"))
	if err != nil {
		t.Fatalf("plan missing: %v", err)
	}
	var plan map[string]any
	if err := json.Unmarshal(planPayload, &plan); err != nil {
		t.Fatal(err)
	}
	if plan["strategy"] != "change-set" {
		t.Fatalf("recovery strategy = %v", plan["strategy"])
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
