package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestRunAssetUploadPipelineCommitsFileAndIndex(t *testing.T) {
	svc := newTestService(t)
	content := []byte("hello upload pipeline")
	source := filepath.Join(t.TempDir(), "hello.txt")
	if err := os.WriteFile(source, content, 0o644); err != nil {
		t.Fatal(err)
	}
	inputs := []assetUploadFileInput{{Path: source, DisplayName: "Hello Upload"}}
	task := svc.uploadTasks.create("library", newAssetUploadTaskFiles(inputs))
	if err := task.markRunning(); err != nil {
		t.Fatalf("markRunning failed: %v", err)
	}

	result, err := svc.runAssetUploadPipeline("library", inputs, task)
	if err != nil {
		t.Fatalf("runAssetUploadPipeline failed: %v", err)
	}
	task.markCompleted(result)

	if len(result) != 1 {
		t.Fatalf("result count = %d, want 1", len(result))
	}
	expectedID := fmt.Sprintf("%x", sha256.Sum256(content))
	if result[0].AssetID != expectedID {
		t.Fatalf("asset id = %q, want %q", result[0].AssetID, expectedID)
	}
	idx, err := svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatalf("ensureAssetIndex failed: %v", err)
	}
	entry, ok := idx.Assets[assetKey(expectedID, "txt")]
	if !ok {
		t.Fatalf("asset index missing %q", assetKey(expectedID, "txt"))
	}
	if entry.DisplayName != "Hello Upload" {
		t.Fatalf("displayName = %q, want Hello Upload", entry.DisplayName)
	}
	if entry.MetadataVersion != assetMetadataVersion || entry.AssetID != expectedID || entry.Ext != "txt" || entry.UploadedAtMs <= 0 || entry.UpdatedAtMs <= 0 {
		t.Fatalf("metadata entry = %#v, want v2 metadata with upload timestamps", entry)
	}
	target, err := svc.resolvePath("library", entry.Path)
	if err != nil {
		t.Fatalf("resolve target failed: %v", err)
	}
	written, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read committed asset failed: %v", err)
	}
	if string(written) != string(content) {
		t.Fatalf("committed content = %q, want %q", string(written), string(content))
	}
	snap := task.snapshot()
	if snap.Status != assetUploadStatusCompleted {
		t.Fatalf("task status = %q, want completed", snap.Status)
	}
	if snap.Files[0].Status != assetUploadFileStatusCompleted || snap.Files[0].Resource == nil {
		t.Fatalf("file snapshot = status %q resource %#v, want completed resource", snap.Files[0].Status, snap.Files[0].Resource)
	}
}

func TestRunAssetUploadPipelineCommitsPastedContent(t *testing.T) {
	svc := newTestService(t)
	content := []byte("hello pasted upload")
	inputs := []assetUploadFileInput{{Name: "paste.txt", DisplayName: "Pasted Upload", Mime: "text/plain", Size: int64(len(content)), DataBase64: "aGVsbG8gcGFzdGVkIHVwbG9hZA=="}}
	task := svc.uploadTasks.create("library", newAssetUploadTaskFiles(inputs))
	if err := task.markRunning(); err != nil {
		t.Fatalf("markRunning failed: %v", err)
	}

	result, err := svc.runAssetUploadPipeline("library", inputs, task)
	if err != nil {
		t.Fatalf("runAssetUploadPipeline failed: %v", err)
	}
	task.markCompleted(result)

	expectedID := fmt.Sprintf("%x", sha256.Sum256(content))
	if len(result) != 1 || result[0].AssetID != expectedID || result[0].Ext != "txt" || result[0].Name != "Pasted Upload" {
		t.Fatalf("result = %#v, want pasted txt resource", result)
	}
	idx, err := svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatalf("ensureAssetIndex failed: %v", err)
	}
	entry, ok := idx.Assets[assetKey(expectedID, "txt")]
	if !ok {
		t.Fatalf("asset index missing %q", assetKey(expectedID, "txt"))
	}
	target, err := svc.resolvePath("library", entry.Path)
	if err != nil {
		t.Fatalf("resolve target failed: %v", err)
	}
	written, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read committed asset failed: %v", err)
	}
	if string(written) != string(content) {
		t.Fatalf("committed content = %q, want %q", string(written), string(content))
	}
}

