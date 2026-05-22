package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceCreatesCollectionsDataFiles(t *testing.T) {
	svc := readyService(t)

	for _, name := range []string{dataFile, metaFile, migrationStateFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
}

func TestHealthReportsCurrentData(t *testing.T) {
	svc := readyService(t)
	health := svc.health()
	if !health.OK || !health.Data.OK || health.Data.DataVersion != dataVersion || health.Data.SchemaVersion != dataSchemaVersion {
		t.Fatalf("unexpected health: %#v", health)
	}
}

func TestCollectionTargetOpenCommands(t *testing.T) {
	urlCommand, err := openCommandForCollectionTarget(collectionTarget{Kind: "url", URL: "https://example.com/docs"}, "windows")
	if err != nil {
		t.Fatal(err)
	}
	if urlCommand.Name != "rundll32" || len(urlCommand.Args) != 2 || urlCommand.Args[0] != "url.dll,FileProtocolHandler" || urlCommand.Args[1] != "https://example.com/docs" {
		t.Fatalf("unexpected windows url open command: %#v", urlCommand)
	}

	fileCommand, err := openCommandForCollectionTarget(collectionTarget{Kind: "file", Path: `E:\Docs\note.txt`}, "windows")
	if err != nil {
		t.Fatal(err)
	}
	if fileCommand.Name != "rundll32" || len(fileCommand.Args) != 2 || fileCommand.Args[0] != "url.dll,FileProtocolHandler" || fileCommand.Args[1] != `E:\Docs\note.txt` {
		t.Fatalf("unexpected windows file open command: %#v", fileCommand)
	}

	folderCommand, err := openCommandForCollectionTarget(folderTarget(`E:\Projects`), "windows")
	if err != nil {
		t.Fatal(err)
	}
	if folderCommand.Name != "explorer" || len(folderCommand.Args) != 1 || folderCommand.Args[0] != `E:\Projects` {
		t.Fatalf("unexpected windows folder open command: %#v", folderCommand)
	}
}

func TestEnsureReadyMigratesLegacyFlatWorkspaceToCategories(t *testing.T) {
	svc := newTestService(t)
	legacy := `{"schemaVersion":1,"dataVersion":4,"groups":[{"id":"default","name":"默认"},{"id":"work","name":"工作"}],"items":[{"id":"one","name":"Projects","path":"E:\\Projects","groupId":"work","pageOrder":3,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","createdAtMs":1,"updatedAtMs":2,"layout":{"x":2,"y":1}}],"containers":[{"id":"box","name":"Box","groupId":"work","pageOrder":4,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","createdAtMs":1,"updatedAtMs":2,"layout":{"x":4,"y":1}}],"desktop":{"iconLayout":{"rowGap":38,"columnGap":40}},"updatedAt":"2026-01-01T00:00:00Z"}`
	writeRawData(t, svc, legacy)
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.readCollections()
	if err != nil {
		t.Fatal(err)
	}
	if doc.SchemaVersion != dataSchemaVersion || doc.DataVersion != dataVersion || doc.ActiveCategoryID != defaultCategoryID || len(doc.Categories) != 3 || !sameStrings(doc.CategoryOrder, defaultViewCategoryOrder()) {
		t.Fatalf("unexpected migrated doc metadata: %#v", doc)
	}
	folder, _, err := workspaceByID(doc, "folder")
	if err != nil {
		t.Fatal(err)
	}
	if len(folder.Groups) != 2 || folder.Groups[1].ID != "work" || len(folder.Items) != 1 || len(folder.Containers) != 1 {
		t.Fatalf("legacy folder workspace was not preserved: %#v", folder)
	}
	if folder.Items[0].Target.Kind != "folder" || folder.Items[0].Target.Path != `E:\Projects` || folder.Items[0].GroupID != "work" {
		t.Fatalf("legacy item was not migrated as folder target: %#v", folder.Items[0])
	}
	if folder.Desktop.IconLayout.IconScale != defaultDesktopIconScale || folder.Desktop.IconLayout.RowGap != 38 || folder.Desktop.IconLayout.ColumnGap != 40 {
		t.Fatalf("legacy icon layout was not normalized: %#v", folder.Desktop.IconLayout)
	}
	for _, id := range []string{"url", "file"} {
		workspace, _, err := workspaceByID(doc, id)
		if err != nil {
			t.Fatal(err)
		}
		if len(workspace.Groups) != 1 || workspace.Groups[0].ID != defaultGroupID || len(workspace.Items) != 0 || len(workspace.Containers) != 0 {
			t.Fatalf("expected empty %s workspace after migration: %#v", id, workspace)
		}
	}

	state := readJSONMap(t, filepath.Join(svc.dataDir, migrationStateFile))
	applied := state["applied"].([]any)
	if len(applied) != 4 {
		t.Fatalf("expected four migration records, got %#v", applied)
	}
	entry := applied[0].(map[string]any)
	if entry["id"] != "2026-05-12-folders-data-v4-to-v5" || int(entry["fromVersion"].(float64)) != 4 || int(entry["toVersion"].(float64)) != 5 {
		t.Fatalf("unexpected migration entry: %#v", entry)
	}
	entry = applied[1].(map[string]any)
	if entry["id"] != "2026-05-15-folders-data-v5-to-v6-category-order" || int(entry["fromVersion"].(float64)) != 5 || int(entry["toVersion"].(float64)) != 6 {
		t.Fatalf("unexpected category order migration entry: %#v", entry)
	}
	entry = applied[2].(map[string]any)
	if entry["id"] != "2026-05-16-folders-data-v6-to-v7-all-view" || int(entry["fromVersion"].(float64)) != 6 || int(entry["toVersion"].(float64)) != 7 {
		t.Fatalf("unexpected all view migration entry: %#v", entry)
	}
	entry = applied[3].(map[string]any)
	if entry["id"] != "2026-05-16-folders-data-v7-to-v8-view-category-order" || int(entry["fromVersion"].(float64)) != 7 || int(entry["toVersion"].(float64)) != dataVersion {
		t.Fatalf("unexpected view category order migration entry: %#v", entry)
	}
	assertRecoveryPackageCount(t, svc, 4)
	if health := svc.health(); !health.Data.OK {
		t.Fatalf("expected healthy migrated data: %#v", health)
	}
}

func TestRunMigrationsIsIdempotent(t *testing.T) {
	svc := newTestService(t)
	legacy := `{"schemaVersion":1,"dataVersion":2,"groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38}},"updatedAt":"2026-01-01T00:00:00Z"}`
	writeRawData(t, svc, legacy)
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	state := readJSONMap(t, filepath.Join(svc.dataDir, migrationStateFile))
	if applied := state["applied"].([]any); len(applied) != 4 {
		t.Fatalf("migration should apply once, got %#v", applied)
	}
	assertRecoveryPackageCount(t, svc, 4)
}

func TestEnsureReadyRejectsNewerDataVersion(t *testing.T) {
	svc := newTestService(t)
	writeRawData(t, svc, `{"schemaVersion":1,"dataVersion":9,"activeCategoryId":"folder","categories":[],"updatedAt":"2026-01-01T00:00:00Z"}`)
	if err := svc.ensureReady(); err == nil || !strings.Contains(err.Error(), "newer than supported") {
		t.Fatalf("expected newer version error, got %v", err)
	}
}

func TestRunMigrationsRejectsLedgerAppliedWithOldData(t *testing.T) {
	svc := newTestService(t)
	legacy := `{"schemaVersion":1,"dataVersion":4,"groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":38,"columnGap":38}},"updatedAt":"2026-01-01T00:00:00Z"}`
	writeRawData(t, svc, legacy)
	if err := writeJSON(filepath.Join(svc.dataDir, migrationStateFile), map[string]any{
		"schemaVersion": 1,
		"updatedAt":     nowMS(),
		"applied": []migrationStateRecord{{
			ID:          "2026-05-12-folders-data-v4-to-v5",
			FromVersion: 4,
			ToVersion:   5,
			Description: "already applied on paper only",
			AppliedAt:   nowMS(),
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err == nil || !strings.Contains(err.Error(), "ledger says") {
		t.Fatalf("expected ledger/data mismatch error, got %v", err)
	}
}

func TestEnsureReadyNormalizesLegacyMigrationLedgerTimestamps(t *testing.T) {
	svc := newTestService(t)
	writeRawData(t, svc, `{"schemaVersion":1,"dataVersion":5,"activeCategoryId":"folder","categories":[{"id":"folder","groups":[],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":0,"columnGap":0,"iconScale":0.75}}},{"id":"url","groups":[],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":0,"columnGap":0,"iconScale":0.75}}},{"id":"file","groups":[],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":0,"columnGap":0,"iconScale":0.75}}}],"updatedAt":"2026-05-12T14:56:25Z"}`)
	legacyLedger := `{
  "schemaVersion": 1,
  "updatedAt": "2026-05-09T16:57:30Z",
  "applied": [
    {
      "id": "legacy-folders-json-to-data-json",
      "fromVersion": 0,
      "toVersion": 1,
      "description": "migrate folders app data into data.json",
      "appliedAt": "2026-05-08T06:54:04Z"
    }
  ]
}`
	if err := os.WriteFile(filepath.Join(svc.dataDir, migrationStateFile), []byte(legacyLedger), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	state := readJSONMap(t, filepath.Join(svc.dataDir, migrationStateFile))
	if _, ok := state["updatedAt"].(float64); !ok {
		t.Fatalf("expected normalized numeric updatedAt, got %#v", state["updatedAt"])
	}
	applied := state["applied"].([]any)
	record := applied[0].(map[string]any)
	if _, ok := record["appliedAt"].(float64); !ok {
		t.Fatalf("expected normalized numeric appliedAt, got %#v", record["appliedAt"])
	}
}

func TestMigrationRecoveryCopiesDirectoryContents(t *testing.T) {
	svc := newTestService(t)
	iconDir := filepath.Join(svc.dataDir, assetsDir, iconAssetsDir)
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconDir, "one.txt"), []byte("icon"), 0o644); err != nil {
		t.Fatal(err)
	}
	migration := dataMigration{
		ID:          "test recovery directory copy",
		FromVersion: 1,
		ToVersion:   dataVersion,
		Description: "test recovery directory copy",
		Recovery:    migrationRecoverySpec{AffectedPaths: []string{assetsDir}},
	}
	recoveryDir, err := svc.prepareMigrationRecovery(&migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(recoveryDir, "files", assetsDir, iconAssetsDir, "one.txt")); err != nil {
		t.Fatalf("expected nested recovery file copy: %v", err)
	}
	plan := readJSONMap(t, filepath.Join(recoveryDir, "plan.json"))
	copied := jsonStringList(t, plan["copiedPaths"])
	for _, wanted := range []string{assetsDir + "/", assetsDir + "/" + iconAssetsDir + "/", assetsDir + "/" + iconAssetsDir + "/one.txt"} {
		if !stringListContains(copied, wanted) {
			t.Fatalf("expected copiedPaths to contain %s, got %#v", wanted, copied)
		}
	}
}

func TestDefaultCollectionsDocHasIndependentWorkspaces(t *testing.T) {
	svc := readyService(t)
	doc, err := svc.readCollections()
	if err != nil {
		t.Fatal(err)
	}
	if doc.ActiveCategoryID != defaultCategoryID || len(doc.Categories) != 3 || !sameStrings(doc.CategoryOrder, defaultViewCategoryOrder()) {
		t.Fatalf("unexpected default collections doc: %#v", doc)
	}
	for _, id := range []string{"folder", "url", "file"} {
		workspace, _, err := workspaceByID(doc, id)
		if err != nil {
			t.Fatal(err)
		}
		if len(workspace.Groups) != 1 || workspace.Groups[0].ID != defaultGroupID || len(workspace.Items) != 0 || len(workspace.Containers) != 0 {
			t.Fatalf("unexpected default workspace %s: %#v", id, workspace)
		}
	}
}

func TestCollectionsItemsRoundTripAndCategoryIsolation(t *testing.T) {
	svc := readyService(t)

	folderDoc := addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "Projects", Target: folderTarget(`E:\Projects`), GroupID: defaultGroupID})
	if len(folderDoc.Items) != 1 || folderDoc.Items[0].Name != "Projects" || folderDoc.Items[0].Target.Path != `E:\Projects` {
		t.Fatalf("unexpected folder add result: %#v", folderDoc.Items)
	}

	urlDoc := addCollectionItem(t, svc, "url", collectionItem{ID: "site", Name: "Example", Target: urlTarget("https://example.com"), GroupID: defaultGroupID})
	if len(urlDoc.Items) != 1 || urlDoc.Items[0].Target.URL != "https://example.com" {
		t.Fatalf("unexpected url add result: %#v", urlDoc.Items)
	}

	folderDoc = updateCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "Code", Target: folderTarget(`E:\Code`), GroupID: defaultGroupID})
	if folderDoc.Items[0].Name != "Code" || folderDoc.Items[0].Target.Path != `E:\Code` {
		t.Fatalf("unexpected update result: %#v", folderDoc.Items[0])
	}

	urlDoc, err := svc.readWorkspaceView("url")
	if err != nil {
		t.Fatal(err)
	}
	if len(urlDoc.Items) != 1 || urlDoc.Items[0].ID != "site" {
		t.Fatalf("url workspace should be isolated from folder updates: %#v", urlDoc.Items)
	}

	folderDoc, err = svc.removeItem("folder", "one")
	if err != nil {
		t.Fatal(err)
	}
	if len(folderDoc.Items) != 0 {
		t.Fatalf("expected empty folder items, got %#v", folderDoc.Items)
	}
}

