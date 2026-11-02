package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// TestSaveMetaNeverWritesAssistConfig 钉住解耦后的边界：
// meta 只写客户端本地偏好，绝不再顺带 PUT 任何 assist 端点。
func TestSaveMetaNeverWritesAssistConfig(t *testing.T) {
	var mu sync.Mutex
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests = append(requests, r.Method+" "+r.URL.Path)
		mu.Unlock()
		http.Error(w, "saveMeta 不应访问业务端", http.StatusInternalServerError)
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

	err = projection.set(context.Background(), "meta/index", map[string]any{
		"ui": map[string]any{"theme": "dark"},
		"settings": map[string]any{
			"streamEnabled": false,
			"aiServices": map[string]any{
				"mermaidFix": map[string]any{"enabled": true, "providerId": "provider-1", "modelId": "model-1"},
			},
		},
	})
	if err != nil {
		t.Fatalf("save meta error = %v", err)
	}

	cfg, err := store.load()
	if err != nil {
		t.Fatalf("load config error = %v", err)
	}
	if enabled := boolField(cfg.Projection.Settings, "streamEnabled", true); enabled {
		t.Fatalf("meta settings were not saved: %#v", cfg.Projection.Settings)
	}
	if _, ok := objectMap(cfg.Projection.Settings["aiServices"])["mermaidFix"]; ok {
		t.Fatalf("aiServices 不应写入客户端 projection settings: %#v", cfg.Projection.Settings)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 0 {
		t.Fatalf("saveMeta 不应产生任何业务请求，收到 %#v", requests)
	}
}

// TestAssistConfigSetWritesOnlyTargetService 钉住显式方法的作用域：
// 一次调用只命中该 service 的端点，且写入体保持既有转换语义。
func TestAssistConfigSetWritesOnlyTargetService(t *testing.T) {
	type recordedRequest struct {
		method string
		path   string
		body   map[string]any
	}
	var mu sync.Mutex
	requests := []recordedRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode assist body: %v", err)
		}
		mu.Lock()
		requests = append(requests, recordedRequest{method: r.Method, path: r.URL.Path, body: body})
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": body})
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

	err = projection.setAssistConfig(context.Background(), "mermaidFix", map[string]any{
		"enabled":        true,
		"kind":           "provider",
		"providerId":     "provider-1",
		"modelId":        "model-1",
		"systemPrompt":   "fix mermaid",
		"lowTemperature": false,
	})
	if err != nil {
		t.Fatalf("set mermaidFix error = %v", err)
	}

	mu.Lock()
	if len(requests) != 1 {
		mu.Unlock()
		t.Fatalf("mermaidFix 应只写一个端点，收到 %#v", requests)
	}
	mermaid := requests[0]
	mu.Unlock()
	if mermaid.method != http.MethodPut || mermaid.path != "/api/assist/mermaid-fix/config" {
		t.Fatalf("mermaidFix request = %s %s", mermaid.method, mermaid.path)
	}
	if enabled := boolField(mermaid.body, "enabled", false); !enabled {
		t.Fatalf("mermaidFix enabled body = %#v", mermaid.body)
	}
	if got := stringField(mermaid.body, "modelPick"); got != "model-1" {
		t.Fatalf("mermaidFix modelPick = %q", got)
	}
	if got := stringField(objectMap(mermaid.body["coordinate"]), "providerId"); got != "provider-1" {
		t.Fatalf("mermaidFix coordinate = %#v", mermaid.body["coordinate"])
	}
	if got := stringField(mermaid.body, "systemPrompt"); got != "fix mermaid" {
		t.Fatalf("mermaidFix systemPrompt = %q", got)
	}
	if lowTemperature := boolField(mermaid.body, "lowTemperature", true); lowTemperature {
		t.Fatalf("mermaidFix lowTemperature = %#v", mermaid.body)
	}

	err = projection.setAssistConfig(context.Background(), "contextCompression", map[string]any{
		"kind":                 "model_group",
		"groupId":              "group-1",
		"modelId":              "model-2",
		"retainRecentMessages": 9,
	})
	if err != nil {
		t.Fatalf("set contextCompression error = %v", err)
	}

	mu.Lock()
	if len(requests) != 2 {
		mu.Unlock()
		t.Fatalf("contextCompression 应只追加一个端点，收到 %#v", requests)
	}
	compression := requests[1]
	mu.Unlock()
	if compression.method != http.MethodPut || compression.path != "/api/assist/context-compression/config" {
		t.Fatalf("contextCompression request = %s %s", compression.method, compression.path)
	}
	if _, ok := compression.body["enabled"]; ok {
		t.Fatalf("contextCompression 不应携带 enabled: %#v", compression.body)
	}
	if _, ok := compression.body["systemPrompt"]; ok {
		t.Fatalf("contextCompression 不应携带 systemPrompt: %#v", compression.body)
	}
	if got := intField(compression.body, "retainRecentMessages", 0); got != 9 {
		t.Fatalf("contextCompression retainRecentMessages = %d", got)
	}
	if got := stringField(objectMap(compression.body["coordinate"]), "groupId"); got != "group-1" {
		t.Fatalf("contextCompression coordinate = %#v", compression.body["coordinate"])
	}
}

