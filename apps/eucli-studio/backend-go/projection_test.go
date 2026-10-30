package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

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
	if _, err := store.saveConnection(server.URL, "", false); err != nil {
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
		"hookPromptPresetId": "preset-review",
		"prompts": []any{map[string]any{
			"role":    "system",
			"content": "You are a developer.",
		}},
		"modelConfig": map[string]any{
			"candidates": []any{map[string]any{
				"id":         "cand-primary",
				"coordinate": map[string]any{"kind": "provider", "providerId": "openai-main", "modelId": "gpt-4.1"},
			}},
			"defaultCandidateId": "cand-primary",
			"temperature":        float64(1),
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

// TestRoleProjectionKeepsCandidatePool 钉住候选池与默认选择的投影往返：
// 默认选择只保存引用标识，候选坐标只保存在池里。
func TestRoleProjectionKeepsCandidatePool(t *testing.T) {
	role := map[string]any{
		"id":      "developer",
		"name":    "Developer",
		"prompts": []any{map[string]any{"role": "system", "content": "You are a developer."}},
		"modelConfig": map[string]any{
			"candidates": []any{
				map[string]any{"id": "cand-primary", "coordinate": map[string]any{"kind": "provider", "providerId": "openai-main", "modelId": "gpt-4.1"}},
				map[string]any{"id": "cand-backup", "coordinate": map[string]any{"kind": "model_group", "groupId": "main-group", "modelId": "balanced"}},
			},
			"defaultCandidateId": "cand-backup",
			"temperature":        float64(0.5),
		},
	}

	ui := toUIRole(role)
	candidates := objectList(ui["modelCandidates"])
	if len(candidates) != 2 {
		t.Fatalf("ui candidates = %#v", candidates)
	}
	if ui["defaultModelCandidateId"] != "model_group:main-group:balanced" {
		t.Fatalf("ui default candidate id = %#v", ui["defaultModelCandidateId"])
	}

	back := fromUIRole(ui)
	backConfig := objectMap(back["modelConfig"])
	backCandidates := objectList(backConfig["candidates"])
	if len(backCandidates) != 2 {
		t.Fatalf("saved candidates = %#v", backCandidates)
	}
	if backConfig["defaultCandidateId"] != "model_group:main-group:balanced" {
		t.Fatalf("saved default candidate id = %#v", backConfig["defaultCandidateId"])
	}
	if coordinate := objectMap(objectMap(backCandidates[1])["coordinate"]); stringField(coordinate, "groupId") != "main-group" {
		t.Fatalf("saved second candidate coordinate = %#v", coordinate)
	}
}

// TestRoleProjectionTranslatesLegacyCoordinate 钉住旧单一坐标形态的读取：
// 坐标直接翻译为「一个候选 + 它即默认」，不需要迁移动作。
func TestRoleProjectionTranslatesLegacyCoordinate(t *testing.T) {
	role := map[string]any{
		"id":      "developer",
		"name":    "Developer",
		"prompts": []any{map[string]any{"role": "system", "content": "You are a developer."}},
		"modelConfig": map[string]any{
			"coordinate":  map[string]any{"kind": "provider", "providerId": "openai-main", "modelId": "gpt-4.1"},
			"temperature": float64(1),
		},
	}

	ui := toUIRole(role)
	candidates := objectList(ui["modelCandidates"])
	if len(candidates) != 1 {
		t.Fatalf("ui candidates = %#v", candidates)
	}
	if ui["defaultModelCandidateId"] != "provider:openai-main:gpt-4.1" {
		t.Fatalf("ui default candidate id = %#v", ui["defaultModelCandidateId"])
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
	if _, err := store.saveConnection(server.URL, "", false); err != nil {
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

func TestSessionIndexCarriesLastMessagePreview(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/roles/developer/sessions" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{
			"id":                 "session-1",
			"roleId":             "developer",
			"title":              "首条消息标题",
			"lastMessagePreview": "最后的消息",
			"status":             "completed",
			"createdAt":          "2026-06-03T10:00:00Z",
			"updatedAt":          "2026-06-03T10:00:00Z",
			"lastActive":         "2026-06-03T10:00:00Z",
		}}})
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(server.URL, "", false); err != nil {
		t.Fatalf("save config error = %v", err)
	}
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))

	index, err := projection.sessionsIndexForRole(context.Background(), "developer")
	if err != nil {
		t.Fatalf("sessionsIndexForRole() error = %v", err)
	}
	metas := objectList(objectMap(index)["chatMetas"])
	if len(metas) != 1 {
		t.Fatalf("chatMetas = %#v", objectMap(index)["chatMetas"])
	}
	if got := stringField(metas[0], "lastMessagePreview"); got != "最后的消息" {
		t.Fatalf("lastMessagePreview = %q", got)
	}
	if got := stringField(metas[0], "title"); got != "首条消息标题" {
		t.Fatalf("title = %q", got)
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
