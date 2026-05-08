package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServiceCreatesFoldersDataFiles(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{foldersFile, settingsFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
}

func TestFoldersRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.addFolder(folderItem{ID: "one", Name: "Projects", Path: `E:\Projects`, GroupID: defaultGroupID})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 1 || doc.Items[0].Name != "Projects" {
		t.Fatalf("unexpected add result: %#v", doc.Items)
	}

	doc, err = svc.updateFolder(folderItem{ID: "one", Name: "Code", Path: `E:\Code`, GroupID: defaultGroupID})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Name != "Code" || doc.Items[0].Path != `E:\Code` {
		t.Fatalf("unexpected update result: %#v", doc.Items[0])
	}

	doc, err = svc.removeFolder("one")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 0 {
		t.Fatalf("expected empty items, got %#v", doc.Items)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	saved, err := svc.saveSettings("list")
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.readSettings()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.View != saved.View || loaded.View != "list" {
		t.Fatalf("view = %q, want list", loaded.View)
	}
}
