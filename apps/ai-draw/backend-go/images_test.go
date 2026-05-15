package main

import (
	"os"
	"path/filepath"
	"strings"
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

func TestImageStoreExportToDirCopiesSelectedImagesWithoutOverwriting(t *testing.T) {
	store := newImageStore(t.TempDir())
	first, err := store.saveBase64(testPNGDataURL)
	if err != nil {
		t.Fatalf("save first failed: %v", err)
	}
	second, err := store.saveBase64(testPNGDataURL)
	if err != nil {
		t.Fatalf("save second failed: %v", err)
	}
	targetDir := t.TempDir()
	writeTestFile(t, filepath.Join(targetDir, first), []byte("existing"))

	exported, err := store.exportToDir([]string{first, second, first}, targetDir)
	if err != nil {
		t.Fatalf("exportToDir failed: %v", err)
	}
	if len(exported) != 2 {
		t.Fatalf("expected two exported paths, got %#v", exported)
	}
	for _, exportedPath := range exported {
		if !strings.HasPrefix(exportedPath, targetDir+string(os.PathSeparator)) {
			t.Fatalf("exported path should stay inside target dir, got %q", exportedPath)
		}
		if _, err := os.Stat(exportedPath); err != nil {
			t.Fatalf("expected exported file %q: %v", exportedPath, err)
		}
	}
	if payload, err := os.ReadFile(filepath.Join(targetDir, first)); err != nil || string(payload) != "existing" {
		t.Fatalf("existing file should not be overwritten, payload=%q err=%v", string(payload), err)
	}
}

func TestImageStoreExportToDirRejectsInvalidInput(t *testing.T) {
	store := newImageStore(t.TempDir())
	targetDir := t.TempDir()
	if _, err := store.exportToDir(nil, targetDir); err == nil {
		t.Fatalf("expected empty export to fail")
	}
	if _, err := store.exportToDir([]string{"../escape.png"}, targetDir); err == nil {
		t.Fatalf("expected traversal export to fail")
	}
}
