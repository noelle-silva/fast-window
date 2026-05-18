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
