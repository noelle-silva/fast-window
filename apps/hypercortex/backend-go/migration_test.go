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
		dataDir:          dataDir,
		stateDir:         filepath.Join(dataDir, stateDirName),
		reposDir:         filepath.Join(dataDir, reposDirName),
		legacyLibraryDir: filepath.Join(dataDir, legacyLibraryName),
		uploadTasks:      newAssetUploadTaskStore(),
		pluginReadyRepos: map[string]bool{},
	}
}

// testRepoID 返回测试服务的唯一仓库标识；没有仓库时按需创建一个。
func testRepoID(t *testing.T, svc *service) string {
	t.Helper()
	repos, err := svc.listRepos()
	if err != nil {
		t.Fatalf("listRepos failed: %v", err)
	}
	if len(repos) == 0 {
		identity, err := svc.createRepo("测试仓库")
		if err != nil {
			t.Fatalf("createRepo failed: %v", err)
		}
		return identity.ID
	}
	return repos[0].ID
}

func testRepoRoot(t *testing.T, svc *service) string {
	t.Helper()
	root, err := svc.repoRoot(testRepoID(t, svc))
	if err != nil {
		t.Fatalf("repoRoot failed: %v", err)
	}
	return root
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

	repoRoot := testRepoRoot(t, svc)
	mustExist(t, filepath.Join(svc.stateDir, metadataFile))
	mustExist(t, filepath.Join(repoRoot, favoritesFile))
	mustExist(t, filepath.Join(repoRoot, indexFile))
	mustExist(t, filepath.Join(repoRoot, refsIndexFile))
	mustExist(t, filepath.Join(repoRoot, assetsIndexFile))
	mustExist(t, filepath.Join(repoRoot, notesDir, "2026-05", "note-1", manifestFile))
	mustNotExist(t, filepath.Join(repoRoot, notesDir, "2026-05", "Note_note-1"))
	mustExist(t, filepath.Join(repoRoot, assetsDir, "images", "asset.txt"))
	mustExist(t, filepath.Join(repoRoot, trashDir, "2026-05", "note-2", manifestFile))
	mustNotExist(t, filepath.Join(repoRoot, trashDir, "2026-05", "Trash_note-2"))
	mustNotExist(t, filepath.Join(svc.dataDir, metadataFile))
	mustNotExist(t, filepath.Join(svc.dataDir, notesDir))
	mustNotExist(t, svc.legacyLibraryDir)
	mustExist(t, filepath.Join(repoRoot, repoIdentityFile))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(repoRoot, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["note-1"].Dir; got != "Notes/2026-05/note-1" {
		t.Fatalf("note dir = %q, want Notes/2026-05/note-1", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(repoRoot, trashDir, "2026-05", "note-2", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/note-2" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/note-2", got)
	}

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}
	if len(ledger.Applied) != 9 {
		t.Fatalf("applied count = %d, want 9", len(ledger.Applied))
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
	if ledger.Applied[3].ID != noteFaceRefsV2Migration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[3].ID, noteFaceRefsV2Migration)
	}
	if ledger.Applied[4].ID != noteFaceSearchIndexMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[4].ID, noteFaceSearchIndexMigration)
	}
	if ledger.Applied[5].ID != noteFaceTimestampsMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[5].ID, noteFaceTimestampsMigration)
	}
	if ledger.Applied[6].ID != htmlFaceLegacySettingsMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[6].ID, htmlFaceLegacySettingsMigration)
	}
	if ledger.Applied[7].ID != dataIdentitySplitMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[7].ID, dataIdentitySplitMigration)
	}
	if ledger.Applied[8].ID != repoPoolLayoutMigration {
		t.Fatalf("migration id = %q, want %q", ledger.Applied[8].ID, repoPoolLayoutMigration)
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
	if len(ledger.Applied) != 9 {
		t.Fatalf("applied count = %d, want 9", len(ledger.Applied))
	}
}

