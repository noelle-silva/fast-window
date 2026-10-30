package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// 字节中继的验收面：studio 只解信封，会话载荷一次都不进入对象图。

func TestExtractEnvelopeDataKeepsRawBytes(t *testing.T) {
	payload := []byte(`{"data":{"id":"session-1","messages":[{"id":"m1"}]},"meta":{"ignored":true}}`)
	raw, err := extractEnvelopeData(payload)
	if err != nil {
		t.Fatalf("extractEnvelopeData() error = %v", err)
	}
	if string(raw) != `{"id":"session-1","messages":[{"id":"m1"}]}` {
		t.Fatalf("raw = %s", raw)
	}

	// 无 data 字段：整份响应就是载荷（与旧语义一致）。
	raw, err = extractEnvelopeData([]byte(`{"ok":true}`))
	if err != nil {
		t.Fatalf("extractEnvelopeData() error = %v", err)
	}
	if string(raw) != `{"ok":true}` {
		t.Fatalf("raw = %s", raw)
	}

	// 非对象载荷原样透传。
	raw, err = extractEnvelopeData([]byte(`[1,2,3]`))
	if err != nil {
		t.Fatalf("extractEnvelopeData() error = %v", err)
	}
	if string(raw) != `[1,2,3]` {
		t.Fatalf("raw = %s", raw)
	}

	// 空载荷归一为空对象。
	raw, err = extractEnvelopeData([]byte("   "))
	if err != nil {
		t.Fatalf("extractEnvelopeData() error = %v", err)
	}
	if string(raw) != "{}" {
		t.Fatalf("raw = %s", raw)
	}
}

func TestTruncateTextRespectsRuneBoundary(t *testing.T) {
	payload := strings.Repeat("错", 64)
	got := truncateText([]byte(payload), 10)
	if !strings.HasPrefix(got, "错") {
		t.Fatalf("truncateText() = %q", got)
	}
	if !strings.HasSuffix(got, "…（已截断）") {
		t.Fatalf("truncateText() = %q", got)
	}
	if strings.Contains(got, "\ufffd") {
		t.Fatalf("truncateText() 产生了非法 UTF-8：%q", got)
	}

	// 上限内不截断。
	if got := truncateText([]byte("short"), 64); got != "short" {
		t.Fatalf("truncateText(short) = %q", got)
	}
}

func TestEBResponseErrorCarriesOnlyOneBodyForm(t *testing.T) {
	resp := &http.Response{StatusCode: 500, Status: "500 Internal Server Error", Header: http.Header{}}

	// JSON 错误：只带 json，不再重复带 body。
	err := ebResponseError(resp, []byte(`{"error":{"message":"box 崩了"}}`))
	detailed, ok := err.(detailedError)
	if !ok {
		t.Fatalf("error = %T", err)
	}
	details := objectMap(detailed.Details())
	if _, exists := details["body"]; exists {
		t.Fatalf("JSON 错误不应再带 body：%#v", details)
	}
	if details["json"] == nil {
		t.Fatalf("JSON 错误必须带 json：%#v", details)
	}
	if err.Error() != "box 崩了" {
		t.Fatalf("message = %q", err.Error())
	}

	// 非 JSON 错误：只带截断后的 body。
	err = ebResponseError(resp, []byte(strings.Repeat("x", ebErrorBodyLimit*2)))
	details = objectMap(err.(detailedError).Details())
	if _, exists := details["json"]; exists {
		t.Fatalf("非 JSON 错误不应带 json：%#v", details)
	}
	body, _ := details["body"].(string)
	if len(body) > ebErrorBodyLimit+len("…（已截断）") {
		t.Fatalf("错误体未被截断：%d 字节", len(body))
	}
}

// TestEBClientRequestRawIsByteIdentical 钉住「studio 侧对载荷遍历次数 = 0」：
// 返回的字节必须与业务端 data 字段逐字节一致。
func TestEBClientRequestRawIsByteIdentical(t *testing.T) {
	body := `{"id":"session-1","schemaVersion":1,"messages":[{"id":"m1","branchId":"main","parentMessageId":"","createdAt":1}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"data":`+body+`}`)
	}))
	defer server.Close()

	store := configuredTestStore(t, server.URL)
	client := newEBClient(store, testClientRelease())
	raw, err := client.requestRaw(context.Background(), ebRequest{Method: http.MethodGet, Path: "/api/roles/r/sessions/s"})
	if err != nil {
		t.Fatalf("requestRaw() error = %v", err)
	}
	if string(raw) != body {
		t.Fatalf("raw 与业务端 data 不一致：\n%s\n%s", raw, body)
	}
}

func TestDirectConnectionWritesRawResultFrame(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer server.Close()
	defer client.Close()

	conn := newDirectConnection(server)
	go func() {
		_ = conn.writeResultRaw("req-1", json.RawMessage(`{"id":"session-1","messages":[]}`))
	}()

	_, payload, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(payload, &frame); err != nil {
		t.Fatalf("decode frame error = %v", err)
	}
	if frame["id"] != "req-1" || frame["type"] != "response" || frame["ok"] != true {
		t.Fatalf("frame = %#v", frame)
	}
	result, _ := frame["result"].(map[string]any)
	if stringField(result, "id") != "session-1" {
		t.Fatalf("result = %#v", frame["result"])
	}
}

func TestDirectConnectionWritesRawEventFrame(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer server.Close()
	defer client.Close()

	conn := newDirectConnection(server)
	go func() {
		_ = conn.writeFrame(encodeEventFrame("eucliBox.run.event", json.RawMessage(`{"runId":"run-1","type":"run_started"}`)))
	}()

	_, payload, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(payload, &frame); err != nil {
		t.Fatalf("decode frame error = %v", err)
	}
	if frame["type"] != "event" || frame["name"] != "eucliBox.run.event" {
		t.Fatalf("frame = %#v", frame)
	}
	event, _ := frame["payload"].(map[string]any)
	if stringField(event, "runId") != "run-1" {
		t.Fatalf("payload = %#v", frame["payload"])
	}
}

func TestDirectConnectionEscapesRawResultID(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer server.Close()
	defer client.Close()

	conn := newDirectConnection(server)
	go func() {
		_ = conn.writeResultRaw(`req-"quoted"\id`, json.RawMessage(`{}`))
	}()

	_, payload, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(payload, &frame); err != nil {
		t.Fatalf("decode frame error = %v", err)
	}
	if frame["id"] != `req-"quoted"\id` {
		t.Fatalf("id = %#v", frame["id"])
	}
}

func newWebSocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	var serverConn *websocket.Conn
	ready := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade error = %v", err)
			close(ready)
			return
		}
		serverConn = conn
		close(ready)
	}))
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		server.Close()
		t.Fatalf("dial error = %v", err)
	}
	<-ready
	if serverConn == nil {
		server.Close()
		client.Close()
		t.Fatal("server connection not established")
	}
	return serverConn, client
}