func TestDesktopLayoutRoundTrip(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID})

	doc, err := svc.saveCollectionDesktopLayouts(categoryDesktopLayoutSavePayload{CategoryID: "folder", GroupID: defaultGroupID, Items: []desktopLayoutPatch{
		{Kind: "item", ID: "one", Layout: folderGridLayout{X: 2, Y: 1}},
		{Kind: "container", ID: "box", Layout: folderGridLayout{X: -2, Y: 3000}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if itemByID(doc, "one").Layout == nil || itemByID(doc, "one").Layout.X != 2 || itemByID(doc, "one").Layout.Y != 1 {
		t.Fatalf("unexpected item layout: %#v", itemByID(doc, "one").Layout)
	}
	if doc.Containers[0].Layout == nil || doc.Containers[0].Layout.X != 0 || doc.Containers[0].Layout.Y != maxLayoutCoord {
		t.Fatalf("unexpected container layout: %#v", doc.Containers[0].Layout)
	}
	doc = updateCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One Renamed", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	if itemByID(doc, "one").Layout == nil || itemByID(doc, "one").Layout.X != 2 || itemByID(doc, "one").Layout.Y != 1 {
		t.Fatalf("item update should preserve desktop layout: %#v", itemByID(doc, "one").Layout)
	}
}

func TestDesktopContainerRoundTrip(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID})
	doc := addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID})
	if len(doc.Containers) != 1 || doc.Containers[0].ID != "box" {
		t.Fatalf("unexpected container add: %#v", doc.Containers)
	}
	doc = saveCollectionItemContainer(t, svc, "folder", []string{"one"}, "box")
	if containerIDByItem(doc, "one") != "box" || containerIDByItem(doc, "two") != "" {
		t.Fatalf("unexpected item containers: %#v", doc.Items)
	}
	doc, err := svc.removeCollectionContainer("folder", "box")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 0 || containerIDByItem(doc, "one") != "" {
		t.Fatalf("expected removed container to release items: %#v", doc)
	}
}