// TestMetaStillReadsAssistConfig 钉住读取路径不变：
// meta 仍然从四个 assist 端点组装 settings.aiServices。
func TestMetaStillReadsAssistConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected method %s %s", r.Method, r.URL.Path)
		}
		switch r.URL.Path {
		case "/api/roles", "/api/providers", "/api/model-groups", "/api/groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
		case "/api/assist/mermaid-fix/config":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
				"enabled":        true,
				"coordinate":     map[string]any{"kind": "provider", "providerId": "provider-1", "modelId": "model-1"},
				"modelPick":      "model-1",
				"systemPrompt":   "fix mermaid",
				"lowTemperature": false,
			}})
		default:
			if !strings.HasPrefix(r.URL.Path, "/api/assist/") {
				t.Fatalf("unexpected path %s", r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
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

	value, err := projection.get(context.Background(), "meta/index")
	if err != nil {
		t.Fatalf("get meta error = %v", err)
	}
	services := objectMap(objectMap(objectMap(value)["settings"])["aiServices"])
	mermaid := objectMap(services["mermaidFix"])
	if enabled := boolField(mermaid, "enabled", false); !enabled {
		t.Fatalf("meta mermaidFix enabled = %#v", mermaid)
	}
	if got := stringField(mermaid, "providerId"); got != "provider-1" {
		t.Fatalf("meta mermaidFix providerId = %q", got)
	}
	if got := stringField(mermaid, "modelId"); got != "model-1" {
		t.Fatalf("meta mermaidFix modelId = %q", got)
	}
}

// TestAssistConfigSetDispatchClassification 钉住新方法的路由分类：
// 业务方法、remote 道、按 service 串行、后台超时预算。
func TestAssistConfigSetDispatchClassification(t *testing.T) {
	if !isBusinessMethod("aiChat.assistConfig.set") {
		t.Fatal("assistConfig.set 必须走业务连接门禁")
	}
	params := paramsOf(t, map[string]any{
		"service": "stickerNaming",
		"config":  map[string]any{"enabled": true},
	})
	peek := peekRequestParams("aiChat.assistConfig.set", params)
	intent := classifyRequest("aiChat.assistConfig.set", peek)
	if intent.lane != laneRemote {
		t.Fatalf("assistConfig.set lane = %v, want remote", intent.lane)
	}
	if intent.sequenceKey != "assist:stickerNaming" {
		t.Fatalf("assistConfig.set sequence = %q", intent.sequenceKey)
	}
	if class := methodTimeoutClass("aiChat.assistConfig.set", ebRequest{}); class != timeoutClassBackground {
		t.Fatalf("assistConfig.set timeout class = %v, want background", class)
	}
}
