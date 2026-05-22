package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

type fakeImageProvider struct {
	generate func(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error)
}

func (provider fakeImageProvider) Generate(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error) {
	return provider.generate(ctx, input)
}

func TestGenerationServiceCreateNormalAutoSaveAndEvents(t *testing.T) {
	sink := &recordingSink{}
	store := newImageStore(t.TempDir())
	svc := newGenerationService(store, fakeImageProvider{generate: func(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error) {
		return imageGenerationResult{ImageDataURL: testPNGDataURL}, nil
	}}, sink)

	params := mustJSON(t, map[string]any{"request": map[string]any{
		"provider": map[string]any{"id": "p1", "name": "P", "baseUrl": "http://example.test", "apiKey": "secret", "model": "gpt-image-1", "protocol": "images"},
		"prompt":   "draw cat", "batchCount": 2, "autoSave": true, "requestTimeoutSec": 5,
	}})
	result, err := svc.createNormal(params)
	if err != nil {
		t.Fatalf("createNormal failed: %v", err)
	}
	tasks := result.(map[string]any)["tasks"].([]generationTask)
	if len(tasks) != 2 {
		t.Fatalf("expected two tasks, got %d", len(tasks))
	}

	for _, task := range tasks {
		waitForTaskStatus(t, svc, task.ID, generationStatusSucceeded)
		got := svc.registry.get(task.ID).(generationTask)
		if got.SavedPath == "" {
			t.Fatalf("expected saved path")
		}
		if got.ImageDataURL != "" {
			t.Fatalf("autoSave should clear task imageDataUrl")
		}
	}
	if sink.count() < 6 {
		t.Fatalf("expected created/running/completed events, got %d", sink.count())
	}
}

func TestGenerationServiceLocalEditKeepsImageDataURL(t *testing.T) {
	svc := newGenerationService(newImageStore(t.TempDir()), fakeImageProvider{generate: func(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error) {
		return imageGenerationResult{ImageDataURL: testPNGDataURL}, nil
	}}, &recordingSink{})

	params := mustJSON(t, map[string]any{"request": map[string]any{
		"provider": map[string]any{"id": "p1", "name": "P", "baseUrl": "http://example.test", "apiKey": "secret", "model": "chat-model", "protocol": "chat"},
		"prompt":   "replace", "cropImage": map[string]any{"name": "crop", "dataUrl": testPNGDataURL, "width": 1, "height": 1}, "autoSave": false, "requestTimeoutSec": 5,
	}})
	result, err := svc.createLocalEdit(params)
	if err != nil {
		t.Fatalf("createLocalEdit failed: %v", err)
	}
	task := result.(map[string]any)["task"].(generationTask)
	waitForTaskStatus(t, svc, task.ID, generationStatusSucceeded)
	got := svc.registry.get(task.ID).(generationTask)
	if got.ImageDataURL == "" {
		t.Fatalf("local edit should keep imageDataUrl")
	}
}

func TestGenerationServiceCreateNormalRejectsInvalidImageOptionsBeforeTask(t *testing.T) {
	svc := newGenerationService(newImageStore(t.TempDir()), fakeImageProvider{generate: func(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error) {
		t.Fatalf("provider should not be called for invalid image options")
		return imageGenerationResult{}, nil
	}}, &recordingSink{})

	params := mustJSON(t, map[string]any{"request": map[string]any{
		"provider": map[string]any{"id": "p1", "name": "P", "baseUrl": "http://example.test", "apiKey": "secret", "model": "gpt-image-1", "protocol": "images"},
		"prompt":   "draw cat", "batchCount": 1, "autoSave": false, "requestTimeoutSec": 5,
		"imageOptions": map[string]any{"size": "1024x1024", "quality": "high", "outputFormat": "jpeg", "background": "transparent"},
	}})
	_, err := svc.createNormal(params)
	if err == nil {
		t.Fatalf("expected invalid image options error")
	}
	if len(svc.registry.list(10)) != 0 {
		t.Fatalf("invalid options should not create tasks")
	}
}

func TestGenerationServiceCancel(t *testing.T) {
	started := make(chan struct{})
	svc := newGenerationService(newImageStore(t.TempDir()), fakeImageProvider{generate: func(ctx context.Context, input imageGenerationInput) (imageGenerationResult, error) {
		close(started)
		<-ctx.Done()
		return imageGenerationResult{}, ctx.Err()
	}}, &recordingSink{})

	params := mustJSON(t, map[string]any{"request": map[string]any{
		"provider": map[string]any{"baseUrl": "http://example.test", "apiKey": "secret", "model": "gpt-image-1", "protocol": "images"},
		"prompt":   "draw cat", "batchCount": 1, "autoSave": false, "requestTimeoutSec": 5,
	}})
	result, err := svc.createNormal(params)
	if err != nil {
		t.Fatalf("createNormal failed: %v", err)
	}
	task := result.(map[string]any)["tasks"].([]generationTask)[0]
	<-started
	if _, err := svc.cancel(mustJSON(t, map[string]any{"taskId": task.ID})); err != nil {
		t.Fatalf("cancel failed: %v", err)
	}
	waitForTaskStatus(t, svc, task.ID, generationStatusCanceled)
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func waitForTaskStatus(t *testing.T, svc *generationService, taskID string, status string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		task := svc.registry.get(taskID)
		if got, ok := task.(generationTask); ok && got.Status == status {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("task %s did not reach status %s", taskID, status)
}