func TestCreateContainerFromItemsRoundTrip(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID, Layout: &folderGridLayout{X: 2, Y: 0}})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID, Layout: &folderGridLayout{X: 4, Y: 0}})

	doc, err := svc.createCollectionContainerFromItems(categoryCreateContainerFromItemsPayload{CategoryID: "folder", SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{X: 4, Y: 0}})
	if err != nil {
		t.Fatal(err)
	}
	assertCreatedContainerFromItems(t, doc, "one", "two", 4)
	if _, err := svc.createCollectionContainerFromItems(categoryCreateContainerFromItemsPayload{CategoryID: "folder", SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{}}); err == nil {
		t.Fatal("expected contained target item to be rejected")
	}
}

func TestCreateContainerFromExtractedSourceItem(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID, Layout: &folderGridLayout{X: 3, Y: 0}})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID})
	saveCollectionItemContainer(t, svc, "folder", []string{"one"}, "box")
	placeCollectionContainerItems(t, svc, "folder", categoryContainerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}}})

	doc, err := svc.createCollectionContainerFromItems(categoryCreateContainerFromItemsPayload{CategoryID: "folder", SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{X: 3, Y: 0}})
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
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "新建收纳夹（1）", GroupID: defaultGroupID})
	doc, err := svc.createCollectionContainerFromItems(categoryCreateContainerFromItemsPayload{CategoryID: "folder", SourceItemID: "one", TargetItemID: "two", Layout: folderGridLayout{X: 1, Y: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Containers) != 2 || doc.Containers[0].Name != "新建收纳夹（2）" {
		t.Fatalf("expected next container name, got %#v", doc.Containers)
	}
}

func TestContainerItemsPlacementRoundTrip(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID})
	saveCollectionItemContainer(t, svc, "folder", []string{"one"}, "box")

	doc := placeCollectionContainerItems(t, svc, "folder", categoryContainerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 2, Y: 1}}}})
	if containerLayoutByItem(doc, "one") == nil || containerLayoutByItem(doc, "one").X != 2 || containerLayoutByItem(doc, "one").Y != 1 {
		t.Fatalf("unexpected container layout: %#v", itemByID(doc, "one"))
	}

	doc = placeCollectionContainerItems(t, svc, "folder", categoryContainerItemsPlacement{ContainerID: "box", MovedID: "two", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}, {ID: "two", Layout: folderGridLayout{X: 1, Y: 0}}}})
	if containerIDByItem(doc, "two") != "box" || containerLayoutByItem(doc, "two") == nil || containerLayoutByItem(doc, "two").X != 1 {
		t.Fatalf("expected moved item to be placed atomically: %#v", itemByID(doc, "two"))
	}
	if _, err := svc.placeCollectionContainerItems(categoryContainerItemsPlacement{CategoryID: "folder", ContainerID: "box", Items: []containerLayoutPatch{{ID: "missing", Layout: folderGridLayout{}}}}); err == nil {
		t.Fatal("expected missing item placement to fail")
	}
	doc = saveCollectionItemContainer(t, svc, "folder", []string{"one"}, "")
	if containerLayoutByItem(doc, "one") != nil {
		t.Fatalf("expected moving out to clear container layout: %#v", itemByID(doc, "one"))
	}
}

func TestExtractContainerItemToDesktopRoundTrip(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID, Layout: &folderGridLayout{X: 1, Y: 0}})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID, Layout: &folderGridLayout{X: 0, Y: 0}})
	saveCollectionItemContainer(t, svc, "folder", []string{"one"}, "box")
	placeCollectionContainerItems(t, svc, "folder", categoryContainerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}}})

	doc, err := svc.extractCollectionContainerItemToDesktop(categoryExtractContainerItemToDesktopPayload{CategoryID: "folder", ContainerID: "box", ItemID: "one", Items: []desktopLayoutPatch{{Kind: "item", ID: "one", Layout: folderGridLayout{X: 2, Y: 1}}, {Kind: "item", ID: "two", Layout: folderGridLayout{X: 3, Y: 1}}, {Kind: "container", ID: "box", Layout: folderGridLayout{X: 0, Y: 2}}}})
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
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	addCollectionItem(t, svc, "folder", collectionItem{ID: "two", Name: "Two", Target: folderTarget(`E:\Two`), GroupID: defaultGroupID})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: defaultGroupID})
	saveCollectionItemContainer(t, svc, "folder", []string{"one", "two"}, "box")

	if _, err := svc.extractCollectionContainerItemToDesktop(categoryExtractContainerItemToDesktopPayload{CategoryID: "folder", ContainerID: "box", ItemID: "one", Items: []desktopLayoutPatch{{Kind: "item", ID: "two", Layout: folderGridLayout{X: 1, Y: 0}}}}); err == nil {
		t.Fatal("expected missing moved item layout to fail")
	}
	if _, err := svc.extractCollectionContainerItemToDesktop(categoryExtractContainerItemToDesktopPayload{CategoryID: "folder", ContainerID: "box", ItemID: "one", Items: []desktopLayoutPatch{{Kind: "item", ID: "one", Layout: folderGridLayout{X: 1, Y: 0}}, {Kind: "item", ID: "two", Layout: folderGridLayout{X: 2, Y: 0}}}}); err == nil || !strings.Contains(err.Error(), "item is not on desktop") {
		t.Fatalf("expected contained sibling desktop layout to fail, got %v", err)
	}
	if _, err := svc.extractCollectionContainerItemToDesktop(categoryExtractContainerItemToDesktopPayload{CategoryID: "folder", ContainerID: "box", ItemID: "missing", Items: []desktopLayoutPatch{{Kind: "item", ID: "missing", Layout: folderGridLayout{X: 1, Y: 0}}}}); err == nil || !strings.Contains(err.Error(), "item not found") {
		t.Fatalf("expected missing item to fail, got %v", err)
	}
}

