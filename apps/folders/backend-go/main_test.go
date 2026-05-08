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

	for _, name := range []string{dataFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
}

func TestMigratesLegacyWrappedFoldersData(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	legacy := `{"data":{"schemaVersion":1,"groups":[{"id":"work","name":"工作"}],"items":[{"id":"one","name":"Projects","path":"E:/Projects","groupId":"work","createdAtMs":1}]}}`
	if err := os.WriteFile(filepath.Join(svc.dataDir, foldersFile), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, dataFile)); err != nil {
		t.Fatalf("expected migrated data file: %v", err)
	}
	doc, err := svc.readFolders()
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 2 || doc.Groups[1].ID != "work" || len(doc.Items) != 1 || doc.Items[0].GroupID != "work" {
		t.Fatalf("unexpected migrated doc: %#v", doc)
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

func TestFolderLayoutRoundTrip(t *testing.T) {
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
	if doc.Items[0].Layout != nil {
		t.Fatalf("new folder should not persist layout before drag: %#v", doc.Items[0].Layout)
	}

	doc, err = svc.saveFolderLayouts([]folderLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 3, Y: 2}}})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Layout == nil || doc.Items[0].Layout.X != 3 || doc.Items[0].Layout.Y != 2 {
		t.Fatalf("unexpected layout: %#v", doc.Items[0].Layout)
	}

	doc, err = svc.updateFolder(folderItem{ID: "one", Name: "Code", Path: `E:\Code`, GroupID: defaultGroupID})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Layout == nil || doc.Items[0].Layout.X != 3 || doc.Items[0].Layout.Y != 2 {
		t.Fatalf("folder update should preserve layout: %#v", doc.Items[0].Layout)
	}
}

func TestFolderLayoutBatchRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.addFolder(folderItem{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addFolder(folderItem{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.saveFolderLayouts([]folderLayoutPatch{
		{ID: "one", Layout: folderGridLayout{X: 1, Y: 0}},
		{ID: "two", Layout: folderGridLayout{X: -1, Y: 3000}},
	})
	if err != nil {
		t.Fatal(err)
	}

	layoutByID := map[string]*folderGridLayout{}
	for _, item := range doc.Items {
		layoutByID[item.ID] = item.Layout
	}
	if layoutByID["one"] == nil || layoutByID["one"].X != 1 || layoutByID["one"].Y != 0 {
		t.Fatalf("unexpected one layout: %#v", layoutByID["one"])
	}
	if layoutByID["two"] == nil || layoutByID["two"].X != 0 || layoutByID["two"].Y != maxLayoutCoord {
		t.Fatalf("unexpected two layout: %#v", layoutByID["two"])
	}
}

func TestFolderValidationRequiresNamePathAndValidGroup(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addFolder(folderItem{ID: "one", Path: `E:\Projects`, GroupID: defaultGroupID}); err == nil {
		t.Fatal("expected missing name to fail")
	}
	if _, err := svc.addFolder(folderItem{ID: "one", Name: "Projects", GroupID: defaultGroupID}); err == nil {
		t.Fatal("expected missing path to fail")
	}
	if _, err := svc.addFolder(folderItem{ID: "one", Name: "Projects", Path: `E:\Projects`, GroupID: "missing"}); err == nil {
		t.Fatal("expected missing group to fail")
	}
}

func TestGroupsRoundTripAndDeleteMovesItemsToDefault(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.addGroup(folderGroup{ID: "work", Name: "工作"})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 2 {
		t.Fatalf("expected group added: %#v", doc.Groups)
	}
	doc, err = svc.addFolder(folderItem{ID: "one", Name: "Projects", Path: `E:\Projects`, GroupID: "work"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err = svc.updateGroup(folderGroup{ID: "work", Name: "项目"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Groups[1].Name != "项目" {
		t.Fatalf("expected group rename: %#v", doc.Groups[1])
	}
	doc, err = svc.removeGroup("work")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 1 || doc.Items[0].GroupID != defaultGroupID {
		t.Fatalf("expected item moved to default: %#v", doc)
	}
	if _, err := svc.removeGroup(defaultGroupID); err == nil {
		t.Fatal("expected default group removal to fail")
	}
}
