package main

import (
	"path/filepath"
	"testing"
)

func TestEnsureFavoritesNormalizesDirtyDocumentAndWritesBack(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), favoritesFile), `{
  "version": 1,
  "rootFolderId": "legacy-root",
  "folders": {
    "root": { "id": "wrong-root", "title": "", "description": 42 },
    "custom": { "title": "Custom" }
  },
  "refsByFolderId": {
    "root": [
      null,
      {},
      { "id": "", "folderId": "wrong", "kind": "note", "targetId": "n-1", "layout": { "x": -2, "y": 3.7, "w": 0, "h": -1 }, "createdAtMs": 1, "updatedAtMs": 2 },
      { "kind": "note", "targetId": "n-1" },
      { "kind": "unknown", "targetId": "x" },
      { "kind": "asset", "targetId": "asset-1.png" }
    ],
    "missing-folder": [
      { "kind": "folder", "targetId": "custom" }
    ]
  }
}`)

	result, err := svc.ensureFavorites(testRepoID(t, svc))
	if err != nil {
		t.Fatalf("ensureFavorites failed: %v", err)
	}
	doc, ok := result.(favoritesDoc)
	if !ok {
		t.Fatalf("ensureFavorites result = %T, want favoritesDoc", result)
	}
	assertNormalizedDirtyFavorites(t, doc)

	var saved favoritesDoc
	if err := readJSONFile(filepath.Join(testRepoRoot(t, svc), favoritesFile), &saved); err != nil {
		t.Fatalf("read saved favorites failed: %v", err)
	}
	assertNormalizedDirtyFavorites(t, saved)
}

func TestEnsureFavoritesRecreatesUnsupportedDocumentVersion(t *testing.T) {
	svc := newTestService(t)
	mustWriteFile(t, filepath.Join(testRepoRoot(t, svc), favoritesFile), `{"version":2,"folders":{"future":{"title":"Future"}},"refsByFolderId":{"future":[{"kind":"note","targetId":"n-future"}]}}`)

	result, err := svc.ensureFavorites(testRepoID(t, svc))
	if err != nil {
		t.Fatalf("ensureFavorites failed: %v", err)
	}
	doc, ok := result.(favoritesDoc)
	if !ok {
		t.Fatalf("ensureFavorites result = %T, want favoritesDoc", result)
	}
	if doc.Version != 1 || doc.RootFolderID != "root" || len(doc.Folders) != 1 || len(doc.RefsByFolderID["root"]) != 0 {
		t.Fatalf("fresh doc = %#v", doc)
	}
}

func assertNormalizedDirtyFavorites(t *testing.T, doc favoritesDoc) {
	t.Helper()
	if doc.Version != 1 || doc.RootFolderID != "root" {
		t.Fatalf("doc identity = version %d root %q", doc.Version, doc.RootFolderID)
	}
	root, ok := doc.Folders["root"]
	if !ok || root.ID != "root" || root.Title != "根目录" {
		t.Fatalf("root folder = %#v", root)
	}
	if _, ok := doc.Folders["missing-folder"]; !ok {
		t.Fatalf("missing-folder placeholder not created: %#v", doc.Folders)
	}

	rootRefs := doc.RefsByFolderID["root"]
	if len(rootRefs) != 2 {
		t.Fatalf("root refs count = %d, want 2: %#v", len(rootRefs), rootRefs)
	}
	noteRef := rootRefs[0]
	if noteRef.ID != "ref_root__note__n-1" || noteRef.FolderID != "root" || noteRef.Kind != "note" || noteRef.TargetID != "n-1" {
		t.Fatalf("note ref = %#v", noteRef)
	}
	if noteRef.Layout.X != 0 || noteRef.Layout.Y != 3 || noteRef.Layout.W != 1 || noteRef.Layout.H != 1 {
		t.Fatalf("note layout = %#v", noteRef.Layout)
	}
	assetRef := rootRefs[1]
	if assetRef.FolderID != "root" || assetRef.Kind != "asset" || assetRef.TargetID != "asset-1.png" {
		t.Fatalf("asset ref = %#v", assetRef)
	}

	missingRefs := doc.RefsByFolderID["missing-folder"]
	if len(missingRefs) != 1 || missingRefs[0].Kind != "folder" || missingRefs[0].TargetID != "custom" {
		t.Fatalf("missing-folder refs = %#v", missingRefs)
	}
}