func TestDesktopIconRoundTrip(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID})
	doc, err := svc.saveCollectionItemIcon("folder", "one", &desktopIcon{Kind: "color", Color: "#8fa99b"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Icon == nil || doc.Items[0].Icon.Color != "#8FA99B" {
		t.Fatalf("unexpected item icon: %#v", doc.Items[0].Icon)
	}
	if _, err := svc.saveCollectionItemIcon("folder", "missing", &desktopIcon{Kind: "color", Color: "#8FA6B8"}); err == nil {
		t.Fatal("expected missing item icon customization to fail")
	}
	if _, err := svc.saveCollectionItemIcon("folder", "one", &desktopIcon{Kind: "color", Color: "#FF0000"}); err == nil {
		t.Fatal("expected unsupported icon color to fail")
	}
}

func TestItemUpdateInputClearsIconWhenIconIsExplicitNull(t *testing.T) {
	svc := readyService(t)
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "One", Target: folderTarget(`E:\One`), GroupID: defaultGroupID, Icon: &desktopIcon{Kind: "color", Color: "#8FA99B"}})

	payload := []byte(`{"id":"one","name":"One","target":{"kind":"folder","path":"E:\\One"},"groupId":"default","pageOrder":0,"createdAt":"","updatedAt":"","createdAtMs":1,"updatedAtMs":1,"icon":null}`)
	var input collectionItemInput
	if err := json.Unmarshal(payload, &input); err != nil {
		t.Fatal(err)
	}
	if !input.IconSet || input.Icon != nil {
		t.Fatalf("expected explicit null icon to be tracked, got iconSet=%v icon=%#v", input.IconSet, input.Icon)
	}
	doc, err := svc.updateItemInput("folder", input)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Items[0].Icon != nil {
		t.Fatalf("expected icon to be cleared, got %#v", doc.Items[0].Icon)
	}
}

func TestDesktopWallpaperRoundTrip(t *testing.T) {
	svc := readyService(t)
	wallpaperAsset := wallpaperAssetsDir + "/0123456789abcdef0123456789abcdef01234567.png"
	iconAsset := iconAssetsDir + "/0123456789abcdef0123456789abcdef01234567.png"

	doc, err := svc.saveCollectionDesktopWallpaper("folder", wallpaperWithPreset("main", wallpaperAsset, desktopWallpaperView{X: 40.123, Y: 60.456, Scale: 1.234}))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.Wallpaper == nil || doc.Desktop.Wallpaper.ActiveID != "main" || len(doc.Desktop.Wallpaper.Presets) != 1 {
		t.Fatalf("unexpected wallpaper: %#v", doc.Desktop.Wallpaper)
	}
	if doc.Desktop.Wallpaper.Presets[0].AssetID != wallpaperAsset || doc.Desktop.Wallpaper.Presets[0].View.Scale != 1.23 {
		t.Fatalf("unexpected wallpaper preset normalization: %#v", doc.Desktop.Wallpaper.Presets[0])
	}
	if _, err := svc.saveCollectionDesktopWallpaper("folder", wallpaperWithPreset("bad", iconAsset, desktopWallpaperView{X: 50, Y: 50, Scale: 1})); err == nil {
		t.Fatal("expected icon asset id to fail for wallpaper")
	}
	missingActive := wallpaperWithPreset("main", wallpaperAsset, desktopWallpaperView{X: 50, Y: 50, Scale: 1})
	missingActive.ActiveID = "missing"
	if _, err := svc.saveCollectionDesktopWallpaper("folder", missingActive); err == nil {
		t.Fatal("expected missing active wallpaper preset to fail")
	}
	if _, err := svc.saveCollectionDesktopWallpaper("folder", wallpaperWithPreset("main", wallpaperAsset, desktopWallpaperView{X: -1, Y: 50, Scale: 1})); err == nil {
		t.Fatal("expected invalid wallpaper view to fail")
	}
	doc, err = svc.saveCollectionDesktopWallpaper("folder", nil)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.Wallpaper != nil {
		t.Fatalf("expected wallpaper to be cleared: %#v", doc.Desktop.Wallpaper)
	}
}

func TestDesktopWallpaperDeckIncludesAllCategories(t *testing.T) {
	svc := readyService(t)
	folderAsset := wallpaperAssetsDir + "/0123456789abcdef0123456789abcdef01234567.png"
	urlAsset := wallpaperAssetsDir + "/fedcba9876543210fedcba9876543210fedcba98.png"

	if _, err := svc.saveCollectionDesktopWallpaper("folder", wallpaperWithPreset("folder-main", folderAsset, desktopWallpaperView{X: 50, Y: 50, Scale: 1})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.saveCollectionDesktopWallpaper("url", wallpaperWithPreset("url-main", urlAsset, desktopWallpaperView{X: 40, Y: 60, Scale: 1.2})); err != nil {
		t.Fatal(err)
	}

	deck, err := svc.readDesktopWallpaperDeck()
	if err != nil {
		t.Fatal(err)
	}
	if deck.SchemaVersion != dataSchemaVersion || deck.DataVersion != dataVersion || len(deck.Categories) != 4 {
		t.Fatalf("unexpected wallpaper deck metadata: %#v", deck)
	}
	wallpapers := map[string]*desktopWallpaper{}
	for _, category := range deck.Categories {
		wallpapers[category.CategoryID] = category.Wallpaper
	}
	if wallpapers["folder"] == nil || wallpapers["folder"].ActiveID != "folder-main" {
		t.Fatalf("expected folder wallpaper in deck: %#v", wallpapers["folder"])
	}
	if wallpapers["url"] == nil || wallpapers["url"].ActiveID != "url-main" {
		t.Fatalf("expected url wallpaper in deck: %#v", wallpapers["url"])
	}
	if wallpapers["file"] != nil {
		t.Fatalf("expected empty file wallpaper: %#v", wallpapers["file"])
	}
}

func TestDesktopIconLayoutRoundTrip(t *testing.T) {
	svc := readyService(t)
	doc, err := svc.readWorkspaceView("folder")
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.IconLayout.RowGap != defaultDesktopIconGap || doc.Desktop.IconLayout.ColumnGap != defaultDesktopIconGap || doc.Desktop.IconLayout.IconScale != defaultDesktopIconScale {
		t.Fatalf("expected default desktop icon layout: %#v", doc.Desktop.IconLayout)
	}

	doc, err = svc.saveCollectionDesktopIconLayout("folder", desktopIconLayout{RowGap: 52, ColumnGap: 64, IconScale: 1.2})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Desktop.IconLayout.RowGap != 52 || doc.Desktop.IconLayout.ColumnGap != 64 || doc.Desktop.IconLayout.IconScale != 1.2 {
		t.Fatalf("unexpected desktop icon layout: %#v", doc.Desktop.IconLayout)
	}
	if _, err := svc.saveCollectionDesktopIconLayout("folder", desktopIconLayout{RowGap: -2, ColumnGap: 38, IconScale: 1}); err == nil {
		t.Fatal("expected negative row gap to fail")
	}
	if _, err := svc.saveCollectionDesktopIconLayout("folder", desktopIconLayout{RowGap: 38, ColumnGap: 80, IconScale: 1}); err == nil {
		t.Fatal("expected too large column gap to fail")
	}
	if _, err := svc.saveCollectionDesktopIconLayout("folder", desktopIconLayout{RowGap: 38, ColumnGap: 38, IconScale: 2}); err == nil {
		t.Fatal("expected too large icon scale to fail")
	}
}

func TestInvalidPersistedDataIsDiagnosedAfterStartup(t *testing.T) {
	svc := newTestService(t)
	doc := defaultCollectionsDoc()
	doc.Categories[0].Desktop.IconLayout.RowGap = -2
	writeRawDoc(t, svc, doc)
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readCollections(); err == nil || !strings.Contains(err.Error(), "desktop icon row gap") {
		t.Fatalf("expected row gap read error, got %v", err)
	}
	if health := svc.health(); health.Data.OK || !strings.Contains(health.Data.Error, "desktop icon row gap") {
		t.Fatalf("expected row gap health error, got %#v", health)
	}
}

func TestMissingCurrentBaselineFieldIsDiagnosedAfterStartup(t *testing.T) {
	svc := newTestService(t)
	missingAllView := `{"schemaVersion":1,"dataVersion":8,"activeCategoryId":"folder","categoryOrder":["all","folder","url","file"],"categories":[{"id":"folder","groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":0,"columnGap":0,"iconScale":0.75}}},{"id":"url","groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":0,"columnGap":0,"iconScale":0.75}}},{"id":"file","groups":[{"id":"default","name":"默认"}],"items":[],"containers":[],"desktop":{"iconLayout":{"rowGap":0,"columnGap":0,"iconScale":0.75}}}],"updatedAt":"2026-01-01T00:00:00Z"}`
	writeRawData(t, svc, missingAllView)
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.readCollections(); err == nil || !strings.Contains(err.Error(), "allView") {
		t.Fatalf("expected missing all view read error, got %v", err)
	}
	if health := svc.health(); health.Data.OK || !strings.Contains(health.Data.Error, "allView") {
		t.Fatalf("expected missing all view health error, got %#v", health)
	}
}

func TestCategoryOrderSavePersistsAndOrdersWorkspaces(t *testing.T) {
	svc := readyService(t)

	doc, err := svc.saveCategoryOrder([]string{"url", "all", "file", "folder"}, "all")
	if err != nil {
		t.Fatal(err)
	}
	if !sameStrings(doc.CategoryOrder, []string{"url", "all", "file", "folder"}) {
		t.Fatalf("unexpected workspace view category order: %#v", doc.CategoryOrder)
	}
	persisted, err := svc.readCollections()
	if err != nil {
		t.Fatal(err)
	}
	if !sameStrings(persisted.CategoryOrder, []string{"url", "all", "file", "folder"}) {
		t.Fatalf("unexpected persisted category order: %#v", persisted.CategoryOrder)
	}
	if got := []string{persisted.Categories[0].ID, persisted.Categories[1].ID, persisted.Categories[2].ID}; !sameStrings(got, []string{"url", "file", "folder"}) {
		t.Fatalf("expected categories to follow categoryOrder, got categories=%#v order=%#v", got, persisted.CategoryOrder)
	}
	folderDoc, err := svc.saveCategoryOrder([]string{"all", "url", "file", "folder"}, "folder")
	if err != nil {
		t.Fatal(err)
	}
	persisted, err = svc.readCollections()
	if err != nil {
		t.Fatal(err)
	}
	if folderDoc.ID != "folder" || persisted.ActiveCategoryID != defaultCategoryID {
		t.Fatalf("expected explicit active category to control returned view, got doc=%#v persisted=%#v", folderDoc.ID, persisted.ActiveCategoryID)
	}
	if _, err := svc.saveCategoryOrder([]string{"url", "url", "file", "folder"}, "all"); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate category order error, got %v", err)
	}
	if _, err := svc.saveCategoryOrder([]string{"url", "all", "file", "folder"}, ""); err == nil || !strings.Contains(err.Error(), "invalid active category") {
		t.Fatalf("expected invalid active category error, got %v", err)
	}
}

