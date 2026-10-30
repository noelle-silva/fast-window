package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// sessionRelayBox 是只关心「会话正文与窗口如何被请求」的最小业务端。
type sessionRelayBox struct {
	server    *httptest.Server
	body      string
	window    string
	lastQuery string
	lastPath  string
	requests  int
}

func newSessionRelayBox(t *testing.T) *sessionRelayBox {
	t.Helper()
	box := &sessionRelayBox{
		body:   `{"id":"chat-1","roleId":"role-1","title":"标题","schemaVersion":1,"messages":[{"id":"m1","branchId":"main","parentMessageId":"","createdAt":1}],"asyncToolTasks":[{"id":"task-1"}]}`,
		window: `{"messages":[{"id":"m1","branchId":"main","parentMessageId":"p0","createdAt":1}],"nextCursor":"cur-2"}`,
	}
	box.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		box.requests++
		box.lastPath = r.URL.Path
		box.lastQuery = r.URL.RawQuery
		if r.URL.Path == "/api/roles/role-1/sessions/chat-1/window" {
			_, _ = io.WriteString(w, `{"data":`+box.window+`}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":`+box.body+`}`)
	}))
	t.Cleanup(box.server.Close)
	return box
}

func (b *sessionRelayBox) service(t *testing.T) *service {
	t.Helper()
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(b.server.URL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	return newBusinessReadyTestService(store, nil)
}

// TestSessionGetRelaysRawSessionBytes 钉住 P2 的核心：
// studio 不再重建会话模型，box 独有字段（asyncToolTasks / roleId）原样抵达前端。
func TestSessionGetRelaysRawSessionBytes(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)

	params, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
	})
	result, err := svc.dispatch(context.Background(), "aiChat.session.get", params)
	if err != nil {
		t.Fatalf("session.get error = %v", err)
	}
	raw, ok := result.(rawResult)
	if !ok {
		t.Fatalf("session.get 结果必须是原始字节，实际 %T", result)
	}
	if string(raw.payload) != box.body {
		t.Fatalf("载荷被改写：\n%s\n%s", raw.payload, box.body)
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw.payload, &decoded); err != nil {
		t.Fatalf("decode payload error = %v", err)
	}
	if _, exists := decoded["asyncToolTasks"]; !exists {
		t.Fatalf("asyncToolTasks 丢失：%#v", decoded)
	}
	if stringField(decoded, "roleId") != "role-1" {
		t.Fatalf("roleId 丢失：%#v", decoded)
	}
}

// TestSessionGetForwardsProfile 钉住 profile 枚举：studio 只转发，不做第二次取舍。
func TestSessionGetForwardsProfile(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)

	params, _ := json.Marshal(map[string]any{
		"scope":   map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":  "chat-1",
		"profile": "edit",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err != nil {
		t.Fatalf("session.get error = %v", err)
	}
	if box.lastQuery != "profile=edit" {
		t.Fatalf("query = %q, want profile=edit", box.lastQuery)
	}

	// 缺省 profile 是 view。
	params, _ = json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err != nil {
		t.Fatalf("session.get error = %v", err)
	}
	if box.lastQuery != "profile=view" {
		t.Fatalf("query = %q, want profile=view", box.lastQuery)
	}

	// 非法 profile 必须快速失败。
	params, _ = json.Marshal(map[string]any{
		"scope":   map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":  "chat-1",
		"profile": "bogus",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err == nil {
		t.Fatal("非法 profile 必须失败")
	}
}

// TestSessionWindowForwardsWindowParams 钉住 P3 studio 侧：
// 只做参数校验与转发，分页语义属于业务端。
func TestSessionWindowForwardsWindowParams(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)

	params, _ := json.Marshal(map[string]any{
		"scope":    map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":   "chat-1",
		"head":     "m9",
		"before":   "m9",
		"limit":    24,
		"maxBytes": 524288,
		"cursor":   "opaque-cursor",
	})
	result, err := svc.dispatch(context.Background(), "aiChat.session.window", params)
	if err != nil {
		t.Fatalf("session.window error = %v", err)
	}
	raw, ok := result.(rawResult)
	if !ok {
		t.Fatalf("session.window 结果必须是原始字节，实际 %T", result)
	}
	if string(raw.payload) != box.window {
		t.Fatalf("窗口载荷被改写：%s", raw.payload)
	}
	if box.lastPath != "/api/roles/role-1/sessions/chat-1/window" {
		t.Fatalf("path = %q", box.lastPath)
	}
	for _, expected := range []string{"head=m9", "before=m9", "limit=24", "maxBytes=524288", "profile=view", "cursor=opaque-cursor"} {
		if !containsQuery(box.lastQuery, expected) {
			t.Fatalf("query %q 缺少 %q", box.lastQuery, expected)
		}
	}
}

func TestSessionWindowAppliesDefaultsAndClamps(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)

	params, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
		"limit":  100000,
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.window", params); err != nil {
		t.Fatalf("session.window error = %v", err)
	}
	if !containsQuery(box.lastQuery, "limit=200") {
		t.Fatalf("limit 未被收敛：%q", box.lastQuery)
	}
	if !containsQuery(box.lastQuery, "maxBytes=524288") {
		t.Fatalf("maxBytes 缺省值不对：%q", box.lastQuery)
	}

	// maxBytes 低于下限必须快速失败，而不是静默改成默认值。
	params, _ = json.Marshal(map[string]any{
		"scope":    map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":   "chat-1",
		"maxBytes": 1024,
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.window", params); err == nil {
		t.Fatal("越界 maxBytes 必须失败")
	}
}

func TestSessionWindowRequiresScopeAndChatID(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)

	if _, err := svc.dispatch(context.Background(), "aiChat.session.window", json.RawMessage(`{"chatId":"chat-1"}`)); err == nil {
		t.Fatal("缺少 scope 必须失败")
	}
	params, _ := json.Marshal(map[string]any{"scope": map[string]any{"kind": "role", "targetId": "role-1"}})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.window", params); err == nil {
		t.Fatal("缺少 chatId 必须失败")
	}
}

// TestGroupSessionRelayUsesGroupRoute 钉住群聊 scope 走群聊路由。
func TestGroupSessionRelayUsesGroupRoute(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)

	params, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "group", "targetId": "group-1"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err != nil {
		t.Fatalf("session.get error = %v", err)
	}
	if box.lastPath != "/api/groups/group-1/sessions/chat-1" {
		t.Fatalf("path = %q", box.lastPath)
	}
}

// TestSessionBodyIsSingleFlight 钉住会话正文的并发合流。
func TestSessionBodyIsSingleFlight(t *testing.T) {
	box := newSessionRelayBox(t)
	svc := box.service(t)
	params, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
	})

	done := make(chan struct{}, 8)
	for i := 0; i < 8; i++ {
		go func() {
			defer func() { done <- struct{}{} }()
			if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err != nil {
				t.Errorf("session.get error = %v", err)
			}
		}()
	}
	for i := 0; i < 8; i++ {
		<-done
	}
	if box.requests != 1 {
		t.Fatalf("并发加载应单飞，实际 %d 次请求", box.requests)
	}
}

func containsQuery(query string, expected string) bool {
	return strings.Contains("&"+query+"&", "&"+expected+"&")
}
