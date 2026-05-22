package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenAIImageProviderImagesGenerationSuccessAndDebugRedaction(t *testing.T) {
	var receivedPath string
	var authHeader string
	var receivedBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		authHeader = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&receivedBody); err != nil {
			t.Fatalf("decode request body failed: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="}]}`))
	}))
	defer server.Close()

	provider := newOpenAIImageProvider(server.Client())
	result, err := provider.Generate(context.Background(), imageGenerationInput{
		TaskID: "task-1",
		Mode:   generationModeNormal,
		Normal: &createNormalGenerationRequest{
			Provider: generationProvider{ID: "p1", Name: "P", BaseURL: server.URL, APIKey: "secret", Protocol: "images", Model: "gpt-image-1", Size: "1024x1024"},
			Prompt:   "draw cat",
			ImageOptions: imageGenerationOptions{
				Size:         "1024x1536",
				Quality:      "high",
				OutputFormat: "webp",
				Background:   "opaque",
				Moderation:   "low",
			},
			DebugMode:         true,
			RequestTimeoutSec: 5,
		},
	})
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}
	if receivedPath != "/images/generations" {
		t.Fatalf("expected images/generations path, got %q", receivedPath)
	}
	if authHeader != "Bearer secret" {
		t.Fatalf("expected auth header to reach upstream")
	}
	if receivedBody["size"] != "1024x1536" || receivedBody["quality"] != "high" || receivedBody["output_format"] != "webp" || receivedBody["background"] != "opaque" || receivedBody["moderation"] != "low" {
		t.Fatalf("image options were not forwarded correctly: %#v", receivedBody)
	}
	if _, ok := receivedBody["response_format"]; ok {
		t.Fatalf("gpt image requests should not send response_format: %#v", receivedBody)
	}
	if !strings.HasPrefix(result.ImageDataURL, "data:image/png;base64,") {
		t.Fatalf("expected image data URL, got %q", result.ImageDataURL)
	}
	if result.Debug == nil {
		t.Fatalf("expected debug record")
	}
	if result.Debug.Request.Headers["Authorization"] != "[REDACTED]" {
		t.Fatalf("expected redacted auth header, got %q", result.Debug.Request.Headers["Authorization"])
	}
}

func TestOpenAIImageProviderImagesEditsMultipart(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/images/edits" {
			t.Fatalf("expected images edits path, got %q", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
			t.Fatalf("expected multipart content type")
		}
		if err := r.ParseMultipartForm(20 << 20); err != nil {
			t.Fatalf("ParseMultipartForm failed: %v", err)
		}
		if r.FormValue("model") != "gpt-image-1" || r.FormValue("size") != "1024x1536" || r.FormValue("quality") != "high" || r.FormValue("output_format") != "webp" || r.FormValue("input_fidelity") != "high" {
			t.Fatalf("missing multipart fields")
		}
		if r.FormValue("moderation") != "" || r.FormValue("response_format") != "" {
			t.Fatalf("edits should not send moderation/response_format for gpt image models")
		}
		if len(r.MultipartForm.File["image[]"]) != 1 {
			t.Fatalf("expected one image[] file")
		}
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="}]}`))
	}))
	defer server.Close()

	provider := newOpenAIImageProvider(server.Client())
	_, err := provider.Generate(context.Background(), imageGenerationInput{
		TaskID: "task-1",
		Mode:   generationModeNormal,
		Normal: &createNormalGenerationRequest{
			Provider:  generationProvider{BaseURL: server.URL, APIKey: "secret", Protocol: "images", Model: "gpt-image-1"},
			Prompt:    "draw cat",
			RefImages: []generationRefImage{{Name: "ref", DataURL: testPNGDataURL}},
			ImageOptions: imageGenerationOptions{
				Size:          "1024x1536",
				Quality:       "high",
				OutputFormat:  "webp",
				Background:    "opaque",
				InputFidelity: "high",
			},
			DebugMode:         true,
			RequestTimeoutSec: 5,
		},
	})
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}
}

func TestOpenAIImageProviderChatResponseAndError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("expected chat path, got %q", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body failed: %v", err)
		}
		if body["model"] != "chat-model" {
			t.Fatalf("expected chat model")
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"` + testPNGDataURL + `"}}]}`))
	}))
	defer server.Close()

	provider := newOpenAIImageProvider(server.Client())
	result, err := provider.Generate(context.Background(), imageGenerationInput{
		TaskID: "task-1",
		Mode:   generationModeNormal,
		Normal: &createNormalGenerationRequest{Provider: generationProvider{BaseURL: server.URL, APIKey: "secret", Protocol: "chat", Model: "chat-model"}, Prompt: "draw cat", RequestTimeoutSec: 5},
	})
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}
	if result.ImageDataURL == "" {
		t.Fatalf("expected chat image data URL")
	}
}

func TestOpenAIImageProviderContextCancel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()

	provider := newOpenAIImageProvider(server.Client())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := provider.Generate(ctx, imageGenerationInput{
		TaskID: "task-1",
		Mode:   generationModeNormal,
		Normal: &createNormalGenerationRequest{Provider: generationProvider{BaseURL: server.URL, APIKey: "secret", Protocol: "images", Model: "gpt-image-1"}, Prompt: "draw cat", RequestTimeoutSec: 5},
	})
	if err == nil {
		t.Fatalf("expected cancel error")
	}
	if !strings.Contains(err.Error(), "context canceled") && !strings.Contains(err.Error(), "已取消") {
		t.Fatalf("expected context cancel error, got %v", err)
	}
	time.Sleep(10 * time.Millisecond)
}
