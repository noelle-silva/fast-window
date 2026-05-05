package migrations

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveMigratedRoleChatRootImagesDeletesOnlyMatchingRootCopy(t *testing.T) {
	dataDir := t.TempDir()
	chatRel := "chats/Alice/c1/images/a.png"
	keepRel := "chats/Alice/c1/images/keep.png"
	writeJSONForTest(t, filepath.Join(dataDir, "chats", "Alice", "c1", "chat.json"), map[string]any{
		"id": "c1",
		"messages": []any{
			map[string]any{"id": "m1", "role": "user", "images": []any{chatRel, keepRel}},
		},
	})
	writeFileForTest(t, filepath.Join(dataDir, filepath.FromSlash(chatRel)), []byte("same"))
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "a.png"), []byte("same"))
	writeFileForTest(t, filepath.Join(dataDir, filepath.FromSlash(keepRel)), []byte("new"))
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "keep.png"), []byte("different"))

	migration := RemoveMigratedRoleChatRootImages()
	if err := migration.Apply(Context{DataDir: dataDir, Meta: map[string]any{}}); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(dataDir, "ref-images", "a.png")); !os.IsNotExist(err) {
		t.Fatalf("matching root image should be removed, stat err=%v", err)
	}
	if payload, err := os.ReadFile(filepath.Join(dataDir, "ref-images", "keep.png")); err != nil || string(payload) != "different" {
		t.Fatalf("different root image should stay, payload=%q err=%v", string(payload), err)
	}
	if payload, err := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(chatRel))); err != nil || string(payload) != "same" {
		t.Fatalf("package image should stay, payload=%q err=%v", string(payload), err)
	}
}
