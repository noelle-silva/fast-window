package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 决策 3 的 PATCH {base}/view：把「用户在看哪条路径」变成服务端事实。
//
// 过去前端只改本地 chat.branching，从不回写；多客户端 / 重启后视图丢失。

func newViewPatchBox(t *testing.T) (*httptest.Server, *[]struct{ Method, Path, Body string }) {
	t.Helper()
	requests := &[]struct{ Method, Path, Body string }{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := ""
		if r.Body != nil {
			buf := make([]byte, 4096)
			n, _ := r.Body.Read(buf)
			body = string(buf[:n])
		}
		*requests = append(*requests, struct{ Method, Path, Body string }{r.Method, r.URL.Path, body})
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"ok": true}})
	}))
	t.Cleanup(server.Close)
	return server, requests
}

func newViewPatchService(t *testing.T, boxURL string) *service {
	t.Helper()
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(boxURL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	svc, err := newService(store, testClientRelease(), nil)
	if err != nil {
		t.Fatalf("newService() error = %v", err)
	}
	svc.setConnectionState(runtimeBootstrap{BusinessAvailable: true, EucliBoxURL: boxURL})
	return svc
}

func TestSessionViewPatchesBoxViewEndpoint(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":    map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":   "chat-1",
		"head":     "m-head",
		"branchId": "main",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.view", payload); err != nil {
		t.Fatalf("session.view error = %v", err)
	}

	if len(*requests) != 1 {
		t.Fatalf("期望一次 PATCH，实际 %#v", *requests)
	}
	got := (*requests)[0]
	if got.Method != http.MethodPatch {
		t.Fatalf("method = %q, want PATCH", got.Method)
	}
	if got.Path != "/api/roles/role-1/sessions/chat-1/view" {
		t.Fatalf("path = %q", got.Path)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(got.Body), &body); err != nil {
		t.Fatalf("body 不是 JSON：%v（%q）", err, got.Body)
	}
	if stringField(body, "head") != "m-head" {
		t.Fatalf("body.head = %#v", body["head"])
	}
	if stringField(body, "branchId") != "main" {
		t.Fatalf("body.branchId = %#v", body["branchId"])
	}
}

func TestSessionViewRoutesGroupScope(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "group", "targetId": "group-1"},
		"chatId": "chat-1",
		"head":   "m-head",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.view", payload); err != nil {
		t.Fatalf("session.view error = %v", err)
	}
	if got := (*requests)[0].Path; got != "/api/groups/group-1/sessions/chat-1/view" {
		t.Fatalf("path = %q", got)
	}
}

func TestSessionViewRequiresHead(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.view", payload); err == nil {
		t.Fatalf("缺少 head 必须快速失败")
	}
	if len(*requests) != 0 {
		t.Fatalf("校验失败时不得打业务端：%#v", *requests)
	}
}

func TestSessionViewRejectsInvalidScope(t *testing.T) {
	server, requests := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "bogus", "targetId": "x"},
		"chatId": "chat-1",
		"head":   "m-head",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.view", payload); err == nil {
		t.Fatalf("非法 scope 必须快速失败")
	}
	if len(*requests) != 0 {
		t.Fatalf("校验失败时不得打业务端：%#v", *requests)
	}
}

// 视图回写后 studio 的正文合流必须作废：旧路径的窗口不能被复用。
func TestSessionViewInvalidatesBodyFlight(t *testing.T) {
	server, _ := newViewPatchBox(t)
	svc := newViewPatchService(t, server.URL)

	before := svc.projection.model.bodies.flight
	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
		"head":   "m-head",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.view", payload); err != nil {
		t.Fatalf("session.view error = %v", err)
	}
	if svc.projection.model.bodies.flight == before {
		t.Fatalf("视图改变后必须作废正文合流")
	}
}
