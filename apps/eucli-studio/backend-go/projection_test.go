package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatProjectionPreservesMessageParts(t *testing.T) {
	session := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Tools",
		"createdAt": "2026-06-03T10:00:00Z",
		"updatedAt": "2026-06-03T10:00:00Z",
		"messages": []any{map[string]any{
			"id":              "m1",
			"type":            "assistant",
			"content":         "checking",
			"tokenEstimate":   float64(12),
			"parentMessageId": "u1",
			"branchId":        "main",
			"createdAt":       "2026-06-03T10:00:00Z",
			"updatedAt":       "2026-06-03T10:00:00Z",
			"parts": []any{map[string]any{
				"id":       "part-1",
				"type":     "tool",
				"raw":      `{"command":"pwd"}`,
				"callId":   "call-1",
				"toolName": "shell_command",
				"state":    "completed",
				"input":    map[string]any{"command": "pwd"},
				"result":   map[string]any{"status": "success", "content": "ok"},
			}},
		}},
	}

	ui := toUIChat(session)
	messages := objectList(ui["messages"])
	if len(messages) != 1 {
		t.Fatalf("messages = %#v", ui["messages"])
	}
	if messages[0]["role"] != "assistant" || messages[0]["type"] != "assistant" {
		t.Fatalf("ui message role/type = %#v", messages[0])
	}
	if got := intField(messages[0], "tokenEstimate", 0); got != 12 {
		t.Fatalf("ui token estimate = %d, want 12", got)
	}
	if parts := objectList(messages[0]["parts"]); len(parts) != 1 || stringField(parts[0], "callId") != "call-1" || stringField(parts[0], "toolName") != "shell_command" || stringField(parts[0], "raw") == "" {
		t.Fatalf("ui parts = %#v", messages[0]["parts"])
	}
}

func TestChatProjectionPreservesReasoningParts(t *testing.T) {
	session := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Reasoning Parts",
		"createdAt": "2026-06-03T10:00:00Z",
		"updatedAt": "2026-06-03T10:00:00Z",
		"messages": []any{map[string]any{
			"id":              "m1",
			"type":            "assistant",
			"content":         "正式回答",
			"parentMessageId": "u1",
			"branchId":        "main",
			"createdAt":       "2026-06-03T10:00:00Z",
			"updatedAt":       "2026-06-03T10:00:00Z",
			"parts": []any{map[string]any{
				"id":     "reasoning-1",
				"type":   "reasoning",
				"text":   "先看上下文，再组织答案",
				"source": "model",
			}},
		}},
	}

	ui := toUIChat(session)
	messages := objectList(ui["messages"])
	if len(messages) != 1 {
		t.Fatalf("messages = %#v", ui["messages"])
	}
	if parts := objectList(messages[0]["parts"]); len(parts) != 1 || stringField(parts[0], "type") != "reasoning" || stringField(parts[0], "text") != "先看上下文，再组织答案" {
		t.Fatalf("ui reasoning parts = %#v", messages[0]["parts"])
	}
}

func TestChatProjectionPreservesReasoningEffort(t *testing.T) {
	session := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Reasoning",
		"createdAt": "2026-06-03T10:00:00Z",
		"updatedAt": "2026-06-03T10:00:00Z",
		"metadata":  map[string]any{"reasoningEffort": "high"},
		"messages":  []any{},
	}

	ui := toUIChat(session)
	if ui["reasoningEffort"] != "high" {
		t.Fatalf("ui reasoning effort = %#v", ui["reasoningEffort"])
	}
}

func TestChatProjectionPreservesModelOverride(t *testing.T) {
	session := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Model Override",
		"createdAt": "2026-06-03T10:00:00Z",
		"updatedAt": "2026-06-03T10:00:00Z",
		"metadata": map[string]any{
			"modelOverride.kind":       "provider",
			"modelOverride.providerId": "openai-main",
			"modelOverride.modelId":    "gpt-4.1-mini",
		},
		"messages": []any{},
	}

	ui := toUIChat(session)
	modelOverride := objectMap(ui["modelOverride"])
	if stringField(modelOverride, "providerId") != "openai-main" || stringField(modelOverride, "modelId") != "gpt-4.1-mini" {
		t.Fatalf("ui model override = %#v", ui["modelOverride"])
	}
}

func TestLegacyToolMessageProjectsAsAssistantSide(t *testing.T) {
	message := map[string]any{"type": "tool", "content": "ok"}
	if role := messageRole(message); role != "assistant" {
		t.Fatalf("role = %q", role)
	}
	if typ := messageStorageType(message); typ != "tool" {
		t.Fatalf("type = %q", typ)
	}
}

