package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGroupChatIndexStorageKeyDoesNotSaveGroupSession(t *testing.T) {
	var requested []struct {
		Method string
		Path   string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = append(requested, struct {
			Method string
			Path   string
		}{Method: r.Method, Path: r.URL.Path})
		if r.Method == http.MethodPost && r.URL.Path == "/api/groups/group-1/sessions" {
			t.Fatalf("group chat index was routed as a group session save")
		}
		if r.Method == http.MethodDelete && r.URL.Path == "/api/groups/group-1/sessions/index" {
			t.Fatalf("group chat index was routed as a group session delete")
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "group-1"}}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/groups/group-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "group-1", "name": "群组"}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
		}
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.save(clientConfig{EucliBoxURL: server.URL, Projection: projectionConfig{GroupFolders: map[string]string{"group-1": "群组"}}}); err != nil {
		t.Fatalf("save config error = %v", err)
	}

	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	if err := projection.set(context.Background(), "groups/群组/chats/index", map[string]any{"activeChatId": "chat-1"}); err != nil {
		t.Fatalf("projection.set() error = %v", err)
	}

	cfg, err := store.load()
	if err != nil {
		t.Fatalf("load config error = %v", err)
	}
	if got := cfg.Projection.ActiveChatByGroup["group-1"]; got != "chat-1" {
		t.Fatalf("active group chat = %q, want chat-1", got)
	}
	if err := projection.remove(context.Background(), "groups/群组/chats/index"); err != nil {
		t.Fatalf("projection.remove() error = %v", err)
	}
	cfg, err = store.load()
	if err != nil {
		t.Fatalf("reload config error = %v", err)
	}
	if got := cfg.Projection.ActiveChatByGroup["group-1"]; got != "" {
		t.Fatalf("active group chat after index remove = %q, want empty", got)
	}
	for _, req := range requested {
		if req.Method == http.MethodPost && req.Path == "/api/groups/group-1/sessions" {
			t.Fatalf("unexpected group session save request: %#v", requested)
		}
		if req.Method == http.MethodDelete && req.Path == "/api/groups/group-1/sessions/index" {
			t.Fatalf("unexpected group session delete request: %#v", requested)
		}
	}
}
