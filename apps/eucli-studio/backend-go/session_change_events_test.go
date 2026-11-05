package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func sessionChangeFrame(t *testing.T, event map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal session change: %v", err)
	}
	return raw
}

func validSessionChangeFixture() map[string]any {
	return map[string]any{
		"targetKind": sessionChangeTargetMessage,
		"location": map[string]any{
			"kind":      sessionLocationRole,
			"roleId":    "role-1",
			"sessionId": "chat-1",
		},
		"changeType": sessionChangeMessageAdded,
		"version":    7,
		"occurredAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func TestReadSessionChangeFrameClassifiesSessionChanges(t *testing.T) {
	raw := sessionChangeFrame(t, validSessionChangeFixture())
	event, isSession := readSessionChangeFrame(raw)
	if !isSession {
		t.Fatal("会话变更帧必须被识别为会话变更，而不是运行事件")
	}
	if !event.valid() {
		t.Fatal("合法会话变更帧必须通过契约校验")
	}
	if event.Location.SessionID != "chat-1" || event.Version != 7 {
		t.Fatalf("event = %#v", event)
	}
}

func TestReadSessionChangeFrameLeavesRunEventsAlone(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"type":"run_completed","runId":"run-1","payload":{"roleId":"role-1"}}`),
		// 运行事件载荷里出现同名键也不能改变信封身份：只看顶层字段。
		json.RawMessage(`{"type":"run_completed","runId":"run-1","payload":{"changeType":"message_added"}}`),
	} {
		if _, isSession := readSessionChangeFrame(raw); isSession {
			t.Fatalf("运行事件不得被识别为会话变更：%s", raw)
		}
	}
}

// 畸形的会话变更帧必须被识别并丢弃：绝不能降级成运行事件透传给前端。
func TestReadSessionChangeFrameMarksMalformedSessionShape(t *testing.T) {
	cases := []map[string]any{
		{"changeType": sessionChangeMessageAdded, "version": 1},
		func() map[string]any {
			event := validSessionChangeFixture()
			event["version"] = 0
			return event
		}(),
		func() map[string]any {
			event := validSessionChangeFixture()
			event["targetKind"] = sessionChangeTargetSession
			return event
		}(),
		func() map[string]any {
			event := validSessionChangeFixture()
			event["location"] = map[string]any{"kind": sessionLocationGroup, "roleId": "role-1", "sessionId": "chat-1"}
			return event
		}(),
	}
	for _, fixture := range cases {
		event, isSession := readSessionChangeFrame(sessionChangeFrame(t, fixture))
		if !isSession {
			t.Fatalf("畸形会话变更仍必须被识别为会话变更：%#v", fixture)
		}
		if event.valid() {
			t.Fatalf("畸形会话变更不得通过契约校验：%#v", fixture)
		}
	}
}

func TestSessionChangeIndexScope(t *testing.T) {
	cases := []struct {
		name    string
		event   sessionChangeEvent
		wantKey string
		wantOK  bool
	}{
		{
			name:    "角色会话",
			event:   sessionChangeEvent{Location: sessionChangeLocation{Kind: sessionLocationRole, RoleID: "role-1", SessionID: "chat-1"}},
			wantKey: "role:role-1",
			wantOK:  true,
		},
		{
			name:    "群聊会话",
			event:   sessionChangeEvent{Location: sessionChangeLocation{Kind: sessionLocationGroup, GroupID: "group-1", SessionID: "chat-1"}},
			wantKey: "group:group-1",
			wantOK:  true,
		},
		{
			name:   "工作区会话不属于角色/群聊索引",
			event:  sessionChangeEvent{Location: sessionChangeLocation{Kind: sessionLocationWorkspace, WorkspaceID: "ws-1", RoleID: "role-1", SessionID: "chat-1"}},
			wantOK: false,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			scope, ok := testCase.event.indexScope()
			if ok != testCase.wantOK {
				t.Fatalf("ok = %v, want %v", ok, testCase.wantOK)
			}
			if ok && scope.key() != testCase.wantKey {
				t.Fatalf("scope = %q, want %q", scope.key(), testCase.wantKey)
			}
		})
	}
}

// 事件通道断开后，索引快照不能再被信任：全部 scope 清空，但连接代际保持不变。
func TestInvalidateSessionIndexesAfterEventGap(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	service := &service{projection: projection}
	ctx := context.Background()
	role := roleScope("role-1")
	group := groupScope("group-1")

	for _, scope := range []sessionScope{role, group} {
		if _, err := projection.ensureSessionIndex(ctx, scope); err != nil {
			t.Fatalf("ensureSessionIndex(%s) error = %v", scope.key(), err)
		}
	}
	epoch := projection.model.sessions.epochValue()
	dataRevision := projection.model.dataRevision()

	service.invalidateSessionIndexesAfterEventGap()

	for _, scope := range []sessionScope{role, group} {
		if projection.model.sessions.peek(scope) != nil {
			t.Fatalf("事件通道中断后 %s 的索引快照必须失效", scope.key())
		}
	}
	if projection.model.sessions.epochValue() != epoch {
		t.Fatal("事件通道中断不得推进 epoch：连接身份没有换代")
	}
	if projection.model.dataRevision() == dataRevision {
		t.Fatal("索引快照失效后必须推进数据版本")
	}
}

// 会话写入必须让索引缓存失效：断线恢复后的版本核对只能看到新 summary。
func TestSessionChangeInvalidatesSessionIndex(t *testing.T) {
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
	if got := box.log.count(http.MethodGet, "/api/roles/role-1/sessions"); got != 1 {
		t.Fatalf("会话索引应只读取一次，实际 %d", got)
	}

	event := sessionChangeEvent{
		TargetKind: sessionChangeTargetMessage,
		Location:   sessionChangeLocation{Kind: sessionLocationRole, RoleID: "role-1", SessionID: "chat-1"},
		ChangeType: sessionChangeMessageEdited,
		Version:    2,
		OccurredAt: time.Now().UTC(),
	}
	service.noteSessionChangeForSessionIndex(event)
	if projection.model.sessions.peek(scope) != nil {
		t.Fatal("会话变更后索引快照必须失效")
	}

	if _, err := projection.ensureSessionIndex(ctx, scope); err != nil {
		t.Fatalf("ensureSessionIndex() after invalidate error = %v", err)
	}
	if got := box.log.count(http.MethodGet, "/api/roles/role-1/sessions"); got != 2 {
		t.Fatalf("失效后应重新读取业务端，实际读取次数 %d", got)
	}
}
