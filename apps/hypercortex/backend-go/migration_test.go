package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestService(t *testing.T) *service {
	t.Helper()
	dataDir := t.TempDir()
	return &service{
		dataDir:     dataDir,
		stateDir:    filepath.Join(dataDir, stateDirName),
		libraryDir:  filepath.Join(dataDir, libraryDirName),
		uploadTasks: newAssetUploadTaskStore(),
	}
}

func TestRunDataMigrationsMovesLegacyLayoutAndWritesLedger(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(svc.dataDir, metadataFile), `{"version":1}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, favoritesFile), `{"version":1}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, indexFile), `{"version":1,"notes":{"note-1":{"id":"note-1","title":"Note","description":"","dir":"Notes/2026-05/Note_note-1","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, refsIndexFile), `{}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, assetsIndexFile), `{"version":1,"assets":{}}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, notesDir, "2026-05", "Note_note-1", manifestFile), `{"schemaVersion":2,"id":"note-1","title":"Note"}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, assetsDir, "images", "asset.txt"), `asset`)
	mustWriteFile(t, filepath.Join(svc.dataDir, trashDir, "2026-05", "Trash_note-2", manifestFile), `{"schemaVersion":2,"id":"note-2","title":"Trash"}`)
	mustWriteFile(t, filepath.Join(svc.dataDir, trashDir, "2026-05", "Trash_note-2", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/Trash_note-2"}`)

	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.stateDir, metadataFile))
	mustExist(t, filepath.Join(svc.stateDir, favoritesFile))
	mustExist(t, filepath.Join(svc.libraryDir, indexFile))
	mustExist(t, filepath.Join(svc.libraryDir, refsIndexFile))
	mustExist(t, filepath.Join(svc.libraryDir, assetsIndexFile))
	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "note-1", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Note_note-1"))
	mustExist(t, filepath.Join(svc.libraryDir, assetsDir, "images", "asset.txt"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "note-2", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Trash_note-2"))
	mustNotExist(t, filepath.Join(svc.dataDir, metadataFile))
	mustNotExist(t, filepath.Join(svc.dataDir, notesDir))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["note-1"].Dir; got != "Notes/2026-05/note-1" {
		t.Fatalf("note dir = %q, want Notes/2026-05/note-1", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.libraryDir, trashDir, "2026-05", "note-2", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/note-2" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/note-2", got)
	}

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}
	if len(ledger.Applied) != 3 {
		t.Fatalf("applied count = %d, want 3", len(ledger.Applied))
	}
	if ledger.Applied[0].ID != stateLibraryLayoutMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[0].ID, stateLibraryLayoutMigration)
	}
	if ledger.Applied[1].ID != noteIDPackageDirMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[1].ID, noteIDPackageDirMigration)
	}
	if ledger.Applied[2].ID != noteFaceSystemUnificationMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[2].ID, noteFaceSystemUnificationMigration)
	}
}

func TestRunDataMigrationsIsIdempotentAfterLedgerExists(t *testing.T) {
	svc := newTestService(t)

	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("first ensureRoots failed: %v", err)
	}
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("second ensureRoots failed: %v", err)
	}

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}
	if len(ledger.Applied) != 3 {
		t.Fatalf("applied count = %d, want 3", len(ledger.Applied))
	}
}

