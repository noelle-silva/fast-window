package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func createVersionedTestNote(t *testing.T, svc *service) string {
	t.Helper()
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensure roots failed: %v", err)
	}
	input := map[string]any{
		"id":           "20260522010101001",
		"title":        "Versioned Note",
		"description":  "Original description",
		"body":         "# Alpha\n\nfirst body",
		"tags":         []string{"release"},
		"saveTextFace": true,
	}
	result, err := svc.saveNotePackage("library", mustJSONRaw(t, input))
	if err != nil {
		t.Fatalf("save note failed: %v", err)
	}
	meta := result.(map[string]any)["meta"].(noteMeta)
	return meta.Dir
}

func TestNoteVersionPublishListLoadAndRejectDuplicate(t *testing.T) {
	svc := newTestService(t)
	packageDir := createVersionedTestNote(t, svc)

	first, err := svc.publishNoteVersion("library", packageDir, "First release")
	if err != nil {
		t.Fatalf("publish version failed: %v", err)
	}
	if first.CommitName != "First release" || first.VersionID == "" || first.ContentHash == "" {
		t.Fatalf("unexpected version summary: %+v", first)
	}
	if _, err := svc.publishNoteVersion("library", packageDir, "Duplicate release"); err == nil || !strings.Contains(err.Error(), "无需重复发布") {
		t.Fatalf("expected duplicate publish rejection, got %v", err)
	}

	versions, err := svc.listNoteVersions("library", packageDir)
	if err != nil {
		t.Fatalf("list versions failed: %v", err)
	}
	if len(versions) != 1 || versions[0].VersionID != first.VersionID {
		t.Fatalf("versions = %+v, want first version only", versions)
	}

	snapshot, err := svc.loadNoteVersion("library", packageDir, first.VersionID)
	if err != nil {
		t.Fatalf("load version failed: %v", err)
	}
	if snapshot.CommitName != "First release" || snapshot.Manifest.Title != "Versioned Note" {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}
	if got := snapshot.Faces["text"].Content; !strings.Contains(got, "first body") {
		t.Fatalf("snapshot text = %q, want first body", got)
	}

	var idx noteVersionIndex
	if err := readJSONFile(filepath.Join(svc.libraryDir, filepath.FromSlash(noteVersionsRel(packageDir, versionsIndexFile))), &idx); err != nil {
		t.Fatalf("read version index failed: %v", err)
	}
	if idx.NoteID != "20260522010101001" || len(idx.Versions) != 1 {
		t.Fatalf("unexpected persisted index: %+v", idx)
	}
}

func TestRestoreNoteVersionReplacesCurrentContentAndRefs(t *testing.T) {
	svc := newTestService(t)
	packageDir := createVersionedTestNote(t, svc)

	first, err := svc.publishNoteVersion("library", packageDir, "Stable release")
	if err != nil {
		t.Fatalf("publish version failed: %v", err)
	}
	update := map[string]any{
		"id":           "20260522010101001",
		"packageDir":   packageDir,
		"title":        "Changed Note",
		"description":  "Changed description",
		"body":         "# Beta\n\n[[note_id=missing-target]]\nchanged body",
		"tags":         []string{"changed"},
		"saveTextFace": true,
	}
	if _, err := svc.saveNotePackage("library", mustJSONRaw(t, update)); err != nil {
		t.Fatalf("update note failed: %v", err)
	}

	result, err := svc.restoreNoteVersion("library", packageDir, first.VersionID)
	if err != nil {
		t.Fatalf("restore version failed: %v", err)
	}
	doc := result.(map[string]any)["doc"].(noteDoc)
	if doc.Title != "Versioned Note" || !strings.Contains(doc.Body, "first body") {
		t.Fatalf("restored doc = %+v, want original content", doc)
	}
	manifest, err := svc.loadNoteManifest("library", packageDir)
	if err != nil {
		t.Fatalf("load restored manifest failed: %v", err)
	}
	if manifest.Title != "Versioned Note" || manifest.UpdatedAtMs <= 0 {
		t.Fatalf("restored manifest = %+v", manifest)
	}
	refs, err := svc.loadRefIndex("library")
	if err != nil {
		t.Fatalf("load refs failed: %v", err)
	}
	if _, ok := refs["20260522010101001"]; ok {
		t.Fatalf("refs still contain restored note: %+v", refs)
	}
}

func TestLoadNoteVersionRejectsCorruptIndex(t *testing.T) {
	svc := newTestService(t)
	packageDir := createVersionedTestNote(t, svc)
	bad := noteVersionIndex{Version: noteVersionIndexVersion, NoteID: "other-note", Versions: []noteVersionSummary{}}
	if err := svc.writeJSON("library", noteVersionsRel(packageDir, versionsIndexFile), bad); err != nil {
		t.Fatalf("write bad version index failed: %v", err)
	}
	if _, err := svc.listNoteVersions("library", packageDir); err == nil || !strings.Contains(err.Error(), "归属不匹配") {
		t.Fatalf("expected ownership mismatch, got %v", err)
	}
}
