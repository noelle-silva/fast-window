package main

import (
	"path/filepath"
	"testing"
)

func writeRoleChatFinalPatchFixture(t *testing.T, dataDir string, generationID string) {
	t.Helper()
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
		"chatUpdatedAt": map[string]any{"c1": int64(100)},
		"chatMetas":     []any{map[string]any{"id": "c1", "title": "Hello", "updatedAt": int64(100)}},
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "roles", "Alice", "role.json"), map[string]any{
		"id":   "r1",
		"name": "Alice",
	})
	writeJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "c1", "chat.json"), map[string]any{
		"id":        "c1",
		"title":     "Hello",
		"createdAt": int64(1),
		"updatedAt": int64(100),
		"messages": []any{
			map[string]any{"id": "u1", "role": "user", "content": "hello", "createdAt": int64(90)},
			map[string]any{
				"id":        "m1",
				"role":      "assistant",
				"content":   "（生成中…）",
				"pending":   true,
				"streaming": true,
				"createdAt": int64(100),
				"assistantRun": map[string]any{
					"generationId": generationID,
					"status":       "running",
					"mode":         "new",
					"stream":       true,
					"startedAt":    int64(100),
					"updatedAt":    int64(100),
				},
			},
		},
	})
}

func TestPatchAssistantMessageFinalFinishesMatchingGeneration(t *testing.T) {
	dataDir := t.TempDir()
	writeRoleChatFinalPatchFixture(t, dataDir, "gen-1")
	svc := newService(dataDir)

	err := svc.patchAssistantMessageFinal(aiRunTarget{
		Kind:         "role",
		RoleID:       "r1",
		ChatID:       "c1",
		BranchID:     "main",
		AssistantMid: "m1",
		GenerationID: "gen-1",
	}, "succeeded", "hello back", 1234)
	if err != nil {
		t.Fatal(err)
	}

	chat := readJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "c1", "chat.json"))
	msgs := normalizeObjectList(chat["messages"])
	msg := msgs[1]
	if got := asString(msg["content"]); got != "hello back" {
		t.Fatalf("content = %q", got)
	}
	if truthy(msg["pending"]) || truthy(msg["streaming"]) {
		t.Fatalf("message still active: %#v", msg)
	}
	run := asMap(msg["assistantRun"])
	if got := asString(run["status"]); got != "succeeded" {
		t.Fatalf("assistantRun.status = %q", got)
	}
	if got := asInt64(run["finishedAt"], 0); got != 1234 {
		t.Fatalf("assistantRun.finishedAt = %d", got)
	}
}

func TestPatchAssistantMessageFinalRejectsStaleGeneration(t *testing.T) {
	dataDir := t.TempDir()
	writeRoleChatFinalPatchFixture(t, dataDir, "gen-current")
	svc := newService(dataDir)

	err := svc.patchAssistantMessageFinal(aiRunTarget{
		Kind:         "role",
		RoleID:       "r1",
		ChatID:       "c1",
		BranchID:     "main",
		AssistantMid: "m1",
		GenerationID: "gen-stale",
	}, "succeeded", "stale output", 1234)
	if err != nil {
		t.Fatal(err)
	}

	chat := readJSONForRunnerTest(t, filepath.Join(dataDir, "chats", "Alice", "c1", "chat.json"))
	msgs := normalizeObjectList(chat["messages"])
	msg := msgs[1]
	if got := asString(msg["content"]); got != "（生成中…）" {
		t.Fatalf("stale final changed content = %q", got)
	}
	if !truthy(msg["pending"]) || !truthy(msg["streaming"]) {
		t.Fatalf("stale final changed active flags: %#v", msg)
	}
	if got := asString(asMap(msg["assistantRun"])["status"]); got != "running" {
		t.Fatalf("stale final changed assistantRun.status = %q", got)
	}
}