func TestMigrateNoteFaceSystemUnificationUnifiesManifestsAndRebuildsRefs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	noteDir := filepath.Join(svc.libraryDir, notesDir, "2026-05", "202609010001")
	htmlOnlyDir := filepath.Join(svc.libraryDir, notesDir, "2026-05", "202609010002")
	mustWriteFile(t, filepath.Join(noteDir, manifestFile), `{
  "schemaVersion": 2,
  "id": "202609010001",
  "title": "Legacy Note",
  "description": "旧笔记",
  "tags": ["legacy"],
  "createdAtMs": 100,
  "updatedAtMs": 200,
  "primaryFaceId": "text",
  "faceOrder": ["html", "text"],
  "faces": {
    "text": {
      "id": "text",
      "kind": "markdown",
      "title": "文本",
      "file": "text.md",
      "role": "primary",
      "settings": {}
    },
    "html": {
      "id": "html",
      "kind": "html",
      "title": "HTML",
      "file": "html-view.html",
      "role": "alternate",
      "settings": {"fixedScale": 1.25}
    },
    "legacy": {
      "id": "legacy",
      "kind": "old-panel",
      "title": "旧面板",
      "file": "old-panel.data",
      "settings": {"weird": true},
      "capabilities": {"editable": false, "searchable": false, "previewable": false, "linkable": false, "creatable": false, "deletable": false},
      "futureField": "keep-me"
    }
  },
  "resources": [{"assetId": "asset-1", "mime": "text/plain"}]
}`)
	mustWriteFile(t, filepath.Join(noteDir, "text.md"), `[[note_id=other-a]]

[[note_id=other-b|title=Other]]`)
	mustWriteFile(t, filepath.Join(noteDir, "html-view.html"), `<div>[[note_id=other-a]]</div>`)
	mustWriteFile(t, filepath.Join(noteDir, "old-panel.data"), `legacy payload`)

	mustWriteFile(t, filepath.Join(htmlOnlyDir, manifestFile), `{
  "schemaVersion": 2,
  "id": "202609010002",
  "title": "HTML Only",
  "description": "",
  "createdAtMs": 300,
  "updatedAtMs": 400,
  "primaryFaceId": "html",
  "faceOrder": ["html"],
  "faces": {
    "html": {
      "id": "html",
      "kind": "html",
      "title": "HTML",
      "file": "html-view.html",
      "role": "alternate",
      "settings": {}
    }
  },
  "resources": []
}`)
	mustWriteFile(t, filepath.Join(htmlOnlyDir, "html-view.html"), `<div>no refs here</div>`)

	snapshotDir := filepath.Join(noteDir, versionsDirName, "v_20260101_000000_00000000")
	mustWriteFile(t, filepath.Join(snapshotDir, versionSnapshotFile), `{
  "schemaVersion": 1,
  "versionId": "v_20260101_000000_00000000",
  "noteId": "202609010001",
  "packageDir": "Notes/2026-05/202609010001",
  "commitName": "release-1",
  "createdAtMs": 500,
  "contentHash": "stale-hash",
  "manifest": {
    "schemaVersion": 2,
    "id": "202609010001",
    "title": "Legacy Note",
    "description": "",
    "createdAtMs": 100,
    "updatedAtMs": 600,
    "primaryFaceId": "text",
    "faceOrder": ["text"],
    "faces": {
      "text": {"id": "text", "kind": "markdown", "title": "文本", "file": "text.md", "role": "primary", "settings": {}}
    },
    "resources": []
  },
  "faces": {
    "text": {"manifest": {"id": "text", "kind": "markdown", "title": "文本", "file": "text.md", "role": "primary", "settings": {}}, "content": "snapshot body"}
  }
}`)
	mustWriteFile(t, filepath.Join(noteDir, versionsDirName, "index.json"), `{"version":1,"noteId":"202609010001","versions":[{"versionId":"v_20260101_000000_00000000","commitName":"release-1","createdAtMs":500,"contentHash":"stale-hash","title":"Legacy Note","description":"","faceIds":["text"]}]}`)

	if err := svc.migrateNoteFaceSystemUnification(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	manifest := readManifestJSON(t, filepath.Join(noteDir, manifestFile))
	for _, retired := range []string{"role", "primaryFaceId"} {
		if _, ok := manifest[retired]; ok {
			t.Fatalf("manifest still contains %q: %v", retired, manifest[retired])
		}
	}
	faces := manifest["faces"].(map[string]any)
	legacy := faces["legacy"].(map[string]any)
	if legacy["kind"] != "old-panel" || legacy["title"] != "旧面板" || legacy["file"] != "old-panel.data" {
		t.Fatalf("unknown face lost or mutated: %+v", legacy)
	}
	if legacySettings := legacy["settings"].(map[string]any); legacySettings["weird"] != true {
		t.Fatalf("unknown face settings lost: %+v", legacySettings)
	}
	if future := legacy["futureField"]; future != "keep-me" {
		t.Fatalf("unknown face extension lost: %+v", future)
	}
	order := manifest["faceOrder"].([]any)
	if len(order) != 3 || order[0] != "html" || order[1] != "text" || order[2] != "legacy" {
		t.Fatalf("faceOrder = %v, want [html text legacy]", order)
	}
	textFace := faces["text"].(map[string]any)
	if textFace["role"] != nil {
		t.Fatalf("text face still has role: %v", textFace["role"])
	}
	if textCaps := textFace["capabilities"].(map[string]any); textCaps["searchable"] != true {
		t.Fatalf("known face capabilities not applied: %+v", textCaps)
	}
	resources := manifest["resources"].([]any)
	if len(resources) != 1 || resources[0].(map[string]any)["assetId"] != "asset-1" {
		t.Fatalf("resources lost after migration: %+v", resources)
	}

	htmlOnlyManifest := readManifestJSON(t, filepath.Join(htmlOnlyDir, manifestFile))
	htmlOnlyFaces := htmlOnlyManifest["faces"].(map[string]any)
	if _, ok := htmlOnlyFaces["text"]; !ok {
		t.Fatalf("empty text face not preserved/ensured: %+v", htmlOnlyFaces)
	}
	if _, ok := htmlOnlyManifest["primaryFaceId"]; ok {
		t.Fatalf("htmlOnly manifest still has primaryFaceId")
	}

	noteRel := filepath.ToSlash(filepath.Join(notesDir, "2026-05", "202609010001"))
	loaded, err := svc.loadNoteManifest("library", noteRel)
	if err != nil {
		t.Fatalf("load migrated manifest failed: %v", err)
	}
	if loaded.Title != "Legacy Note" || loaded.Description != "旧笔记" || len(loaded.Tags) != 1 || loaded.Tags[0] != "legacy" {
		t.Fatalf("note meta lost after migration: %+v", loaded)
	}
	if len(loaded.Faces) != 3 || len(loaded.FaceOrder) != 3 {
		t.Fatalf("faces lost after migration: %+v", loaded.Faces)
	}
	legacyDoc, err := svc.loadNoteFace("library", noteRel, "legacy")
	if err != nil {
		t.Fatalf("load unknown face failed: %v", err)
	}
	if !legacyDoc.Exists || legacyDoc.Content != "legacy payload" {
		t.Fatalf("unknown face content lost: %+v", legacyDoc)
	}
	textBody, err := svc.loadNotePackage("library", noteRel)
	if err != nil {
		t.Fatalf("load migrated package failed: %v", err)
	}
	if !strings.Contains(textBody.Body, "[[note_id=other-a]]") {
		t.Fatalf("text face body lost: %q", textBody.Body)
	}

	refs, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatalf("load refs failed: %v", err)
	}
	if got := refs["202609010001"]; len(got) != 2 || got[0] != "other-a" || got[1] != "other-b" {
		t.Fatalf("refs = %+v, want [other-a other-b]", got)
	}
	if _, ok := refs["202609010002"]; ok {
		t.Fatalf("html only note should not be in refs: %+v", refs)
	}

	snapshot, err := svc.loadNoteVersion("library", filepath.ToSlash(filepath.Join(notesDir, "2026-05", "202609010001")), "v_20260101_000000_00000000")
	if err != nil {
		t.Fatalf("load migrated version snapshot failed: %v", err)
	}
	if snapshot.ContentHash == "stale-hash" || snapshot.ContentHash == "" {
		t.Fatalf("snapshot content hash not refreshed: %q", snapshot.ContentHash)
	}
	if snapshot.Manifest.Title != "Legacy Note" {
		t.Fatalf("snapshot manifest lost: %+v", snapshot.Manifest)
	}
	idx, err := svc.loadNoteVersionIndex("library", filepath.ToSlash(filepath.Join(notesDir, "2026-05", "202609010001")), "202609010001")
	if err != nil {
		t.Fatalf("load migrated version index failed: %v", err)
	}
	if len(idx.Versions) != 1 || idx.Versions[0].ContentHash != snapshot.ContentHash {
		t.Fatalf("version index contentHash not synced: %+v", idx.Versions)
	}

	before, err := os.ReadFile(filepath.Join(noteDir, manifestFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.migrateNoteFaceSystemUnification(); err != nil {
		t.Fatalf("second migration failed: %v", err)
	}
	after, err := os.ReadFile(filepath.Join(noteDir, manifestFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("idempotent normalization failed:\nbefore: %s\nafter: %s", before, after)
	}
}

func readManifestJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := readJSONFile(path, &out); err != nil {
		t.Fatalf("read manifest failed: %v", err)
	}
	return out
}

func TestMigrateNotePackageDirsToIDsRenamesPackagesAndReferences(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(svc.libraryDir, indexFile), `{"version":1,"notes":{"202605130001":{"id":"202605130001","title":"Named","description":"","dir":"Notes/2026-05/Named_202605130001","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Named_202605130001", manifestFile), `{"schemaVersion":2,"id":"202605130001","title":"Named"}`)
	mustWriteFile(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Deleted_202605130002", manifestFile), `{"schemaVersion":2,"id":"202605130002","title":"Deleted"}`)
	mustWriteFile(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Deleted_202605130002", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/Deleted_202605130002"}`)

	if err := svc.migrateNotePackageDirsToIDs(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "202605130001", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Named_202605130001"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130002", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "Deleted_202605130002"))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["202605130001"].Dir; got != "Notes/2026-05/202605130001" {
		t.Fatalf("note dir = %q, want Notes/2026-05/202605130001", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130002", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/202605130002" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/202605130002", got)
	}
}

