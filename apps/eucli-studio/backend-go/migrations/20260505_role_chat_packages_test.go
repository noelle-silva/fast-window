package migrations

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRoleChatPackagesMigratesRoleChatAndImages(t *testing.T) {
	dataDir := t.TempDir()
	writeJSONForTest(t, filepath.Join(dataDir, "chats", "Alice", "c1.json"), map[string]any{
		"id": "c1",
		"messages": []any{
			map[string]any{"id": "m1", "role": "user", "images": []any{"images/a.png", "stickers/cat/sticker.png"}},
		},
	})
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "images", "a.png"), []byte("png"))
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "stickers", "cat", "sticker.png"), []byte("sticker"))

	migration := RoleChatPackages()
	err := migration.Apply(Context{
		DataDir: dataDir,
		Meta: map[string]any{
			"roleFolders": map[string]any{"r1": "Alice"},
			"chatIndexByRole": map[string]any{
				"r1": map[string]any{"chatIds": []any{"c1"}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(dataDir, "chats", "Alice", "c1.json")); !os.IsNotExist(err) {
		t.Fatalf("legacy chat file still exists or stat failed: %v", err)
	}
	chatPath := filepath.Join(dataDir, "chats", "Alice", "c1", "chat.json")
	chat := readJSONForTest(t, chatPath)
	messages, _ := chat["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("messages length = %d", len(messages))
	}
	message, _ := messages[0].(map[string]any)
	images, _ := message["images"].([]any)
	if len(images) != 2 {
		t.Fatalf("images length = %d", len(images))
	}
	migratedPath, _ := images[0].(string)
	if !strings.HasPrefix(migratedPath, "chats/Alice/c1/images/a-") || !strings.HasSuffix(migratedPath, ".png") {
		t.Fatalf("migrated image path = %v", images[0])
	}
	if images[1] != "stickers/cat/sticker.png" {
		t.Fatalf("sticker path should stay unchanged, got %v", images[1])
	}
	if payload, err := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(migratedPath))); err != nil || string(payload) != "png" {
		t.Fatalf("migrated image payload = %q err=%v", string(payload), err)
	}
	if payload, err := os.ReadFile(filepath.Join(dataDir, "ref-images", "stickers", "cat", "sticker.png")); err != nil || string(payload) != "sticker" {
		t.Fatalf("sticker payload = %q err=%v", string(payload), err)
	}
}

func writeJSONForTest(t *testing.T, path string, value any) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	writeFileForTest(t, path, append(payload, '\n'))
}

func writeFileForTest(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
}

func readJSONForTest(t *testing.T, path string) map[string]any {
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