func TestMigrateDataIdentitySplitSeparatesSettingsAndRepoData(t *testing.T) {
	svc := newTestService(t)
	if err := svc.writeMigrationsLedger(migrationsLedger{SchemaVersion: 1, DataVersion: 7, Applied: []migrationEntry{}}); err != nil {
		t.Fatalf("write ledger failed: %v", err)
	}
	mustWriteFile(t, filepath.Join(svc.stateDir, metadataFile), `{
  "version": 1,
  "shortcuts": {"toggleQuickSearch": "Ctrl+K"},
  "colorPresetId": "claude-paper",
  "workspaces": [{"id": "ws-1", "title": "默认工作区"}],
  "activeWorkspaceId": "ws-1",
  "openTabKeys": ["note:n-1"],
  "sidebarItems": [{"type": "tab", "tabKey": "note:n-1"}],
  "tabGroups": [{"id": "g-1", "title": "组", "color": "#fff"}],
  "tabGroupByTabKey": {"note:n-1": "g-1"},
  "activeTabKey": "note:n-1",
  "currentFolderId": "folder-a"
}`)
	mustWriteFile(t, filepath.Join(svc.stateDir, favoritesFile), `{"version":1,"rootFolderId":"root","folders":{"root":{"id":"root","title":"根目录"}},"refsByFolderId":{"root":[]}}`)
	mustWriteFile(t, filepath.Join(svc.stateDir, facePluginsStateFile), `{"version":1,"declarationFingerprint":"fp-keep"}`)
	mustWriteFile(t, filepath.Join(svc.stateDir, thumbnailCacheDir, thumbnailCacheSubdir, thumbnailIndexFile), `{"version":1,"entries":{}}`)

	if err := svc.runDataMigrations(); err != nil {
		t.Fatalf("runDataMigrations failed: %v", err)
	}

	ledger := readLedger(t, svc)
	if ledger.DataVersion != currentDataVersion {
		t.Fatalf("dataVersion = %d, want %d", ledger.DataVersion, currentDataVersion)
	}

	var meta map[string]any
	if err := readJSONFile(filepath.Join(svc.stateDir, metadataFile), &meta); err != nil {
		t.Fatalf("read metadata failed: %v", err)
	}
	for _, key := range repoStateFieldKeys {
		if _, ok := meta[key]; ok {
			t.Fatalf("metadata still contains repo field %q", key)
		}
	}
	if meta["colorPresetId"] != "claude-paper" {
		t.Fatalf("colorPresetId = %v, want claude-paper", meta["colorPresetId"])
	}
	if _, ok := meta["shortcuts"]; !ok {
		t.Fatalf("shortcuts missing from app settings: %#v", meta)
	}

	repoRoot := testRepoRoot(t, svc)
	var repoState map[string]any
	if err := readJSONFile(filepath.Join(repoRoot, repoStateFile), &repoState); err != nil {
		t.Fatalf("read repo state failed: %v", err)
	}
	if repoState["activeWorkspaceId"] != "ws-1" || repoState["currentFolderId"] != "folder-a" || repoState["activeTabKey"] != "note:n-1" {
		t.Fatalf("repo state identity fields = %#v", repoState)
	}
	if _, ok := repoState["workspaces"]; !ok {
		t.Fatalf("workspaces missing from repo state: %#v", repoState)
	}

	mustExist(t, filepath.Join(repoRoot, favoritesFile))
	mustNotExist(t, filepath.Join(svc.stateDir, favoritesFile))
	mustExist(t, filepath.Join(repoRoot, facePluginsStateFile))
	mustNotExist(t, filepath.Join(svc.stateDir, facePluginsStateFile))
	mustExist(t, filepath.Join(repoRoot, thumbnailCacheDir, thumbnailCacheSubdir, thumbnailIndexFile))
	mustNotExist(t, filepath.Join(svc.stateDir, thumbnailCacheDir))
	mustNotExist(t, svc.legacyLibraryDir)
}

