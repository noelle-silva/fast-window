package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildOpenAIChatReqUsesSplitChatIndexRoleFolders(t *testing.T) {
	dataDir := t.TempDir()
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "meta", "index.json"), map[string]any{
		"schemaVersion": 1,
		"dataVersion":   7,
		"settings":      map[string]any{},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "index.json"), map[string]any{
		"schemaVersion": 1,
		"roleOrder":     []any{"r1"},
		"roleFolders":   map[string]any{"r1": "Alice"},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "index.json"), map[string]any{
		"schemaVersion": 1,
		"activeChatId":  "c1",
		"chatIds":       []any{"c1"},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "roles", "Alice", "role.json"), map[string]any{
		"id":           "r1",
		"name":         "Alice",
		"systemPrompt": "You are Alice.",
		"modelRef": map[string]any{
			"providerId": "p1",
			"modelId":    "m1",
		},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "c1", "chat.json"), map[string]any{
		"id":        "c1",
		"title":     "Hello",
		"createdAt": int64(1),
		"updatedAt": int64(2),
		"messages":  []any{map[string]any{"id": "m1", "role": "user", "content": "hello"}},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "providers", "OpenAI", "provider.json"), map[string]any{
		"id":      "p1",
		"name":    "OpenAI",
		"baseUrl": "https://example.test/v1",
		"apiKey":  "secret",
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "providers", "index.json"), map[string]any{
		"schemaVersion":   1,
		"providerOrder":   []any{"p1"},
		"providerFolders": map[string]any{"p1": "OpenAI"},
	})

	svc := newService(dataDir)
	req, err := svc.buildOpenAIChatReqFromStorage(map[string]any{
		"roleId": "r1",
		"chatId": "c1",
		"stream": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if req.URL != "https://example.test/v1/chat/completions" {
		t.Fatalf("url = %q", req.URL)
	}
	if got := req.Headers["Authorization"]; got != "Bearer secret" {
		t.Fatalf("authorization = %q", got)
	}
	if !strings.Contains(req.Body, `"model":"m1"`) {
		t.Fatalf("body missing model: %s", req.Body)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		t.Fatal(err)
	}
	messages, _ := body["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("messages = %#v", body["messages"])
	}
}

func TestLoadSplitMetaKeepsFoldersCompatibleWithCallers(t *testing.T) {
	dataDir := t.TempDir()
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "meta", "index.json"), map[string]any{
		"schemaVersion": 1,
		"dataVersion":   7,
		"settings":      map[string]any{},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "index.json"), map[string]any{
		"schemaVersion": 1,
		"roleOrder":     []any{"r1"},
		"roleFolders":   map[string]any{"r1": "Alice"},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "index.json"), map[string]any{
		"schemaVersion": 1,
		"activeChatId":  "c1",
		"chatIds":       []any{"c1"},
		"chatUpdatedAt": map[string]any{"c1": int64(2)},
		"chatMetas":     []any{map[string]any{"id": "c1", "title": "Hello", "updatedAt": int64(2)}},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "groups", "index.json"), map[string]any{
		"schemaVersion": 1,
		"groupOrder":    []any{"g1"},
		"groupFolders":  map[string]any{"g1": "Team"},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "groups", "Team", "chats", "index.json"), map[string]any{
		"schemaVersion": 1,
		"activeChatId":  "gc1",
		"chatIds":       []any{"gc1"},
		"chatUpdatedAt": map[string]any{"gc1": int64(3)},
		"chatMetas":     []any{map[string]any{"id": "gc1", "title": "Team", "updatedAt": int64(3)}},
	})

	svc := newService(dataDir)
	meta, err := svc.loadSplitMeta()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(asString(asMap(meta["roleFolders"])["r1"])); got != "Alice" {
		t.Fatalf("role folder = %q", got)
	}
	if got := strings.TrimSpace(asString(asMap(meta["groupFolders"])["g1"])); got != "Team" {
		t.Fatalf("group folder = %q", got)
	}
	if got := asMap(asMap(meta["chatIndexByRole"])["r1"]); len(asSlice(got["chatMetas"])) != 1 {
		t.Fatalf("role chat index = %#v", got)
	}
	if got := asMap(asMap(meta["chatIndexByGroup"])["g1"]); len(asSlice(got["chatMetas"])) != 1 {
		t.Fatalf("group chat index = %#v", got)
	}
}

func TestRunJobStubWithTargetUsesTargetIdentity(t *testing.T) {
	job := runJobStubWithTarget(map[string]any{
		"roleId":       "stale-role",
		"groupId":      "stale-group",
		"chatId":       "stale-chat",
		"branchId":     "stale-branch",
		"assistantMid": "stale-mid",
		"stream":       true,
	}, aiRunTarget{
		Kind:         "group",
		RoleID:       "r1",
		GroupID:      "g1",
		ChatID:       "c1",
		BranchID:     "main",
		AssistantMid: "m1",
	})

	if job["roleId"] != "r1" || job["groupId"] != "g1" || job["chatId"] != "c1" || job["branchId"] != "main" || job["assistantMid"] != "m1" {
		t.Fatalf("job identity was not normalized from target: %#v", job)
	}
	if job["stream"] != true {
		t.Fatalf("non-identity fields should be preserved: %#v", job)
	}
}
