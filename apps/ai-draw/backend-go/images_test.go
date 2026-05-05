package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImageStoreSaveReadDeleteAndRejectTraversal(t *testing.T) {
	store := newImageStore(t.TempDir())
	saved, err := store.saveBase64(testPNGDataURL)
	if err != nil {
		t.Fatalf("saveBase64 failed: %v", err)
	}
	if filepath.IsAbs(saved) {
		t.Fatalf("saved path should be relative, got %q", saved)
	}
	dataURL, err := store.read(saved)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if dataURL == "" || dataURL[:22] != "data:image/png;base64," {
		t.Fatalf("expected png data URL, got %q", dataURL)
	}
	if err := store.delete("../escape.png"); err == nil {
		t.Fatalf("expected traversal delete to fail")
	}
	if err := store.delete(saved); err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.currentRootDir(), saved)); !os.IsNotExist(err) {
		t.Fatalf("expected saved image to be deleted, stat err=%v", err)
	}
}
