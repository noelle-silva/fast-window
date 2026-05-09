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
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box"}); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.saveDesktopLayouts([]desktopLayoutPatch{
		{Kind: "folder", ID: "one", Layout: folderGridLayout{X: 2, Y: 1}},
		{Kind: "container", ID: "box", Layout: folderGridLayout{X: -2, Y: 3000}},
	})
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
	doc, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box"})
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
	if _, err := svc.addContainer(desktopContainer{ID: "box", Name: "Box"}); err != nil {
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

func containerIDByItem(doc foldersDoc, id string) string {
	for _, item := range doc.Items {
		if item.ID == id {
			return item.ContainerID
		}
	}
	return ""
}

func mustTinyPNG(t *testing.T) []byte {
	t.Helper()
	bytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5aC5QAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}
