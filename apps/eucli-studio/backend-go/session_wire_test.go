package main

import (
	"encoding/json"
	"testing"
)

// 这三条不变量属于 wire 契约本身，必须由测试锁死：
//   1. 会话正文原样透传（不重建对象图）
//   2. profile 是枚举，非法值快速失败
//   3. 窗口参数有明确区间，越界不静默回落

func TestSessionWireProfileIsClosedEnum(t *testing.T) {
	for _, input := range []string{"", "view", "edit", "full"} {
		if _, err := sessionWireProfile(input); err != nil {
			t.Fatalf("sessionWireProfile(%q) error = %v", input, err)
		}
	}
	// 空值归一为 view：UI 渲染的默认形状。
	if got, _ := sessionWireProfile(""); got != sessionProfileView {
		t.Fatalf("空 profile = %q, want %q", got, sessionProfileView)
	}
	for _, input := range []string{"summary", "VIEW", "debug", "raw"} {
		if _, err := sessionWireProfile(input); err == nil {
			t.Fatalf("sessionWireProfile(%q) 必须失败", input)
		}
	}
}

func TestSessionWindowParamsDefaultsAndClamps(t *testing.T) {
	params, err := normalizeSessionWindowParams(sessionWindowParams{Profile: sessionProfileView})
	if err != nil {
		t.Fatalf("normalizeSessionWindowParams() error = %v", err)
	}
	if params.Limit != sessionWindowDefaultLimit {
		t.Fatalf("limit = %d, want %d", params.Limit, sessionWindowDefaultLimit)
	}
	if params.MaxBytes != sessionWindowDefaultMaxBytes {
		t.Fatalf("maxBytes = %d, want %d", params.MaxBytes, sessionWindowDefaultMaxBytes)
	}

	// 超上限收敛到上限，不失败：这是「安全上限」而不是「非法输入」。
	params, err = normalizeSessionWindowParams(sessionWindowParams{Limit: 99999})
	if err != nil {
		t.Fatalf("normalizeSessionWindowParams() error = %v", err)
	}
	if params.Limit != sessionWindowMaxLimit {
		t.Fatalf("limit = %d, want %d", params.Limit, sessionWindowMaxLimit)
	}

	// maxBytes 越界是非法输入：静默改成默认值会让调用方以为自己的预算生效了。
	for _, value := range []int{1, sessionWindowMinMaxBytes - 1, sessionWindowMaxMaxBytes + 1} {
		if _, err := normalizeSessionWindowParams(sessionWindowParams{MaxBytes: value}); err == nil {
			t.Fatalf("maxBytes=%d 必须失败", value)
		}
	}
}

func TestSessionWindowParamsCarryAnchors(t *testing.T) {
	params, err := normalizeSessionWindowParams(sessionWindowParams{
		Head:     " m9 ",
		Before:   "m9",
		Cursor:   "opaque",
		Limit:    24,
		MaxBytes: 524288,
		Profile:  sessionProfileView,
	})
	if err != nil {
		t.Fatalf("normalizeSessionWindowParams() error = %v", err)
	}
	query := params.query()
	if query["head"] != "m9" || query["before"] != "m9" || query["cursor"] != "opaque" {
		t.Fatalf("query = %#v", query)
	}
	if query["limit"] != "24" || query["maxBytes"] != "524288" || query["profile"] != "view" {
		t.Fatalf("query = %#v", query)
	}
}

func TestSessionRoutePathUsesScopeKind(t *testing.T) {
	path, err := sessionRoutePath(roleScope("role-1"), "chat-1")
	if err != nil {
		t.Fatalf("sessionRoutePath() error = %v", err)
	}
	if path != "/api/roles/role-1/sessions/chat-1" {
		t.Fatalf("path = %q", path)
	}

	path, err = sessionRoutePath(groupScope("group-1"), "chat-1")
	if err != nil {
		t.Fatalf("sessionRoutePath() error = %v", err)
	}
	if path != "/api/groups/group-1/sessions/chat-1" {
		t.Fatalf("path = %q", path)
	}

	if _, err := sessionRoutePath(sessionScope{}, "chat-1"); err == nil {
		t.Fatal("非法 scope 必须失败")
	}
	if _, err := sessionRoutePath(roleScope("role-1"), "  "); err == nil {
		t.Fatal("空 chatId 必须失败")
	}
}

// TestRawResultFrameIsByteIdentical 钉住「一次 WriteMessage、零二次编码」：
// 帧里的 result 必须与业务端字节逐字节一致（含键序）。
func TestRawResultFrameIsByteIdentical(t *testing.T) {
	payload := json.RawMessage(`{"z":1,"a":[3,2,1],"nested":{"k":"v"}}`)
	server, client := newWebSocketPair(t)
	defer server.Close()
	defer client.Close()

	conn := newDirectConnection(server)
	go func() { _ = conn.writeResultRaw("req-1", payload) }()

	_, frame, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	expected := `{"id":"req-1","type":"response","ok":true,"result":` + string(payload) + `}`
	if string(frame) != expected {
		t.Fatalf("frame = %s\nwant  = %s", frame, expected)
	}
}

// TestRawEventFrameIsByteIdentical 钉住事件帧的字节透传。
func TestRawEventFrameIsByteIdentical(t *testing.T) {
	payload := json.RawMessage(`{"z":1,"a":2}`)
	server, client := newWebSocketPair(t)
	defer server.Close()
	defer client.Close()

	conn := newDirectConnection(server)
	go func() { _ = conn.writeFrame(encodeEventFrame("eucliBox.run.event", payload)) }()

	_, frame, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	expected := `{"type":"event","name":"eucliBox.run.event","payload":` + string(payload) + `}`
	if string(frame) != expected {
		t.Fatalf("frame = %s\nwant  = %s", frame, expected)
	}
}
