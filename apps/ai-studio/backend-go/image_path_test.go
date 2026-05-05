package main

import (
	"path/filepath"
	"testing"
)

func TestImagePathForRelUsesDataRoot(t *testing.T) {
	dataDir := t.TempDir()
	svc := newService(dataDir)

	path, rel, err := svc.imagePathForRel("stickers/cat/sticker.png")
	if err != nil {
		t.Fatal(err)
	}
	if rel != "stickers/cat/sticker.png" {
		t.Fatalf("rel = %q", rel)
	}
	want := filepath.Join(dataDir, "stickers", "cat", "sticker.png")
	if path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
}
