package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestDirectServerRequiresTokenAndHelloBeforeRequests(t *testing.T) {
	server, err := newDirectServer("token", t.TempDir())
	if err != nil {
		t.Fatalf("newDirectServer failed: %v", err)
	}
	defer server.dispose()
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	if conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil {
		_ = conn.Close()
		t.Fatalf("expected missing token dial to fail")
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL+"?token=token", nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(requestFrame{ID: "1", Type: "request", Method: "settings.read"}); err != nil {
		t.Fatalf("write settings before hello failed: %v", err)
	}
	var response responseFrame
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("read response failed: %v", err)
	}
	if response.OK || response.Error["code"] != errorBadRequest {
		t.Fatalf("expected BAD_REQUEST before hello, got %+v", response)
	}

	if err := conn.WriteJSON(requestFrame{ID: "2", Type: "request", Method: methodProtocolHello, Params: mustJSON(t, map[string]any{"clientProtocolVersion": protocolVersion})}); err != nil {
		t.Fatalf("write hello failed: %v", err)
	}
	if err := conn.ReadJSON(&response); err != nil {
		t.Fatalf("read hello response failed: %v", err)
	}
	if !response.OK {
		t.Fatalf("expected hello ok, got %+v", response)
	}
}

func TestDirectServerBroadcastOnlyAfterHello(t *testing.T) {
	server, err := newDirectServer("token", t.TempDir())
	if err != nil {
		t.Fatalf("newDirectServer failed: %v", err)
	}
	defer server.dispose()
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "?token=token"

	helloConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial hello conn failed: %v", err)
	}
	defer helloConn.Close()
	plainConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial plain conn failed: %v", err)
	}
	defer plainConn.Close()

	if err := helloConn.WriteJSON(requestFrame{ID: "hello", Type: "request", Method: methodProtocolHello, Params: mustJSON(t, map[string]any{"clientProtocolVersion": protocolVersion})}); err != nil {
		t.Fatalf("write hello failed: %v", err)
	}
	var response responseFrame
	if err := helloConn.ReadJSON(&response); err != nil || !response.OK {
		t.Fatalf("hello response failed: %+v err=%v", response, err)
	}

	server.Broadcast(newEvent(eventGenerationProgress, map[string]any{"task": generationTask{ID: "task-1"}}))
	var event eventFrame
	if err := helloConn.ReadJSON(&event); err != nil {
		t.Fatalf("expected broadcast event: %v", err)
	}
	if event.Name != eventGenerationProgress {
		t.Fatalf("unexpected event %+v", event)
	}

	_ = plainConn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if err := plainConn.ReadJSON(&event); err == nil {
		t.Fatalf("plain conn should not receive event before hello")
	}
}