func TestCurrentBaselineRejectsInvalidReferencesAndDuplicates(t *testing.T) {
	svc := readyService(t)

	invalidContainerRef := defaultCollectionsDoc()
	invalidContainerRef.Categories[0].Items = []collectionItem{{ID: "one", Name: "One", Target: folderTarget("E:/One"), GroupID: defaultGroupID, ContainerID: "missing", CreatedAtMS: 1, UpdatedAtMS: 1}}
	writeRawDoc(t, svc, invalidContainerRef)
	if _, err := svc.readCollections(); err == nil || !strings.Contains(err.Error(), "container not found") {
		t.Fatalf("expected missing container error, got %v", err)
	}

	duplicateItem := defaultCollectionsDoc()
	duplicateItem.Categories[0].Items = []collectionItem{{ID: "one", Name: "One", Target: folderTarget("E:/One"), GroupID: defaultGroupID, CreatedAtMS: 1, UpdatedAtMS: 1}, {ID: "one", Name: "Two", Target: folderTarget("E:/Two"), GroupID: defaultGroupID, CreatedAtMS: 2, UpdatedAtMS: 2}}
	writeRawDoc(t, svc, duplicateItem)
	if _, err := svc.readCollections(); err == nil || !strings.Contains(err.Error(), "duplicate item id") {
		t.Fatalf("expected duplicate item error, got %v", err)
	}

	invalidLayout := defaultCollectionsDoc()
	invalidLayout.Categories[0].Items = []collectionItem{{ID: "one", Name: "One", Target: folderTarget("E:/One"), GroupID: defaultGroupID, CreatedAtMS: 1, UpdatedAtMS: 1, Layout: &folderGridLayout{X: -1, Y: 0}}}
	writeRawDoc(t, svc, invalidLayout)
	if _, err := svc.readCollections(); err == nil || !strings.Contains(err.Error(), "layout x") {
		t.Fatalf("expected invalid layout error, got %v", err)
	}
}

func TestImportAssetCopiesImagesAndRejectsInvalidContent(t *testing.T) {
	svc := readyService(t)
	sourcePath := filepath.Join(t.TempDir(), "icon.png")
	if err := os.WriteFile(sourcePath, mustTinyPNG(t), 0o644); err != nil {
		t.Fatal(err)
	}
	asset, err := svc.importAsset("icon", sourcePath, "")
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
	if _, err := svc.importAsset("icon", badPath, ""); err == nil {
		t.Fatal("expected invalid image content to fail")
	}
	wallpaper, err := svc.importAsset("wallpaper", sourcePath, "")
	if err != nil {
		t.Fatal(err)
	}
	if wallpaper.Kind != "wallpaper" || !strings.HasPrefix(wallpaper.ID, wallpaperAssetsDir+"/") {
		t.Fatalf("unexpected wallpaper asset: %#v", wallpaper)
	}
}

func TestImportAssetAcceptsDataURLAsFirstClassSource(t *testing.T) {
	svc := readyService(t)
	payload := mustTinyPNG(t)
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)

	asset, err := svc.importAsset("icon", "", dataURL)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Kind != "icon" || !strings.HasPrefix(asset.ID, iconAssetsDir+"/") || !strings.HasSuffix(asset.ID, ".png") {
		t.Fatalf("unexpected data URL asset: %#v", asset)
	}
	targetPath, err := svc.assetPath(asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != string(payload) {
		t.Fatal("expected stored asset to match decoded data URL payload")
	}
	if _, err := svc.importAsset("icon", "", "data:text/plain;base64,Zm9v"); err == nil {
		t.Fatal("expected non-image data URL to fail")
	}
	if _, err := svc.importAsset("icon", targetPath, dataURL); err == nil {
		t.Fatal("expected mixed asset sources to fail")
	}
}