func TestRunAssetUploadPipelineSupportsMainstreamDocumentFormats(t *testing.T) {
	svc := newTestService(t)
	dir := t.TempDir()
	cases := []struct {
		name string
		ext  string
		mime string
	}{
		{name: "epub reader format", ext: "epub", mime: "application/epub+zip"},
		{name: "markdown notes", ext: "md", mime: "text/markdown"},
		{name: "open document text", ext: "odt", mime: "application/vnd.oasis.opendocument.text"},
		{name: "legacy word document", ext: "doc", mime: "application/msword"},
		{name: "structured json", ext: "json", mime: "application/json"},
	}

	for _, tc := range cases {
		t.Run(tc.ext, func(t *testing.T) {
			content := []byte("document format: " + tc.ext)
			source := filepath.Join(dir, "sample."+tc.ext)
			if err := os.WriteFile(source, content, 0o644); err != nil {
				t.Fatal(err)
			}

			result, err := svc.runAssetUploadPipeline("library", []assetUploadFileInput{{Path: source, DisplayName: tc.name}}, nil)
			if err != nil {
				t.Fatalf("runAssetUploadPipeline failed: %v", err)
			}
			if len(result) != 1 || result[0].Ext != tc.ext || result[0].Mime != tc.mime || result[0].Kind != "document" {
				t.Fatalf("result = %#v, want %s document resource", result, tc.ext)
			}
		})
	}
}

func TestRunAssetUploadPipelineInfersPastedEpubFromMime(t *testing.T) {
	svc := newTestService(t)
	content := []byte("epub pasted content")
	input := assetUploadFileInput{DisplayName: "Pasted EPUB", Mime: "application/epub+zip", Size: int64(len(content)), DataBase64: "ZXB1YiBwYXN0ZWQgY29udGVudA=="}

	result, err := svc.runAssetUploadPipeline("library", []assetUploadFileInput{input}, nil)
	if err != nil {
		t.Fatalf("runAssetUploadPipeline failed: %v", err)
	}
	if len(result) != 1 || result[0].Ext != "epub" || result[0].Mime != "application/epub+zip" || result[0].Kind != "document" {
		t.Fatalf("result = %#v, want pasted epub document resource", result)
	}
}

func TestEnsureAssetIndexMigratesV1ToV2Metadata(t *testing.T) {
	svc := newTestService(t)
	rel := filepath.ToSlash(filepath.Join(assetsDir, "docs", "2026-05", "asset.txt"))
	target, err := svc.resolvePath("library", rel)
	if err != nil {
		t.Fatal(err)
	}
	if err := ensureParent(target); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("legacy asset"), 0o644); err != nil {
		t.Fatal(err)
	}
	idxPath, err := svc.resolvePath("library", assetsIndexFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(idxPath, map[string]any{"version": 1, "assets": map[string]any{"asset.txt": map[string]any{"path": rel, "kind": "document", "displayName": "Legacy Asset"}}}); err != nil {
		t.Fatal(err)
	}

	idx, err := svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatalf("ensureAssetIndex failed: %v", err)
	}
	entry := idx.Assets["asset.txt"]
	if idx.Version != assetIndexVersion || entry.MetadataVersion != assetMetadataVersion {
		t.Fatalf("idx = %#v entry = %#v, want v2 metadata", idx, entry)
	}
	if entry.AssetID != "asset" || entry.Ext != "txt" || entry.DisplayName != "Legacy Asset" || entry.UploadedAtMs <= 0 {
		t.Fatalf("entry = %#v, want migrated v1 fields", entry)
	}
}

