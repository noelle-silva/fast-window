package migrations

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRefImagesToDataTreeMovesImagesAndRemovesRefImages(t *testing.T) {
	dataDir := t.TempDir()
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "roles", "Alice", "avatar.png"), []byte("role-avatar"))
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "groups", "Team", "avatar.png"), []byte("group-avatar"))
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "stickers", "cat", "sticker.png"), []byte("sticker"))
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "images", "legacy.jpg"), []byte("legacy"))

	migration := RefImagesToDataTree()
	if err := migration.Apply(Context{DataDir: dataDir, Meta: map[string]any{}}); err != nil {
		t.Fatal(err)
	}

	assertFilePayload(t, filepath.Join(dataDir, "roles", "Alice", "avatar.png"), "role-avatar")
	assertFilePayload(t, filepath.Join(dataDir, "groups", "Team", "avatar.png"), "group-avatar")
	assertFilePayload(t, filepath.Join(dataDir, "stickers", "cat", "sticker.png"), "sticker")
	assertFilePayload(t, filepath.Join(dataDir, "images", "legacy.jpg"), "legacy")
	if _, err := os.Stat(filepath.Join(dataDir, "ref-images")); !os.IsNotExist(err) {
		t.Fatalf("ref-images should be removed, stat err=%v", err)
	}
}

func TestRefImagesToDataTreeIsIdempotentForExistingSameFile(t *testing.T) {
	dataDir := t.TempDir()
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "stickers", "cat", "sticker.png"), []byte("same"))
	writeFileForTest(t, filepath.Join(dataDir, "stickers", "cat", "sticker.png"), []byte("same"))

	migration := RefImagesToDataTree()
	if err := migration.Apply(Context{DataDir: dataDir, Meta: map[string]any{}}); err != nil {
		t.Fatal(err)
	}

	assertFilePayload(t, filepath.Join(dataDir, "stickers", "cat", "sticker.png"), "same")
	if _, err := os.Stat(filepath.Join(dataDir, "ref-images")); !os.IsNotExist(err) {
		t.Fatalf("ref-images should be removed, stat err=%v", err)
	}
}

func TestRefImagesToDataTreeFailsForExistingDifferentFile(t *testing.T) {
	dataDir := t.TempDir()
	writeFileForTest(t, filepath.Join(dataDir, "ref-images", "stickers", "cat", "sticker.png"), []byte("old"))
	writeFileForTest(t, filepath.Join(dataDir, "stickers", "cat", "sticker.png"), []byte("new"))

	migration := RefImagesToDataTree()
	if err := migration.Apply(Context{DataDir: dataDir, Meta: map[string]any{}}); err == nil {
		t.Fatal("expected conflict error")
	}

	assertFilePayload(t, filepath.Join(dataDir, "ref-images", "stickers", "cat", "sticker.png"), "old")
	assertFilePayload(t, filepath.Join(dataDir, "stickers", "cat", "sticker.png"), "new")
}

func assertFilePayload(t *testing.T, path string, want string) {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != want {
		t.Fatalf("%s payload = %q, want %q", path, string(payload), want)
	}
}
