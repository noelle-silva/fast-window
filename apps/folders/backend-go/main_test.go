package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
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

	for _, name := range []string{dataFile, metaFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
}

func TestHealthReportsCurrentBaselineData(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	health := svc.health()
	if !health.OK || !health.Data.OK || health.Data.DataVersion != dataVersion || health.Data.SchemaVersion != dataSchemaVersion {
		t.Fatalf("unexpected health: %#v", health)
	}
}

func TestEnsureReadyDoesNotFailForInvalidExistingData(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	invalid := `{"schemaVersion":1,"dataVersion":3,"groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":-2,"columnGap":38,"iconScale":1}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(invalid), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	health := svc.health()
	if health.Data.OK || !strings.Contains(health.Data.Error, "desktop icon row gap") {
		t.Fatalf("expected data health error, got %#v", health)
	}
}

func TestResetFoldersDataReplacesInvalidDataWithCurrentBaseline(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	invalid := `{"schemaVersion":1,"dataVersion":2,"groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(invalid), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.resetFoldersData()
	if err != nil {
		t.Fatal(err)
	}
	if doc.DataVersion != dataVersion || doc.Desktop.IconLayout.RowGap != defaultDesktopIconGap || doc.Desktop.IconLayout.ColumnGap != defaultDesktopIconGap || doc.Desktop.IconLayout.IconScale != 1 {
		t.Fatalf("expected reset current baseline doc: %#v", doc)
	}
	if health := svc.health(); !health.Data.OK {
		t.Fatalf("expected healthy data after reset: %#v", health)
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

func TestDesktopLayoutRoundTrip(t *testing.T) {
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
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.saveDesktopLayouts(desktopLayoutSavePayload{GroupID: defaultGroupID, Items: []desktopLayoutPatch{
		{Kind: "folder", ID: "one", Layout: folderGridLayout{X: 2, Y: 1}},
		{Kind: "container", ID: "box", Layout: folderGridLayout{X: -2, Y: 3000}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Layout == nil || doc.Items[0].Layout.X != 2 || doc.Items[0].Layout.Y != 1 {
		t.Fatalf("unexpected folder layout: %#v", doc.Items[0].Layout)
	}
	if doc.Containers[0].Layout == nil || doc.Containers[0].Layout.X != 0 || doc.Containers[0].Layout.Y != maxLayoutCoord {
		t.Fatalf("unexpected container layout: %#v", doc.Containers[0].Layout)
	}
	doc, err = svc.updateFolder(folderItem{ID: "one", Name: "One Renamed", Path: `E:\One`, GroupID: defaultGroupID})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Layout == nil || doc.Items[0].Layout.X != 2 || doc.Items[0].Layout.Y != 1 {
		t.Fatalf("folder update should preserve desktop layout: %#v", doc.Items[0].Layout)
	}
}

func TestDesktopContainerRoundTrip(t *testing.T) {
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
	doc, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 1 || doc.Containers[0].ID != "box" {
		t.Fatalf("unexpected container add: %#v", doc.Containers)
	}
	doc, err = svc.saveItemContainer([]string{"one"}, "box")
	if err != nil {
		t.Fatal(err)
	}
	if containerIDByItem(doc, "one") != "box" || containerIDByItem(doc, "two") != "" {
		t.Fatalf("unexpected item containers: %#v", doc.Items)
	}
	doc, err = svc.removeContainer("box")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 0 || containerIDByItem(doc, "one") != "" {
		t.Fatalf("expected removed container to release items: %#v", doc)
	}
}

func TestCreateContainerFromItemsRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []folderItem{
		{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID, Layout: &folderGridLayout{X: 2, Y: 0}},
		{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID, Layout: &folderGridLayout{X: 4, Y: 0}},
	} {
		if _, err := svc.addFolder(item); err != nil {
			t.Fatal(err)
		}
	}

	doc, err := svc.createContainerFromItems(createContainerFromItemsPayload{SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{X: 4, Y: 0}})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 1 || doc.Containers[0].Name != "新建收纳夹（1）" {
		t.Fatalf("unexpected created container: %#v", doc.Containers)
	}
	if doc.Containers[0].Layout == nil || doc.Containers[0].Layout.X != 4 || doc.Containers[0].Layout.Y != 0 {
		t.Fatalf("unexpected created container layout: %#v", doc.Containers[0].Layout)
	}
	if containerIDByItem(doc, "one") != doc.Containers[0].ID || containerIDByItem(doc, "two") != doc.Containers[0].ID {
		t.Fatalf("expected both items in new container: %#v", doc.Items)
	}
	if itemByID(doc, "one").Layout != nil || itemByID(doc, "two").Layout != nil {
		t.Fatalf("expected desktop layouts cleared: %#v", doc.Items)
	}
	if containerLayoutByItem(doc, "two") == nil || containerLayoutByItem(doc, "two").X != 0 || containerLayoutByItem(doc, "one") == nil || containerLayoutByItem(doc, "one").X != 1 {
		t.Fatalf("unexpected container item layouts: %#v", doc.Items)
	}
	if _, err := svc.createContainerFromItems(createContainerFromItemsPayload{SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{}}); err == nil {
		t.Fatal("expected contained target folder to be rejected")
	}
}

func TestCreateContainerFromExtractedSourceItem(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []folderItem{
		{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID},
		{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID, Layout: &folderGridLayout{X: 3, Y: 0}},
	} {
		if _, err := svc.addFolder(item); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.saveItemContainer([]string{"one"}, "box"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.placeContainerItems(containerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}}}); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.createContainerFromItems(createContainerFromItemsPayload{SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{X: 3, Y: 0}})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 2 || doc.Containers[0].Name != "新建收纳夹（1）" {
		t.Fatalf("unexpected created container: %#v", doc.Containers)
	}
	if containerIDByItem(doc, "one") != doc.Containers[0].ID || containerIDByItem(doc, "two") != doc.Containers[0].ID {
		t.Fatalf("expected source and target in new container: %#v", doc.Items)
	}
	if itemByID(doc, "one").Layout != nil || itemByID(doc, "two").Layout != nil {
		t.Fatalf("expected desktop layouts cleared: %#v", doc.Items)
	}
	if containerLayoutByItem(doc, "one") == nil || containerLayoutByItem(doc, "one").X != 1 || containerLayoutByItem(doc, "two") == nil || containerLayoutByItem(doc, "two").X != 0 {
		t.Fatalf("unexpected container layouts: %#v", doc.Items)
	}
}

func TestCreateContainerFromItemsUsesNextName(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []folderItem{
		{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID},
		{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID},
	} {
		if _, err := svc.addFolder(item); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "新建收纳夹（1）", GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.createContainerFromItems(createContainerFromItemsPayload{SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{X: 1, Y: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 2 || doc.Containers[0].Name != "新建收纳夹（2）" {
		t.Fatalf("expected next container name, got %#v", doc.Containers)
	}
}

func TestContainerItemsPlacementRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []folderItem{
		{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID},
		{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID},
	} {
		if _, err := svc.addFolder(item); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.saveItemContainer([]string{"one"}, "box"); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.placeContainerItems(containerItemsPlacement{
		ContainerID: "box",
		Items:       []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 2, Y: 1}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if containerLayoutByItem(doc, "one") == nil || containerLayoutByItem(doc, "one").X != 2 || containerLayoutByItem(doc, "one").Y != 1 {
		t.Fatalf("unexpected container layout: %#v", itemByID(doc, "one"))
	}

	doc, err = svc.placeContainerItems(containerItemsPlacement{
		ContainerID: "box",
		MovedID:     "two",
		Items: []containerLayoutPatch{
			{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}},
			{ID: "two", Layout: folderGridLayout{X: 1, Y: 0}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if containerIDByItem(doc, "two") != "box" || containerLayoutByItem(doc, "two") == nil || containerLayoutByItem(doc, "two").X != 1 {
		t.Fatalf("expected moved item to be placed atomically: %#v", itemByID(doc, "two"))
	}
	if _, err := svc.placeContainerItems(containerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "missing", Layout: folderGridLayout{}}}}); err == nil {
		t.Fatal("expected missing folder placement to fail")
	}
	doc, err = svc.saveItemContainer([]string{"one"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if containerLayoutByItem(doc, "one") != nil {
		t.Fatalf("expected moving out to clear container layout: %#v", itemByID(doc, "one"))
	}
}

func TestExtractContainerItemToDesktopRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []folderItem{
		{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID},
		{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID, Layout: &folderGridLayout{X: 1, Y: 0}},
	} {
		if _, err := svc.addFolder(item); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID, Layout: &folderGridLayout{X: 0, Y: 0}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.saveItemContainer([]string{"one"}, "box"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.placeContainerItems(containerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}}}); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.extractContainerItemToDesktop(extractContainerItemToDesktopPayload{
		ContainerID: "box",
		ItemID:      "one",
		Items: []desktopLayoutPatch{
			{Kind: "folder", ID: "one", Layout: folderGridLayout{X: 2, Y: 1}},
			{Kind: "folder", ID: "two", Layout: folderGridLayout{X: 3, Y: 1}},
			{Kind: "container", ID: "box", Layout: folderGridLayout{X: 0, Y: 2}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if containerIDByItem(doc, "one") != "" || containerLayoutByItem(doc, "one") != nil {
		t.Fatalf("expected extracted item on desktop: %#v", itemByID(doc, "one"))
	}
	if itemByID(doc, "one").Layout == nil || itemByID(doc, "one").Layout.X != 2 || itemByID(doc, "one").Layout.Y != 1 {
		t.Fatalf("unexpected extracted layout: %#v", itemByID(doc, "one"))
	}
	if itemByID(doc, "two").Layout == nil || itemByID(doc, "two").Layout.X != 3 || itemByID(doc, "two").Layout.Y != 1 {
		t.Fatalf("unexpected desktop sibling layout: %#v", itemByID(doc, "two"))
	}
	if doc.Containers[0].Layout == nil || doc.Containers[0].Layout.Y != 2 {
		t.Fatalf("unexpected container layout: %#v", doc.Containers[0].Layout)
	}
}

func TestExtractContainerItemToDesktopRejectsInvalidPatches(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, item := range []folderItem{
		{ID: "one", Name: "One", Path: `E:\One`, GroupID: defaultGroupID},
		{ID: "two", Name: "Two", Path: `E:\Two`, GroupID: defaultGroupID},
	} {
		if _, err := svc.addFolder(item); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.saveItemContainer([]string{"one", "two"}, "box"); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.extractContainerItemToDesktop(extractContainerItemToDesktopPayload{ContainerID: "box", ItemID: "one", Items: []desktopLayoutPatch{{Kind: "folder", ID: "two", Layout: folderGridLayout{X: 1, Y: 0}}}}); err == nil {
		t.Fatal("expected missing moved folder layout to fail")
	}
	if _, err := svc.extractContainerItemToDesktop(extractContainerItemToDesktopPayload{ContainerID: "box", ItemID: "one", Items: []desktopLayoutPatch{{Kind: "folder", ID: "one", Layout: folderGridLayout{X: 1, Y: 0}}, {Kind: "folder", ID: "two", Layout: folderGridLayout{X: 2, Y: 0}}}}); err == nil || !strings.Contains(err.Error(), "folder is not on desktop") {
		t.Fatalf("expected contained sibling desktop layout to fail, got %v", err)
	}
	if _, err := svc.extractContainerItemToDesktop(extractContainerItemToDesktopPayload{ContainerID: "box", ItemID: "missing", Items: []desktopLayoutPatch{{Kind: "folder", ID: "missing", Layout: folderGridLayout{X: 1, Y: 0}}}}); err == nil || !strings.Contains(err.Error(), "folder not found") {
		t.Fatalf("expected missing folder to fail, got %v", err)
	}
}

func TestDesktopIconRoundTrip(t *testing.T) {
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
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.saveDesktopIcon("folder", "one", &desktopIcon{Kind: "color", Color: "#8fa99b"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Icon == nil || doc.Items[0].Icon.Color != "#8FA99B" {
		t.Fatalf("unexpected folder icon: %#v", doc.Items[0].Icon)
	}
	if _, err := svc.saveDesktopIcon("container", "box", &desktopIcon{Kind: "color", Color: "#8FA6B8"}); err == nil {
		t.Fatal("expected container icon customization to fail")
	}
	if _, err := svc.saveDesktopIcon("folder", "one", &desktopIcon{Kind: "color", Color: "#FF0000"}); err == nil {
		t.Fatal("expected unsupported icon color to fail")
	}
}

func TestDesktopWallpaperRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.saveDesktopWallpaper(&desktopWallpaper{AssetID: wallpaperAssetsDir + "/0123456789abcdef0123456789abcdef01234567.png"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.Wallpaper == nil || doc.Desktop.Wallpaper.AssetID != wallpaperAssetsDir+"/0123456789abcdef0123456789abcdef01234567.png" {
		t.Fatalf("unexpected wallpaper: %#v", doc.Desktop.Wallpaper)
	}
	if _, err := svc.saveDesktopWallpaper(&desktopWallpaper{AssetID: iconAssetsDir + "/0123456789abcdef0123456789abcdef01234567.png"}); err == nil {
		t.Fatal("expected icon asset id to fail for wallpaper")
	}
	doc, err = svc.saveDesktopWallpaper(nil)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.Wallpaper != nil {
		t.Fatalf("expected wallpaper to be cleared: %#v", doc.Desktop.Wallpaper)
	}
}

func TestDesktopIconLayoutRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.readFolders()
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.IconLayout.RowGap != defaultDesktopIconGap || doc.Desktop.IconLayout.ColumnGap != defaultDesktopIconGap || doc.Desktop.IconLayout.IconScale != 1 {
		t.Fatalf("expected default desktop icon layout: %#v", doc.Desktop.IconLayout)
	}

	doc, err = svc.saveDesktopIconLayout(desktopIconLayout{RowGap: 52, ColumnGap: 64, IconScale: 1.2})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.IconLayout.RowGap != 52 || doc.Desktop.IconLayout.ColumnGap != 64 || doc.Desktop.IconLayout.IconScale != 1.2 {
		t.Fatalf("unexpected desktop icon layout: %#v", doc.Desktop.IconLayout)
	}
	if _, err := svc.saveDesktopIconLayout(desktopIconLayout{RowGap: -2, ColumnGap: 38, IconScale: 1}); err == nil {
		t.Fatal("expected negative row gap to fail")
	}
	if _, err := svc.saveDesktopIconLayout(desktopIconLayout{RowGap: 38, ColumnGap: 80, IconScale: 1}); err == nil {
		t.Fatal("expected too large column gap to fail")
	}
	if _, err := svc.saveDesktopIconLayout(desktopIconLayout{RowGap: 38, ColumnGap: 38, IconScale: 2}); err == nil {
		t.Fatal("expected too large icon scale to fail")
	}
}

func TestInvalidPersistedDataIsDiagnosedAfterStartup(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	invalid := `{"schemaVersion":1,"dataVersion":3,"groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":-2,"columnGap":38,"iconScale":1}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(invalid), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readFolders(); err == nil || !strings.Contains(err.Error(), "desktop icon row gap") {
		t.Fatalf("expected row gap read error, got %v", err)
	}
	if health := svc.health(); health.Data.OK || !strings.Contains(health.Data.Error, "desktop icon row gap") {
		t.Fatalf("expected row gap health error, got %#v", health)
	}
}

func TestMissingCurrentBaselineFieldIsDiagnosedAfterStartup(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	invalid := `{"schemaVersion":1,"dataVersion":3,"groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(invalid), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readFolders(); err == nil || !strings.Contains(err.Error(), "desktop.iconLayout.iconScale") {
		t.Fatalf("expected missing icon scale read error, got %v", err)
	}
	if health := svc.health(); health.Data.OK || !strings.Contains(health.Data.Error, "desktop.iconLayout.iconScale") {
		t.Fatalf("expected missing icon scale health error, got %#v", health)
	}
}

func TestCurrentBaselineRejectsInvalidReferencesAndDuplicates(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	invalidContainerRef := `{"schemaVersion":1,"dataVersion":3,"groups":[{"id":"default","name":"默认"}],"items":[{"id":"one","name":"One","path":"E:/One","groupId":"default","containerId":"missing","createdAtMs":1,"updatedAtMs":1}],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38,"iconScale":1}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(invalidContainerRef), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readFolders(); err == nil || !strings.Contains(err.Error(), "container not found") {
		t.Fatalf("expected missing container error, got %v", err)
	}

	duplicateItem := `{"schemaVersion":1,"dataVersion":3,"groups":[{"id":"default","name":"默认"}],"items":[{"id":"one","name":"One","path":"E:/One","groupId":"default","createdAtMs":1,"updatedAtMs":1},{"id":"one","name":"Two","path":"E:/Two","groupId":"default","createdAtMs":2,"updatedAtMs":2}],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38,"iconScale":1}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(duplicateItem), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readFolders(); err == nil || !strings.Contains(err.Error(), "duplicate folder id") {
		t.Fatalf("expected duplicate folder error, got %v", err)
	}

	invalidLayout := `{"schemaVersion":1,"dataVersion":3,"groups":[{"id":"default","name":"默认"}],"items":[{"id":"one","name":"One","path":"E:/One","groupId":"default","createdAtMs":1,"updatedAtMs":1,"layout":{"x":-1,"y":0}}],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38,"iconScale":1}},"updatedAt":"2026-01-01T00:00:00Z"}`
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(invalidLayout), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readFolders(); err == nil || !strings.Contains(err.Error(), "layout x") {
		t.Fatalf("expected invalid layout error, got %v", err)
	}
}

func TestImportAssetCopiesImagesAndRejectsInvalidContent(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(t.TempDir(), "icon.png")
	if err := os.WriteFile(sourcePath, mustTinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	asset, err := svc.importAsset("icon", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Kind != "icon" || !strings.HasPrefix(asset.ID, iconAssetsDir+"/") {
		t.Fatalf("unexpected asset: %#v", asset)
	}
	targetPath, err := svc.assetPath(asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(targetPath); err != nil {
		t.Fatalf("expected imported asset file: %v", err)
	}
	badPath := filepath.Join(t.TempDir(), "bad.png")
	if err := os.WriteFile(badPath, []byte("not a png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.importAsset("icon", badPath); err == nil {
		t.Fatal("expected invalid image content to fail")
	}
	wallpaper, err := svc.importAsset("wallpaper", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if wallpaper.Kind != "wallpaper" || !strings.HasPrefix(wallpaper.ID, wallpaperAssetsDir+"/") {
		t.Fatalf("unexpected wallpaper asset: %#v", wallpaper)
	}
}

func TestWallpaperImportHasNoFileSizeLimit(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	largeImage := append(mustTinyPNG(t), make([]byte, maxIconAssetBytes+1)...)
	sourcePath := filepath.Join(t.TempDir(), "large-wallpaper.png")
	if err := os.WriteFile(sourcePath, largeImage, 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.importAsset("icon", sourcePath); err == nil {
		t.Fatal("expected oversized icon asset to fail")
	}
	wallpaper, err := svc.importAsset("wallpaper", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if wallpaper.Kind != "wallpaper" || !strings.HasPrefix(wallpaper.ID, wallpaperAssetsDir+"/") {
		t.Fatalf("unexpected wallpaper asset: %#v", wallpaper)
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

func TestFolderGroupTransferUsesSingleOwnership(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addGroup(folderGroup{ID: "work", Name: "工作"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addGroup(folderGroup{ID: "design", Name: "设计"}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.addFolder(folderItem{ID: "one", Name: "Projects", Path: `E:\Projects`, GroupID: defaultGroupID, Layout: &folderGridLayout{X: 2, Y: 0}})
	if err != nil {
		t.Fatal(err)
	}
	doc, err = svc.moveFolderToGroup(folderGroupTransferPayload{ID: "one", GroupID: "work"})
	if err != nil {
		t.Fatal(err)
	}
	if itemByID(doc, "one").GroupID != "work" || itemByID(doc, "one").Layout != nil {
		t.Fatalf("expected moved item to have single work ownership and cleared desktop layout: %#v", itemByID(doc, "one"))
	}
	doc, err = svc.copyFolderToGroup(folderGroupTransferPayload{ID: "one", GroupID: "design"})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 2 {
		t.Fatalf("expected copied item to create an independent folder: %#v", doc.Items)
	}
	var copied *folderItem
	for i := range doc.Items {
		if doc.Items[i].ID != "one" {
			copied = &doc.Items[i]
		}
	}
	if copied == nil || copied.GroupID != "design" || copied.ContainerID != "" || copied.Layout != nil || copied.ContainerLayout != nil {
		t.Fatalf("expected copied item to have isolated design ownership: %#v", copied)
	}
	if _, err := svc.copyFolderToGroup(folderGroupTransferPayload{ID: "one", GroupID: "work"}); err == nil {
		t.Fatal("expected copying to the same group to fail")
	}
}

func TestRemovingGroupMovesDesktopObjectsToDefault(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addGroup(folderGroup{ID: "work", Name: "工作"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addGroup(folderGroup{ID: "design", Name: "设计"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addFolder(folderItem{ID: "one", Name: "Projects", Path: `E:\Projects`, GroupID: "work", Layout: &folderGridLayout{X: 1, Y: 0}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box", GroupID: "work", Layout: &folderGridLayout{X: 2, Y: 0}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.saveItemContainer([]string{"one"}, "box"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.placeContainerItems(containerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}}}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.removeGroup("work")
	if err != nil {
		t.Fatal(err)
	}
	if itemByID(doc, "one").GroupID != defaultGroupID || itemByID(doc, "one").ContainerID != "" || itemByID(doc, "one").ContainerLayout != nil || itemByID(doc, "one").Layout != nil {
		t.Fatalf("expected removed group item to return to default desktop cleanly: %#v", itemByID(doc, "one"))
	}
	if doc.Containers[0].GroupID != defaultGroupID || doc.Containers[0].Layout != nil {
		t.Fatalf("expected removed group container to return to default desktop cleanly: %#v", doc.Containers[0])
	}
}

func containerIDByItem(doc foldersDoc, id string) string {
	for _, item := range doc.Items {
		if item.ID == id {
			return item.ContainerID
		}
	}
	return ""
}

func containerLayoutByItem(doc foldersDoc, id string) *folderGridLayout {
	item := itemByID(doc, id)
	if item == nil {
		return nil
	}
	return item.ContainerLayout
}

func itemByID(doc foldersDoc, id string) *folderItem {
	for i := range doc.Items {
		if doc.Items[i].ID == id {
			return &doc.Items[i]
		}
	}
	return nil
}

func mustTinyPNG(t *testing.T) []byte {
	t.Helper()
	bytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5aC5QAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}