func TestAsyncToolResultProjectsAsAssistantSide(t *testing.T) {
	session := map[string]any{
		"id":        "session-async",
		"roleId":    "developer",
		"title":     "Async Tool Result",
		"createdAt": "2026-06-19T19:08:23Z",
		"updatedAt": "2026-06-19T19:08:42Z",
		"messages": []any{map[string]any{
			"id":              "m-async-result",
			"type":            "async_tool_result",
			"content":         "以下是异步任务 async-1 的执行结果",
			"parentMessageId": "m-assistant",
			"branchId":        "main",
			"createdAt":       "2026-06-19T19:08:37Z",
			"updatedAt":       "2026-06-19T19:08:37Z",
		}},
	}

	ui := toUIChat(session)
	messages := objectList(ui["messages"])
	if len(messages) != 1 {
		t.Fatalf("messages = %#v", ui["messages"])
	}
	if messages[0]["type"] != "async_tool_result" || messages[0]["role"] != "assistant" {
		t.Fatalf("ui async tool message = %#v", messages[0])
	}
}

func TestSessionFavoritesStorageKeyUsesRootAction(t *testing.T) {
	stored := map[string]any{"folders": []any{}, "chatRefsByFolderId": map[string]any{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sessions/favorites" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"data": stored})
		case http.MethodPut:
			var next map[string]any
			if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
				t.Fatalf("decode favorites request: %v", err)
			}
			stored = next
			_ = json.NewEncoder(w).Encode(map[string]any{"data": stored})
		default:
			t.Fatalf("unexpected method %s", r.Method)
		}
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.save(clientConfig{EucliBoxURL: server.URL}); err != nil {
		t.Fatalf("save config error = %v", err)
	}
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	favorites := map[string]any{
		"folders":            []any{map[string]any{"id": "favf-1", "name": "Important", "parentId": "", "createdAt": float64(1), "updatedAt": float64(1)}},
		"chatRefsByFolderId": map[string]any{"favf-1": []any{map[string]any{"targetKind": "role", "targetId": "developer", "chatId": "session-1", "addedAt": float64(2)}}},
	}

	if err := projection.set(context.Background(), sessionFavoritesKey, favorites); err != nil {
		t.Fatalf("projection.set() error = %v", err)
	}
	loaded, err := projection.get(context.Background(), sessionFavoritesKey)
	if err != nil {
		t.Fatalf("projection.get() error = %v", err)
	}
	loadedMap := objectMap(loaded)
	if refs := objectMap(loadedMap["chatRefsByFolderId"]); refs["favf-1"] == nil {
		t.Fatalf("loaded favorites = %#v", loadedMap)
	}
}

func TestRoleProjectionPreservesHookPromptPresetID(t *testing.T) {
	role := map[string]any{
		"id":                 "developer",
		"name":               "Developer",
		"avatar":             "🙂",
		"hookPromptPresetId": "preset-review",
		"prompts": []any{map[string]any{
			"role":    "system",
			"content": "You are a developer.",
		}},
		"modelConfig": map[string]any{
			"coordinate":  map[string]any{"kind": "provider", "providerId": "openai-main", "modelId": "gpt-4.1"},
			"temperature": float64(0.7),
		},
	}

	ui := toUIRole(role)
	if ui["hookPromptPresetId"] != "preset-review" {
		t.Fatalf("ui hook prompt preset id = %#v", ui["hookPromptPresetId"])
	}
	back := fromUIRole(ui)
	if back["hookPromptPresetId"] != "preset-review" {
		t.Fatalf("saved hook prompt preset id = %#v", back["hookPromptPresetId"])
	}
}