func TestSplitMetadataIdentityDoesNotOverwriteExistingRepoState(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(svc.stateDir, metadataFile), `{"version":1,"activeTabKey":"note:legacy","colorPresetId":"claude-paper"}`)
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, repoStateFile), `{"version":1,"activeTabKey":"note:current"}`)

	if err := svc.splitMetadataIdentity(); err != nil {
		t.Fatalf("splitMetadataIdentity failed: %v", err)
	}

	var repoState map[string]any
	if err := readJSONFile(filepath.Join(svc.legacyLibraryDir, repoStateFile), &repoState); err != nil {
		t.Fatalf("read repo state failed: %v", err)
	}
	if repoState["activeTabKey"] != "note:current" {
		t.Fatalf("existing repo state was overwritten: %#v", repoState)
	}

	var meta map[string]any
	if err := readJSONFile(filepath.Join(svc.stateDir, metadataFile), &meta); err != nil {
		t.Fatalf("read metadata failed: %v", err)
	}
	if _, ok := meta["activeTabKey"]; ok {
		t.Fatalf("legacy repo field still in metadata: %#v", meta)
	}
}

func TestMigrateNoteFaceSystemUnificationUnifiesManifestsAndRebuildsRefs(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}

	noteDir := filepath.Join(svc.legacyLibraryDir, notesDir, "2026-05", "202609010001")
	htmlOnlyDir := filepath.Join(svc.legacyLibraryDir, notesDir, "2026-05", "202609010002")
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
	if _, ok := htmlOnlyFaces["text"]; ok {
		t.Fatalf("html only note must keep its own faces without injected text face: %+v", htmlOnlyFaces)
	}
	if len(htmlOnlyFaces) != 1 {
		t.Fatalf("html only faces = %+v, want single html face", htmlOnlyFaces)
	}
	if _, ok := htmlOnlyManifest["primaryFaceId"]; ok {
		t.Fatalf("htmlOnly manifest still has primaryFaceId")
	}

	noteRel := filepath.ToSlash(filepath.Join(notesDir, "2026-05", "202609010001"))
	loaded, err := svc.loadNoteManifest(legacyLibraryName, noteRel)
	if err != nil {
		t.Fatalf("load migrated manifest failed: %v", err)
	}
	if loaded.Title != "Legacy Note" || loaded.Description != "旧笔记" || len(loaded.Tags) != 1 || loaded.Tags[0] != "legacy" {
		t.Fatalf("note meta lost after migration: %+v", loaded)
	}
	if len(loaded.Faces) != 3 || len(loaded.FaceOrder) != 3 {
		t.Fatalf("faces lost after migration: %+v", loaded.Faces)
	}
	legacyDoc, err := svc.loadNoteFace(legacyLibraryName, noteRel, "legacy")
	if err != nil {
		t.Fatalf("load unknown face failed: %v", err)
	}
	if !legacyDoc.Exists || legacyDoc.Content != "legacy payload" {
		t.Fatalf("unknown face content lost: %+v", legacyDoc)
	}
	textFaceDoc, err := svc.loadNoteFace(legacyLibraryName, noteRel, "text")
	if err != nil {
		t.Fatalf("load migrated text face failed: %v", err)
	}
	if !strings.Contains(textFaceDoc.Content, "[[note_id=other-a]]") {
		t.Fatalf("text face body lost: %q", textFaceDoc.Content)
	}

	refs, err := svc.loadRefIndex(legacyLibraryName)
	if err != nil {
		t.Fatalf("load refs failed: %v", err)
	}
	if got := refs["202609010001"]["text"]; len(got) != 2 || got[0].NoteID != "other-a" || got[0].FaceID != "" || got[1].NoteID != "other-b" || got[1].FaceID != "" {
		t.Fatalf("text face refs = %+v, want [other-a other-b]", got)
	}
	if got := refs["202609010001"]["html"]; len(got) != 1 || got[0].NoteID != "other-a" || got[0].FaceID != "" {
		t.Fatalf("html face refs = %+v, want [other-a]", got)
	}
	if _, ok := refs["202609010002"]; ok {
		t.Fatalf("html only note without refs should not be in refs: %+v", refs)
	}

	snapshot, err := svc.loadNoteVersion(legacyLibraryName, filepath.ToSlash(filepath.Join(notesDir, "2026-05", "202609010001")), "v_20260101_000000_00000000")
	if err != nil {
		t.Fatalf("load migrated version snapshot failed: %v", err)
	}
	if snapshot.ContentHash == "stale-hash" || snapshot.ContentHash == "" {
		t.Fatalf("snapshot content hash not refreshed: %q", snapshot.ContentHash)
	}
	if snapshot.Manifest.Title != "Legacy Note" {
		t.Fatalf("snapshot manifest lost: %+v", snapshot.Manifest)
	}
	idx, err := svc.loadNoteVersionIndex(legacyLibraryName, filepath.ToSlash(filepath.Join(notesDir, "2026-05", "202609010001")), "202609010001")
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

func readMetadataJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := readJSONFile(path, &out); err != nil {
		t.Fatalf("read metadata failed: %v", err)
	}
	return out
}

func TestMigrateHTMLFaceLegacySettingsMergesIntoContainer(t *testing.T) {
	svc := newTestService(t)
	if err := os.MkdirAll(svc.stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.stateDir, metadataFile)
	mustWriteFile(t, path, `{"version":1,"htmlFaceDisplayMode":"natural","htmlFaceFixedScaleDefault":"1.25"}`)

	if err := svc.migrateHTMLFaceLegacySettings(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	meta := readMetadataJSON(t, path)
	container := meta["facePluginSettings"].(map[string]any)
	html := container["html"].(map[string]any)
	if html["displayMode"] != "natural" {
		t.Fatalf("displayMode = %v, want natural", html["displayMode"])
	}
	if html["fixedScale"] != 1.25 {
		t.Fatalf("fixedScale = %v, want 1.25", html["fixedScale"])
	}
	// 旧字段保持只读保留，保证版本回退时设置不丢。
	if meta["htmlFaceDisplayMode"] != "natural" || meta["htmlFaceFixedScaleDefault"] != "1.25" {
		t.Fatalf("legacy fields must be preserved: %+v", meta)
	}

	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.migrateHTMLFaceLegacySettings(); err != nil {
		t.Fatalf("second migration failed: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("idempotent merge failed:\nbefore: %s\nafter: %s", before, after)
	}
}

func TestMigrateHTMLFaceLegacySettingsKeepsContainerPrecedence(t *testing.T) {
	svc := newTestService(t)
	if err := os.MkdirAll(svc.stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.stateDir, metadataFile)
	// 容器已有显示方式：优先保留容器值；旧缩放超出范围：收敛到边界。
	mustWriteFile(t, path, `{
  "version": 1,
  "htmlFaceDisplayMode": "fit-window",
  "htmlFaceFixedScaleDefault": 9,
  "facePluginSettings": {"html": {"displayMode": "fixed-fit"}}
}`)

	if err := svc.migrateHTMLFaceLegacySettings(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	meta := readMetadataJSON(t, path)
	html := meta["facePluginSettings"].(map[string]any)["html"].(map[string]any)
	if html["displayMode"] != "fixed-fit" {
		t.Fatalf("displayMode = %v, want container value fixed-fit", html["displayMode"])
	}
	if html["fixedScale"] != 2.0 {
		t.Fatalf("fixedScale = %v, want clamped 2", html["fixedScale"])
	}
}

func TestMigrateHTMLFaceLegacySettingsFallsBackForInvalidValues(t *testing.T) {
	svc := newTestService(t)
	if err := os.MkdirAll(svc.stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.stateDir, metadataFile)
	mustWriteFile(t, path, `{"version":1,"htmlFaceDisplayMode":"bogus","htmlFaceFixedScaleDefault":"NaN"}`)

	if err := svc.migrateHTMLFaceLegacySettings(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	meta := readMetadataJSON(t, path)
	html := meta["facePluginSettings"].(map[string]any)["html"].(map[string]any)
	if html["displayMode"] != "fixed-fit" {
		t.Fatalf("displayMode = %v, want fallback fixed-fit", html["displayMode"])
	}
	if html["fixedScale"] != 0.95 {
		t.Fatalf("fixedScale = %v, want fallback 0.95", html["fixedScale"])
	}
}

func TestMigrateHTMLFaceLegacySettingsNoopCases(t *testing.T) {
	svc := newTestService(t)
	if err := os.MkdirAll(svc.stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.stateDir, metadataFile)

	// 元数据不存在：无操作且不报错（新用户首次运行在前端创建元数据）。
	if err := svc.migrateHTMLFaceLegacySettings(); err != nil {
		t.Fatalf("missing metadata should be a no-op: %v", err)
	}
	mustNotExist(t, path)

	// 无旧字段：不物化容器，文件内容不变。
	mustWriteFile(t, path, `{"version":1}`)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.migrateHTMLFaceLegacySettings(); err != nil {
		t.Fatalf("no legacy fields should be a no-op: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("metadata rewritten without legacy fields:\nbefore: %s\nafter: %s", before, after)
	}
}

func TestMigrateNotePackageDirsToIDsRenamesPackagesAndReferences(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, indexFile), `{"version":1,"notes":{"202605130001":{"id":"202605130001","title":"Named","description":"","dir":"Notes/2026-05/Named_202605130001","createdAtMs":1,"updatedAtMs":2}}}`)
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, notesDir, "2026-05", "Named_202605130001", manifestFile), `{"schemaVersion":2,"id":"202605130001","title":"Named"}`)
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, trashDir, "2026-05", "Deleted_202605130002", manifestFile), `{"schemaVersion":2,"id":"202605130002","title":"Deleted"}`)
	mustWriteFile(t, filepath.Join(svc.legacyLibraryDir, trashDir, "2026-05", "Deleted_202605130002", trashMetaFile), `{"version":1,"deletedAtMs":3,"originalDir":"Notes/2026-05/Deleted_202605130002"}`)

	if err := svc.migrateNotePackageDirsToIDs(); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	mustExist(t, filepath.Join(svc.legacyLibraryDir, notesDir, "2026-05", "202605130001", manifestFile))
	mustNotExist(t, filepath.Join(svc.legacyLibraryDir, notesDir, "2026-05", "Named_202605130001"))
	mustExist(t, filepath.Join(svc.legacyLibraryDir, trashDir, "2026-05", "202605130002", manifestFile))
	mustNotExist(t, filepath.Join(svc.legacyLibraryDir, trashDir, "2026-05", "Deleted_202605130002"))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(svc.legacyLibraryDir, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["202605130001"].Dir; got != "Notes/2026-05/202605130001" {
		t.Fatalf("note dir = %q, want Notes/2026-05/202605130001", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(svc.legacyLibraryDir, trashDir, "2026-05", "202605130002", trashMetaFile), &trash); err != nil {
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

	report, err := svc.importLegacyData(source)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if report.RepoID == "" || report.RepoTitle != "导入仓库" {
		t.Fatalf("import report repo = %#v", report)
	}
	repoRoot, err := svc.repoRoot(report.RepoID)
	if err != nil {
		t.Fatalf("imported repo missing: %v", err)
	}

	mustExist(t, filepath.Join(repoRoot, notesDir, "2026-05", "202605130003", manifestFile))
	mustNotExist(t, filepath.Join(repoRoot, notesDir, "2026-05", "Imported_202605130003"))
	mustExist(t, filepath.Join(repoRoot, trashDir, "2026-05", "202605130004", manifestFile))
	mustNotExist(t, filepath.Join(repoRoot, trashDir, "2026-05", "ImportedTrash_202605130004"))

	var idx noteIndex
	if err := readJSONFile(filepath.Join(repoRoot, indexFile), &idx); err != nil {
		t.Fatalf("read index failed: %v", err)
	}
	if got := idx.Notes["202605130003"].Dir; got != "Notes/2026-05/202605130003" {
		t.Fatalf("note dir = %q, want Notes/2026-05/202605130003", got)
	}

	var trash trashMeta
	if err := readJSONFile(filepath.Join(repoRoot, trashDir, "2026-05", "202605130004", trashMetaFile), &trash); err != nil {
		t.Fatalf("read trash meta failed: %v", err)
	}
	if got := trash.OriginalDir; got != "Notes/2026-05/202605130004" {
		t.Fatalf("trash originalDir = %q, want Notes/2026-05/202605130004", got)
	}
	// 导入前的默认仓库保持为空，不被导入内容污染。
	mustNotExist(t, filepath.Join(testRepoRoot(t, svc), notesDir, "2026-05", "202605130003"))
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