func TestUpdateAssetUserMetadataPersistsEditableFields(t *testing.T) {
	svc := newTestService(t)
	content := []byte("editable metadata")
	source := filepath.Join(t.TempDir(), "editable.txt")
	if err := os.WriteFile(source, content, 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := svc.runAssetUploadPipeline("library", []assetUploadFileInput{{Path: source, DisplayName: "Editable"}}, nil)
	if err != nil {
		t.Fatalf("runAssetUploadPipeline failed: %v", err)
	}
	updated, err := svc.updateAssetUserMetadata("library", result[0].AssetID, result[0].Ext, []byte(`{"displayName":"Renamed","remark":"Important context","tags":["alpha","beta","alpha"]}`))
	if err != nil {
		t.Fatalf("updateAssetUserMetadata failed: %v", err)
	}
	if updated.DisplayName != "Renamed" || updated.Remark != "Important context" || len(updated.Tags) != 2 {
		t.Fatalf("updated = %#v, want editable metadata", updated)
	}
	idx, err := svc.ensureAssetIndex("library")
	if err != nil {
		t.Fatal(err)
	}
	entry := idx.Assets[assetKey(result[0].AssetID, result[0].Ext)]
	if entry.DisplayName != "Renamed" || entry.Remark != "Important context" || len(entry.Tags) != 2 {
		t.Fatalf("entry = %#v, want persisted editable metadata", entry)
	}
}

func TestAssetUploadTaskFailureMarksUnfinishedFilesFailed(t *testing.T) {
	task := newAssetUploadTaskStore().create("library", []assetUploadTaskFile{
		{ID: "file-1", Name: "bad.txt", Size: 10, Status: assetUploadFileStatusPending},
		{ID: "file-2", Name: "later.txt", Size: 10, Status: assetUploadFileStatusPending},
	})
	if err := task.markRunning(); err != nil {
		t.Fatalf("markRunning failed: %v", err)
	}
	if err := task.startFile(0); err != nil {
		t.Fatalf("startFile failed: %v", err)
	}
	task.failFile(0, errors.New("bad file"))
	task.markFailed(errors.New("pipeline exploded"))

	snap := task.snapshot()
	if snap.Status != assetUploadStatusFailed {
		t.Fatalf("task status = %q, want failed", snap.Status)
	}
	if snap.Files[0].Status != assetUploadFileStatusFailed || snap.Files[0].Error != "bad file" {
		t.Fatalf("first file = status %q error %q, want failed bad file", snap.Files[0].Status, snap.Files[0].Error)
	}
	if snap.Files[1].Status != assetUploadFileStatusFailed || snap.Files[1].Error != "pipeline exploded" {
		t.Fatalf("second file = status %q error %q, want failed pipeline exploded", snap.Files[1].Status, snap.Files[1].Error)
	}
}

func TestAssetUploadTaskCancelDoesNotOverrideFailedTask(t *testing.T) {
	task := newAssetUploadTaskStore().create("library", []assetUploadTaskFile{{ID: "file-1", Name: "bad.txt", Size: 10, Status: assetUploadFileStatusPending}})
	task.markFailed(errors.New("boom"))

	snap := task.cancel()
	if snap.Status != assetUploadStatusFailed {
		t.Fatalf("task status = %q, want failed", snap.Status)
	}
	if snap.Error != "boom" {
		t.Fatalf("task error = %q, want boom", snap.Error)
	}
	if snap.Files[0].Status != assetUploadFileStatusFailed {
		t.Fatalf("file status = %q, want failed", snap.Files[0].Status)
	}
}

func TestAssetUploadTaskCancelBeforeRunPreventsRunningState(t *testing.T) {
	task := newAssetUploadTaskStore().create("library", []assetUploadTaskFile{{ID: "file-1", Name: "cancel.txt", Size: 10, Status: assetUploadFileStatusPending}})
	snap := task.cancel()
	if snap.Status != assetUploadStatusCanceled {
		t.Fatalf("task status = %q, want canceled", snap.Status)
	}
	if snap.Files[0].Status != assetUploadFileStatusCanceled {
		t.Fatalf("file status = %q, want canceled", snap.Files[0].Status)
	}
	if err := task.markRunning(); !errors.Is(err, errAssetUploadCanceled) {
		t.Fatalf("markRunning err = %v, want errAssetUploadCanceled", err)
	}
}