func TestMetaSavePreservesStickerProjectionSettings(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/stickers" || r.Method != http.MethodGet {
			t.Fatalf("unexpected stickers request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"categories": []any{}, "map": map[string]any{}}})
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.save(clientConfig{EucliBoxURL: server.URL}); err != nil {
		t.Fatalf("save config error = %v", err)
	}

	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	if err := projection.set(context.Background(), "stickers/index", map[string]any{"enabled": true}); err != nil {
		t.Fatalf("save stickers error = %v", err)
	}
	if err := projection.set(context.Background(), "meta/index", map[string]any{"ui": map[string]any{}, "settings": map[string]any{"streamEnabled": false}}); err != nil {
		t.Fatalf("save meta error = %v", err)
	}

	loaded, err := projection.get(context.Background(), "stickers/index")
	if err != nil {
		t.Fatalf("load stickers error = %v", err)
	}
	stickers := objectMap(loaded)
	if enabled := boolField(stickers, "enabled", false); !enabled {
		t.Fatalf("stickers enabled was not preserved: %#v", stickers)
	}

	cfg, err := store.load()
	if err != nil {
		t.Fatalf("load config error = %v", err)
	}
	if streamEnabled := boolField(cfg.Projection.Settings, "streamEnabled", true); streamEnabled {
		t.Fatalf("meta settings were not saved: %#v", cfg.Projection.Settings)
	}
}

func TestMergeProjectionSettingsForMetaSaveOwnsOnlyMetaSettings(t *testing.T) {
	merged := mergeProjectionSettingsForMetaSave(
		map[string]any{
			"stickers":  map[string]any{"enabled": true},
			"providers": []any{map[string]any{"id": "stale-provider"}},
		},
		map[string]any{
			"streamEnabled": false,
			"stickers":      map[string]any{"enabled": false},
			"providers":     []any{map[string]any{"id": "derived-provider"}},
			"aiServices": map[string]any{
				"stickerNaming": map[string]any{"enabled": true},
				"mermaidFix":    map[string]any{"enabled": true},
				"localOnly":     map[string]any{"enabled": true},
			},
		},
	)

	if enabled := boolField(objectMap(merged["stickers"]), "enabled", false); !enabled {
		t.Fatalf("dedicated stickers setting was not preserved: %#v", merged)
	}
	if _, ok := merged["providers"]; ok {
		t.Fatalf("derived providers should not be stored in projection settings: %#v", merged)
	}
	services := objectMap(merged["aiServices"])
	if _, ok := services["stickerNaming"]; ok {
		t.Fatalf("stickerNaming should be saved through assist config, not projection settings: %#v", services)
	}
	if _, ok := services["mermaidFix"]; ok {
		t.Fatalf("mermaidFix should be saved through assist config, not projection settings: %#v", services)
	}
	if services["localOnly"] == nil {
		t.Fatalf("unowned local aiServices settings should be preserved: %#v", services)
	}
	if streamEnabled := boolField(merged, "streamEnabled", true); streamEnabled {
		t.Fatalf("meta-owned setting was not updated: %#v", merged)
	}
}

func TestRunningSessionDoesNotInventAssistantRunIdentity(t *testing.T) {
	session := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Streaming",
		"status":    runStatusRunning,
		"createdAt": "2026-06-03T10:00:00Z",
		"updatedAt": "2026-06-03T10:00:00Z",
		"messages": []any{
			map[string]any{"id": "u1", "type": "user", "content": "hi", "createdAt": "2026-06-03T10:00:00Z", "updatedAt": "2026-06-03T10:00:00Z"},
			map[string]any{"id": "a1", "type": "assistant", "content": "", "parentMessageId": "u1", "createdAt": "2026-06-03T10:00:01Z", "updatedAt": "2026-06-03T10:00:01Z"},
		},
	}

	ui := toUIChat(session)
	if ui["status"] != runStatusRunning {
		t.Fatalf("ui status = %#v", ui["status"])
	}
	messages := objectList(ui["messages"])
	if len(messages) != 2 {
		t.Fatalf("messages = %#v", ui["messages"])
	}
	assistant := messages[1]
	if _, ok := assistant["pending"]; ok {
		t.Fatalf("assistant pending was invented from session status: %#v", assistant)
	}
	if _, ok := assistant["streaming"]; ok {
		t.Fatalf("assistant streaming was invented from session status: %#v", assistant)
	}
}

func TestChatProjectionPreservesAssistantError(t *testing.T) {
	session := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Error",
		"createdAt": "2026-06-03T10:00:00Z",
		"updatedAt": "2026-06-03T10:00:00Z",
		"messages": []any{map[string]any{
			"id":              "a1",
			"type":            "assistant",
			"content":         "",
			"parentMessageId": "u1",
			"createdAt":       "2026-06-03T10:00:00Z",
			"updatedAt":       "2026-06-03T10:00:00Z",
			"error":           map[string]any{"code": "provider.service_failed", "message": "upstream says no", "details": map[string]any{"body": "raw"}},
		}},
	}

	ui := toUIChat(session)
	messages := objectList(ui["messages"])
	if len(messages) != 1 {
		t.Fatalf("messages = %#v", ui["messages"])
	}
	if errBox := objectMap(messages[0]["error"]); stringField(errBox, "message") != "upstream says no" || stringField(errBox, "code") != "provider.service_failed" {
		t.Fatalf("ui error = %#v", messages[0]["error"])
	}
}

func TestStableUpdatedAtUsesMaxPositiveValue(t *testing.T) {
	if got := stableUpdatedAt(0, -1); got != 1 {
		t.Fatalf("empty stable updatedAt = %d", got)
	}
	if got := stableUpdatedAt(10, 42, 20); got != 42 {
		t.Fatalf("stable updatedAt = %d", got)
	}
}
