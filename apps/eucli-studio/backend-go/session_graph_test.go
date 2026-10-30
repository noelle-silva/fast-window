package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// graph 投影：树视图需要完整 DAG，但窗口只有一窗消息。
func TestSessionGraphForwardsToBoxGraphEndpoint(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.graph", payload); err != nil {
		t.Fatalf("session.graph error = %v", err)
	}
	if len(*requests) != 1 {
		t.Fatalf("期望一次请求，实际 %#v", *requests)
	}
	got := (*requests)[0]
	if got.Method != http.MethodGet {
		t.Fatalf("method = %q, want GET", got.Method)
	}
	if got.Path != "/api/roles/role-1/sessions/chat-1/graph" {
		t.Fatalf("path = %q", got.Path)
	}
}

func TestSessionGraphRoutesGroupScope(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "group", "targetId": "group-1"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.graph", payload); err != nil {
		t.Fatalf("session.graph error = %v", err)
	}
	if got := (*requests)[0].Path; got != "/api/groups/group-1/sessions/chat-1/graph" {
		t.Fatalf("path = %q", got)
	}
}

func TestSessionGraphRejectsMissingChatID(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope": map[string]any{"kind": "role", "targetId": "role-1"},
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.graph", payload); err == nil {
		t.Fatalf("缺少 chatId 必须快速失败")
	}
	if len(*requests) != 0 {
		t.Fatalf("校验失败时不得打业务端：%#v", *requests)
	}
}

func TestSessionGraphRejectsInvalidScope(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "bogus", "targetId": "x"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.graph", payload); err == nil {
		t.Fatalf("非法 scope 必须快速失败")
	}
	if len(*requests) != 0 {
		t.Fatalf("校验失败时不得打业务端：%#v", *requests)
	}
}