func TestImportLegacyDataNormalizesImportedNotePackageDirs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	source := t.TempDir()
	mustWriteFile(t, filepath.Join(source, indexFile), `{"version":1,"notes":{"202605130003":{"id":"202605130003","title":"Imported","description":"","dir":"Notes/2026-05/Imported_202605130003","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(source, notesDir, "2026-05", "Imported_202605130003", manifestFile), `{"schemaVersion":2,"id":"202605130003","title":"Imported"}`)
	mustWriteFile(t, filepath.Join(source, trashDir, "2026-05", "ImportedTrash_202605130004", manifestFile), `{"schemaVersion":2,"id":"202605130004","title":"ImportedTrash"}`)
	mustWriteFile(t, filepath.Join(source, trashDir, "2026-05", "ImportedTrash_202605130004", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/ImportedTrash_202605130004"}`)

	if _, err := svc.importLegacyData(source); err != nil {
		t.Fatalf("import failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "202605130003", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, notesDir, "2026-05", "Imported_202605130003"))
	mustExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130004", manifestFile))
	mustNotExist(t, filepath.Join(svc.libraryDir, trashDir, "2026-05", "ImportedTrash_202605130004"))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["202605130003"].Dir; got != "Notes/2026-05/202605130003" {
		t.Fatalf("note dir = %q, want Notes/2026-05/202605130003", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.libraryDir, trashDir, "2026-05", "202605130004", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/202605130004" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/202605130004", got)
	}
}

func TestRunMigrationsWritesRecoveryOnFailure(t *testing.T) {
	svc := newTestService(t)
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		t.Fatal(err)
	}

	err := svc.runMigrations([]dataMigration{
		{
			ID:          "failing-migration",
			FromVersion: 0,
			ToVersion:   1,
			Run: func(*service) error {
				return errors.New("boom")
			},
		},
	})
	if err == nil {
		t.Fatal("expected migration failure")
	}

	var recovery migrationRecoveryDoc
	if readErr := readJSONFile(filepath.Join(svc.dataDir, migrationRecoveryDir, migrationRecoveryFile), &recovery); readErr != nil {
		t.Fatalf("read recovery failed: %v", readErr)
	}
	if recovery.MigrationID != "failing-migration" {
		t.Fatalf("migration id = %q, want failing-migration", recovery.MigrationID)
	}
	if recovery.Error != "boom" {
		t.Fatalf("error = %q, want boom", recovery.Error)
	}
}

func mustWriteFile(t *testing.T, path string, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected %s to exist: %v", path, err)
	}
}

func mustNotExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected %s to be absent, err=%v", path, err)
	}
}

func readLedger(t *testing.T, svc *service) migrationsLedger {
	t.Helper()
	var ledger migrationsLedger
	if err := readJSONFile(filepath.Join(svc.dataDir, migrationsLedgerFile), &ledger); err != nil {
		t.Fatalf("read ledger failed: %v", err)
	}
	return ledger
}
