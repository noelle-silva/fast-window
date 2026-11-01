package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func runEventFrame(t *testing.T, eventType string, fields map[string]any) json.RawMessage {
	t.Helper()
	payload := map[string]any{"id": "run-1", "status": "running"}
	for key, value := range fields {
		payload[key] = value
	}
	raw, err := json.Marshal(map[string]any{
		"id":      "event-1",
		"runId":   "run-1",
		"type":    eventType,
		"payload": payload,
	})
	if err != nil {
		t.Fatalf("marshal run event: %v", err)
	}
	return raw
}

func TestRunSessionIndexScope(t *testing.T) {
	cases := []struct {
		name      string
		eventType string
		fields    map[string]any
		wantKey   string
		wantOK    bool
	}{
		{name: "角色运行开始", eventType: "run_started", fields: map[string]any{"roleId": "role-1"}, wantKey: "role:role-1", wantOK: true},
		{name: "角色运行完成", eventType: "run_completed", fields: map[string]any{"roleId": "role-1"}, wantKey: "role:role-1", wantOK: true},
		{name: "角色运行失败", eventType: "run_failed", fields: map[string]any{"roleId": "role-1"}, wantKey: "role:role-1", wantOK: true},
		{name: "角色运行取消", eventType: "run_cancelled", fields: map[string]any{"roleId": "role-1"}, wantKey: "role:role-1", wantOK: true},
		{name: "单 l 取消别名", eventType: "run_canceled", fields: map[string]any{"roleId": "role-1"}, wantKey: "role:role-1", wantOK: true},
		{name: "群聊优先于角色", eventType: "run_completed", fields: map[string]any{"roleId": "role-1", "groupId": "group-1"}, wantKey: "group:group-1", wantOK: true},
		{name: "内容事件不是索引信号", eventType: "assistant_message_delta", fields: map[string]any{"roleId": "role-1"}, wantOK: false},
		{name: "模型输出不是索引信号", eventType: "model_output", fields: map[string]any{"roleId": "role-1"}, wantOK: false},
		{name: "缺少归属不是索引信号", eventType: "run_completed", fields: map[string]any{}, wantOK: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scope, ok := runSessionIndexScope(runEventFrame(t, testCase.eventType, testCase.fields))
			if ok != testCase.wantOK {
				t.Fatalf("ok = %v, want %v", ok, testCase.wantOK)
			}
			if ok && scope.key() != testCase.wantKey {
				t.Fatalf("scope = %q, want %q", scope.key(), testCase.wantKey)
			}
		})
	}
}

// 回归：运行终态必须让会话索引缓存失效，否则新会话会一直缺席侧边栏。
func TestRunTerminalInvalidatesSessionIndex(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	service := &service{projection: projection}
	scope := roleScope("role-1")
	ctx := context.Background()

	if _, err := projection.ensureSessionIndex(ctx, scope); err != nil {
		t.Fatalf("ensureSessionIndex() error = %v", err)
	}
	if projection.model.sessions.peek(scope) == nil {
		t.Fatal("首次读取后索引快照应已缓存")
	}
	loads := box.log.count(http.MethodGet, "/api/roles/role-1/sessions")
	if loads != 1 {
		t.Fatalf("会话索引应只读取一次，实际 %d", loads)
	}

	service.noteRunLifecycleForSessionIndex(runEventFrame(t, "run_completed", map[string]any{"roleId": "role-1"}))
	if projection.model.sessions.peek(scope) != nil {
		t.Fatal("运行终态后索引快照必须失效")
	}

	if _, err := projection.ensureSessionIndex(ctx, scope); err != nil {
		t.Fatalf("ensureSessionIndex() after invalidate error = %v", err)
	}
	if got := box.log.count(http.MethodGet, "/api/roles/role-1/sessions"); got != 2 {
		t.Fatalf("失效后应重新读取业务端，实际读取次数 %d", got)
	}
}

// 内容事件不得让索引失效：否则每帧正文增量都会触发一次全量会话列表重拉。
func TestContentEventKeepsSessionIndex(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	service := &service{projection: projection}
	scope := roleScope("role-1")
	ctx := context.Background()

	if _, err := projection.ensureSessionIndex(ctx, scope); err != nil {
		t.Fatalf("ensureSessionIndex() error = %v", err)
	}
	service.noteRunLifecycleForSessionIndex(runEventFrame(t, "assistant_message_delta", map[string]any{"roleId": "role-1"}))
	if projection.model.sessions.peek(scope) == nil {
		t.Fatal("内容事件不得使索引快照失效")
	}
}