func TestWebIconDiscoveryReturnsMultipleLocalizableCandidates(t *testing.T) {
	png := mustTinyPNG(t)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#8FA99B"/></svg>`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, `<html><head><link rel="icon" sizes="16x16" href="/favicon.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png"><link rel="manifest" href="/manifest.json"></head></html>`)
		case "/favicon.png", "/apple.png", "/manifest-icon.png", "/favicon.ico":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		case "/manifest-vector.svg":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write(svg)
		case "/manifest.json":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"icons":[{"src":"/manifest-icon.png","sizes":"512x512","type":"image/png"},{"src":"/manifest-vector.svg","sizes":"64x64","type":"image/svg+xml"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := discoverWebIcons(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Candidates) != 2 {
		t.Fatalf("expected two distinct icon candidates after duplicate payload dedupe, got %#v", result.Candidates)
	}
	mediaTypes := map[string]bool{}
	for _, candidate := range result.Candidates {
		if candidate.DataURL == "" || !strings.HasPrefix(candidate.DataURL, "data:image/") {
			t.Fatalf("expected localizable data URL candidate, got %#v", candidate)
		}
		if candidate.URL == "" || candidate.Source == "" {
			t.Fatalf("expected candidate provenance, got %#v", candidate)
		}
		mediaTypes[candidate.MediaType] = true
	}
	if !mediaTypes["image/png"] || !mediaTypes["image/svg+xml"] {
		t.Fatalf("expected png and svg candidates, got %#v", result.Candidates)
	}
}

func TestWebIconDiscoveryReportsCandidatesAsTheyAreFetched(t *testing.T) {
	png := mustTinyPNG(t)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#8FA99B"/></svg>`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, `<html><head><link rel="icon" sizes="16x16" href="/favicon.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple.svg"></head></html>`)
		case "/favicon.png", "/favicon.ico":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		case "/apple.svg":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write(svg)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	progressCandidates := []webIconCandidate{}
	result, err := discoverWebIconsWithProgress(context.Background(), server.URL, func(candidate webIconCandidate) (webIconCandidate, error) {
		if candidate.DataURL == "" {
			t.Fatal("expected progress candidate to be immediately localizable")
		}
		progressCandidates = append(progressCandidates, candidate)
		return candidate, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(progressCandidates) != len(result.Candidates) {
		t.Fatalf("expected every final candidate to be reported as progress, progress=%d final=%d", len(progressCandidates), len(result.Candidates))
	}
	for index, candidate := range result.Candidates {
		if progressCandidates[index].ID != candidate.ID {
			t.Fatalf("progress candidate order should match final result, progress=%#v final=%#v", progressCandidates, result.Candidates)
		}
	}
}

func TestWebIconDiscoveryReturnsImportantLogoAndAvatarCandidates(t *testing.T) {
	png := mustTinyPNG(t)
	logoSVG := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="44" fill="#0EA5E9"/></svg>`)
	inlineSVG := []byte(`<svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#7C3AED"/></svg>`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, `<html><body><header><img class="site-logo" alt="Example Logo" src="/brand-logo.svg">%s</header><main><img class="channel-avatar" alt="Creator Avatar" srcset="/avatar-small.png 64w, /avatar-large.png 128w"></main></body></html>`, inlineSVG)
		case "/brand-logo.svg":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write(logoSVG)
		case "/avatar-small.png", "/avatar-large.png", "/favicon.ico":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := discoverWebIcons(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	sources := map[string]bool{}
	for _, candidate := range result.Candidates {
		if candidate.DataURL == "" || !strings.HasPrefix(candidate.DataURL, "data:image/") {
			t.Fatalf("expected localizable important candidate, got %#v", candidate)
		}
		sources[candidate.Source] = true
	}
	for _, source := range []string{"inline-svg", "brand-logo", "avatar"} {
		if !sources[source] {
			t.Fatalf("expected %s candidate, got %#v", source, result.Candidates)
		}
	}
}

func TestSelectedWebIconCandidateCanBeImportedAsLocalAsset(t *testing.T) {
	svc := readyService(t)
	png := mustTinyPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintf(w, `<link rel="icon" sizes="16x16" href="/favicon.png">`)
		case "/favicon.png", "/favicon.ico":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := discoverWebIcons(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := svc.importAsset("icon", "", result.Candidates[0].DataURL)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Kind != "icon" || !strings.HasPrefix(asset.ID, iconAssetsDir+"/") {
		t.Fatalf("unexpected web icon asset: %#v", asset)
	}
	stored, err := os.ReadFile(filepath.Join(svc.dataDir, assetsDir, filepath.FromSlash(asset.ID)))
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != string(png) {
		t.Fatal("expected selected web icon bytes to be stored locally")
	}
}

func TestWebIconDiscoveryProgressReturnsStoredAssets(t *testing.T) {
	svc := readyService(t)
	png := mustTinyPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintf(w, `<link rel="icon" sizes="16x16" href="/favicon.png">`)
		case "/favicon.png", "/favicon.ico":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	progressCandidates := []webIconCandidate{}
	result, err := discoverWebIconsWithProgress(context.Background(), server.URL, func(candidate webIconCandidate) (webIconCandidate, error) {
		asset, err := svc.importWebIconCandidate(candidate)
		if err != nil {
			return webIconCandidate{}, err
		}
		candidate.AssetID = asset.ID
		candidate.DataURL = ""
		stored, err := os.ReadFile(filepath.Join(svc.dataDir, assetsDir, filepath.FromSlash(candidate.AssetID)))
		if err != nil {
			return webIconCandidate{}, err
		}
		if string(stored) != string(png) {
			return webIconCandidate{}, fmt.Errorf("progress asset bytes were not stored before reporting")
		}
		progressCandidates = append(progressCandidates, candidate)
		return candidate, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(progressCandidates) == 0 {
		t.Fatal("expected at least one stored progress candidate")
	}
	if result.Candidates[0].AssetID == "" || result.Candidates[0].DataURL != "" {
		t.Fatalf("expected final web icon candidate to reference stored asset only, got %#v", result.Candidates[0])
	}
}

func TestWallpaperImportHasNoFileSizeLimit(t *testing.T) {
	svc := readyService(t)
	largeImage := append(mustTinyPNG(t), make([]byte, maxIconAssetBytes+1)...)
	sourcePath := filepath.Join(t.TempDir(), "large-wallpaper.png")
	if err := os.WriteFile(sourcePath, largeImage, 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.importAsset("icon", sourcePath, ""); err == nil {
		t.Fatal("expected oversized icon asset to fail")
	}
	wallpaper, err := svc.importAsset("wallpaper", sourcePath, "")
	if err != nil {
		t.Fatal(err)
	}
	if wallpaper.Kind != "wallpaper" || !strings.HasPrefix(wallpaper.ID, wallpaperAssetsDir+"/") {
		t.Fatalf("unexpected wallpaper asset: %#v", wallpaper)
	}
}

func TestCollectionItemValidationRequiresTargetAndValidGroup(t *testing.T) {
	svc := readyService(t)
	if _, err := svc.addItem("folder", collectionItem{ID: "one", Name: "Projects", Target: collectionTarget{Kind: "folder"}, GroupID: defaultGroupID}); err == nil {
		t.Fatal("expected missing folder path to fail")
	}
	if _, err := svc.addItem("folder", collectionItem{ID: "one", Name: "Projects", Target: folderTarget(`E:\Projects`), GroupID: "missing"}); err == nil {
		t.Fatal("expected missing group to fail")
	}
	if _, err := svc.addItem("url", collectionItem{ID: "site", Name: "Bad", Target: collectionTarget{Kind: "url", URL: "ftp://example.com"}, GroupID: defaultGroupID}); err == nil {
		t.Fatal("expected unsupported url protocol to fail")
	}
	if _, err := svc.addItem("folder", collectionItem{ID: "site", Name: "Wrong", Target: urlTarget("https://example.com"), GroupID: defaultGroupID}); err == nil {
		t.Fatal("expected category and target mismatch to fail")
	}
}

func TestGroupsRoundTripAndDeleteMovesItemsToRemainingGroup(t *testing.T) {
	svc := readyService(t)
	doc, err := svc.addCollectionGroup("folder", collectionGroup{ID: "work", Name: "工作"})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 2 {
		t.Fatalf("expected group added: %#v", doc.Groups)
	}
	doc = addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "Projects", Target: folderTarget(`E:\Projects`), GroupID: "work"})
	doc, err = svc.updateCollectionGroup("folder", collectionGroup{ID: "work", Name: "项目"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Groups[1].Name != "项目" {
		t.Fatalf("expected group rename: %#v", doc.Groups[1])
	}
	doc, err = svc.removeCollectionGroup("folder", "work")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 1 || itemByID(doc, "one").GroupID != defaultGroupID {
		t.Fatalf("expected item moved to default: %#v", doc)
	}
	doc, err = svc.addCollectionGroup("folder", collectionGroup{ID: "archive", Name: "归档"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err = svc.removeCollectionGroup("folder", defaultGroupID)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 1 || doc.Groups[0].ID != "archive" || itemByID(doc, "one").GroupID != "archive" {
		t.Fatalf("expected default group to be removable and item moved to remaining group: %#v", doc)
	}
}

func TestRemovingLastGroupAllowsOnlyEmptyWorkspace(t *testing.T) {
	svc := readyService(t)

	if _, err := svc.removeCollectionGroup("folder", defaultGroupID); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.readWorkspaceView("folder")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 0 {
		t.Fatalf("expected empty workspace to allow removing the last group: %#v", doc.Groups)
	}

	doc, err = svc.addCollectionGroup("folder", collectionGroup{ID: "work", Name: "工作"})
	if err != nil {
		t.Fatal(err)
	}
	doc = addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "Projects", Target: folderTarget(`E:\Projects`), GroupID: "work"})
	if _, err := svc.removeCollectionGroup("folder", "work"); err == nil {
		t.Fatal("expected removing the last non-empty group to fail")
	}
}

func TestGroupIDGenerationDoesNotDependOnDisplayName(t *testing.T) {
	svc := readyService(t)
	doc, err := svc.addCollectionGroup("folder", collectionGroup{Name: "项目资料"})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 2 || doc.Groups[1].Name != "项目资料" || doc.Groups[1].ID == "" {
		t.Fatalf("expected generated group id with preserved display name: %#v", doc.Groups)
	}
	if strings.Contains(doc.Groups[1].ID, "项目") || len(doc.Groups[1].ID) > 32 {
		t.Fatalf("expected safe generated group id, got %q", doc.Groups[1].ID)
	}
	doc, err = svc.addCollectionGroup("folder", collectionGroup{ID: "another-project", Name: "项目资料"})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 3 || doc.Groups[1].Name != doc.Groups[2].Name || doc.Groups[1].ID == doc.Groups[2].ID {
		t.Fatalf("expected group identity to be independent from display name: %#v", doc.Groups)
	}
}

func TestGroupOrderSavePersistsExactWorkspaceOrder(t *testing.T) {
	svc := readyService(t)
	if _, err := svc.addCollectionGroup("folder", collectionGroup{ID: "work", Name: "工作"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addCollectionGroup("folder", collectionGroup{ID: "design", Name: "设计"}); err != nil {
		t.Fatal(err)
	}

	doc, err := svc.saveCollectionGroupOrder("folder", []string{"design", defaultGroupID, "work"})
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{doc.Groups[0].ID, doc.Groups[1].ID, doc.Groups[2].ID}; !sameStrings(got, []string{"design", defaultGroupID, "work"}) {
		t.Fatalf("unexpected workspace view group order: %#v", got)
	}
	persisted, err := svc.readCollections()
	if err != nil {
		t.Fatal(err)
	}
	workspace, _, err := workspaceByID(persisted, "folder")
	if err != nil {
		t.Fatal(err)
	}
	if got := []string{workspace.Groups[0].ID, workspace.Groups[1].ID, workspace.Groups[2].ID}; !sameStrings(got, []string{"design", defaultGroupID, "work"}) {
		t.Fatalf("unexpected persisted group order: %#v", got)
	}
	if _, err := svc.saveCollectionGroupOrder("folder", []string{"design", "design", "work"}); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate group order error, got %v", err)
	}
	if _, err := svc.saveCollectionGroupOrder("folder", []string{"design", defaultGroupID}); err == nil || !strings.Contains(err.Error(), "every group") {
		t.Fatalf("expected missing group order error, got %v", err)
	}
}

func TestItemGroupTransferUsesSingleOwnership(t *testing.T) {
	svc := readyService(t)
	if _, err := svc.addCollectionGroup("folder", collectionGroup{ID: "work", Name: "工作"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addCollectionGroup("folder", collectionGroup{ID: "design", Name: "设计"}); err != nil {
		t.Fatal(err)
	}
	doc := addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "Projects", Target: folderTarget(`E:\Projects`), GroupID: defaultGroupID, Layout: &folderGridLayout{X: 2, Y: 0}})
	doc, err := svc.moveItemToGroup(itemGroupTransferPayload{CategoryID: "folder", ID: "one", GroupID: "work"})
	if err != nil {
		t.Fatal(err)
	}
	if itemByID(doc, "one").GroupID != "work" || itemByID(doc, "one").Layout != nil {
		t.Fatalf("expected moved item to have single work ownership and cleared desktop layout: %#v", itemByID(doc, "one"))
	}
	doc, err = svc.copyItemToGroup(itemGroupTransferPayload{CategoryID: "folder", ID: "one", GroupID: "design"})
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 2 {
		t.Fatalf("expected copied item to create an independent item: %#v", doc.Items)
	}
	var copied *collectionItem
	for i := range doc.Items {
		if doc.Items[i].ID != "one" {
			copied = &doc.Items[i]
		}
	}
	if copied == nil || copied.GroupID != "design" || copied.ContainerID != "" || copied.Layout != nil || copied.ContainerLayout != nil {
		t.Fatalf("expected copied item to have isolated design ownership: %#v", copied)
	}
	if _, err := svc.copyItemToGroup(itemGroupTransferPayload{CategoryID: "folder", ID: "one", GroupID: "work"}); err == nil {
		t.Fatal("expected copying to the same group to fail")
	}
}

func TestRemovingGroupMovesDesktopObjectsToFirstRemainingGroup(t *testing.T) {
	svc := readyService(t)
	if _, err := svc.addCollectionGroup("folder", collectionGroup{ID: "work", Name: "工作"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.addCollectionGroup("folder", collectionGroup{ID: "design", Name: "设计"}); err != nil {
		t.Fatal(err)
	}
	addCollectionItem(t, svc, "folder", collectionItem{ID: "one", Name: "Projects", Target: folderTarget(`E:\Projects`), GroupID: "work", Layout: &folderGridLayout{X: 1, Y: 0}})
	addCollectionContainer(t, svc, "folder", desktopContainer{ID: "box", Name: "Box", GroupID: "work", Layout: &folderGridLayout{X: 2, Y: 0}})
	saveCollectionItemContainer(t, svc, "folder", []string{"one"}, "box")
	placeCollectionContainerItems(t, svc, "folder", categoryContainerItemsPlacement{ContainerID: "box", Items: []containerLayoutPatch{{ID: "one", Layout: folderGridLayout{X: 0, Y: 0}}}})
	doc, err := svc.removeCollectionGroup("folder", "work")
	if err != nil {
		t.Fatal(err)
	}
	if itemByID(doc, "one").GroupID != defaultGroupID || itemByID(doc, "one").ContainerID != "" || itemByID(doc, "one").ContainerLayout != nil || itemByID(doc, "one").Layout != nil {
		t.Fatalf("expected removed group item to return to first remaining desktop cleanly: %#v", itemByID(doc, "one"))
	}
	if doc.Containers[0].GroupID != defaultGroupID || doc.Containers[0].Layout != nil {
		t.Fatalf("expected removed group container to return to first remaining desktop cleanly: %#v", doc.Containers[0])
	}
}

func newTestService(t *testing.T) *service {
	t.Helper()
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	return svc
}

func readyService(t *testing.T) *service {
	t.Helper()
	svc := newTestService(t)
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	return svc
}

func assertDefaultWorkspaceView(t *testing.T, doc categoryWorkspaceView, id string) {
	t.Helper()
	if doc.ID != id || doc.DataVersion != dataVersion || doc.SchemaVersion != dataSchemaVersion {
		t.Fatalf("unexpected workspace identity: %#v", doc)
	}
	if len(doc.Groups) != 1 || doc.Groups[0].ID != defaultGroupID || len(doc.Items) != 0 || len(doc.Containers) != 0 {
		t.Fatalf("unexpected default workspace data: %#v", doc)
	}
	if doc.Desktop.IconLayout.RowGap != defaultDesktopIconGap || doc.Desktop.IconLayout.ColumnGap != defaultDesktopIconGap || doc.Desktop.IconLayout.IconScale != defaultDesktopIconScale {
		t.Fatalf("unexpected default icon layout: %#v", doc.Desktop.IconLayout)
	}
}

func assertCreatedContainerFromItems(t *testing.T, doc categoryWorkspaceView, sourceID string, targetID string, layoutX int) {
	t.Helper()
	if len(doc.Containers) != 1 || doc.Containers[0].Name != "新建收纳夹（1）" {
		t.Fatalf("unexpected created container: %#v", doc.Containers)
	}
	if doc.Containers[0].Layout == nil || doc.Containers[0].Layout.X != layoutX || doc.Containers[0].Layout.Y != 0 {
		t.Fatalf("unexpected created container layout: %#v", doc.Containers[0].Layout)
	}
	if containerIDByItem(doc, sourceID) != doc.Containers[0].ID || containerIDByItem(doc, targetID) != doc.Containers[0].ID {
		t.Fatalf("expected both items in new container: %#v", doc.Items)
	}
	if itemByID(doc, sourceID).Layout != nil || itemByID(doc, targetID).Layout != nil {
		t.Fatalf("expected desktop layouts cleared: %#v", doc.Items)
	}
	if containerLayoutByItem(doc, targetID) == nil || containerLayoutByItem(doc, targetID).X != 0 || containerLayoutByItem(doc, sourceID) == nil || containerLayoutByItem(doc, sourceID).X != 1 {
		t.Fatalf("unexpected container item layouts: %#v", doc.Items)
	}
}

func addCollectionItem(t *testing.T, svc *service, categoryID string, item collectionItem) categoryWorkspaceView {
	t.Helper()
	doc, err := svc.addItem(categoryID, item)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func updateCollectionItem(t *testing.T, svc *service, categoryID string, item collectionItem) categoryWorkspaceView {
	t.Helper()
	doc, err := svc.updateItem(categoryID, item)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func addCollectionContainer(t *testing.T, svc *service, categoryID string, container desktopContainer) categoryWorkspaceView {
	t.Helper()
	doc, err := svc.addCollectionContainer(categoryID, container)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func saveCollectionItemContainer(t *testing.T, svc *service, categoryID string, ids []string, containerID string) categoryWorkspaceView {
	t.Helper()
	doc, err := svc.saveCollectionItemContainer(categoryID, ids, containerID)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func placeCollectionContainerItems(t *testing.T, svc *service, categoryID string, payload categoryContainerItemsPlacement) categoryWorkspaceView {
	t.Helper()
	payload.CategoryID = categoryID
	doc, err := svc.placeCollectionContainerItems(payload)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func folderTarget(path string) collectionTarget {
	return collectionTarget{Kind: "folder", Path: path}
}

func urlTarget(rawURL string) collectionTarget {
	return collectionTarget{Kind: "url", URL: rawURL}
}

func wallpaperWithPreset(id string, assetID string, view desktopWallpaperView) *desktopWallpaper {
	return &desktopWallpaper{
		ActiveID: id,
		Presets: []desktopWallpaperPreset{{
			ID:      id,
			Name:    "主壁纸",
			AssetID: assetID,
			View:    view,
		}},
	}
}

func writeRawData(t *testing.T, svc *service, data string) {
	t.Helper()
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, dataFile), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeRawDoc(t *testing.T, svc *service, doc collectionsDoc) {
	t.Helper()
	payload, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	writeRawData(t, svc, string(payload))
}

func readJSONMap(t *testing.T, path string) map[string]any {
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

func jsonStringList(t *testing.T, value any) []string {
	t.Helper()
	items, ok := value.([]any)
	if !ok {
		t.Fatalf("expected JSON array of strings, got %#v", value)
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			t.Fatalf("expected JSON string item, got %#v", item)
		}
		out = append(out, text)
	}
	return out
}

func stringListContains(items []string, wanted string) bool {
	for _, item := range items {
		if item == wanted {
			return true
		}
	}
	return false
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func assertSingleRecoveryPackage(t *testing.T, svc *service) {
	t.Helper()
	assertRecoveryPackageCount(t, svc, 1)
	packageDirs := recoveryPackageDirs(t, svc)
	packageDir := packageDirs[0]
	if _, err := os.Stat(filepath.Join(packageDir, "plan.json")); err != nil {
		t.Fatalf("expected recovery plan: %v", err)
	}
	if _, err := os.Stat(filepath.Join(packageDir, "files", dataFile)); err != nil {
		t.Fatalf("expected data file recovery copy: %v", err)
	}
}

func assertRecoveryPackageCount(t *testing.T, svc *service, count int) {
	t.Helper()
	packageDirs := recoveryPackageDirs(t, svc)
	if len(packageDirs) != count {
		t.Fatalf("expected %d recovery packages, got %d", count, len(packageDirs))
	}
}

func recoveryPackageDirs(t *testing.T, svc *service) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(svc.dataDir, recoveryDirName))
	if err != nil {
		t.Fatalf("expected recovery packages: %v", err)
	}
	dirs := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, filepath.Join(svc.dataDir, recoveryDirName, entry.Name()))
		}
	}
	return dirs
}

func containerIDByItem(doc categoryWorkspaceView, id string) string {
	item := itemByID(doc, id)
	if item == nil {
		return ""
	}
	return item.ContainerID
}

func containerLayoutByItem(doc categoryWorkspaceView, id string) *folderGridLayout {
	item := itemByID(doc, id)
	if item == nil {
		return nil
	}
	return item.ContainerLayout
}

func itemByID(doc categoryWorkspaceView, id string) *collectionItem {
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
