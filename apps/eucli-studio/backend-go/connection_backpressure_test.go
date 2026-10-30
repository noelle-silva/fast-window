package main

import (
	"encoding/json"
	"testing"
	"time"
)

// 响应帧与事件帧的分策略（design-5 决策 3）：
//   响应：满则关连接（丢了就悬挂）
//   事件：满则丢弃最旧的非终态（终态永不丢）

func TestEnqueueResponseClosesConnectionWhenFull(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer client.Close()

	conn := newDirectConnection(server)
	defer conn.close()

	// 把响应队列灌满（writer 尚未启动，因此不会被消费）。
	for i := 0; i < responseQueueCapacity; i++ {
		conn.responses <- []byte(`{"id":"x","type":"response","ok":true}`)
	}

	err := conn.enqueueResponse([]byte(`{"id":"y","type":"response","ok":true}`))
	if err == nil {
		t.Fatal("队列满时必须返回错误")
	}
	if err != errResponseQueueFull {
		t.Fatalf("error = %v, want %v", err, errResponseQueueFull)
	}

	// 满队列意味着客户端已读不动：连接必须被关闭。
	select {
	case <-conn.done:
	case <-time.After(time.Second):
		t.Fatal("响应队列满时必须关闭连接")
	}
}

func TestEnqueueEventNeverClosesConnection(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer client.Close()

	conn := newDirectConnection(server)
	defer conn.close()

	// 事件帧超限只丢弃，不关连接。
	for i := 0; i < eventQueueMaxItems+10; i++ {
		conn.enqueueEvent(encodeEventFrame("eucliBox.run.event", json.RawMessage(`{"type":"assistant_message_delta"}`)), false)
	}
	select {
	case <-conn.done:
		t.Fatal("事件背压不允许关闭连接")
	default:
	}
}

func TestConnectionWriterDeliversQueuedEvent(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer client.Close()

	conn := newDirectConnection(server)
	defer conn.close()

	payload := json.RawMessage(`{"runId":"run-1","type":"run_started"}`)
	conn.enqueueEvent(encodeEventFrame(directEventEucliBoxRun, payload), false)

	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, frame, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	expected := `{"type":"event","name":"eucliBox.run.event","payload":` + string(payload) + `}`
	if string(frame) != expected {
		t.Fatalf("frame = %s\nwant  = %s", frame, expected)
	}
}

func TestConnectionWriterPrefersResponsesOverEvents(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer client.Close()

	conn := newDirectConnection(server)
	defer conn.close()

	// 响应先入队、事件后入队：writer 必须在事件之前先发出响应。
	if err := conn.enqueueResponse(encodeResultFrame("req-1", json.RawMessage(`{}`))); err != nil {
		t.Fatalf("enqueueResponse error = %v", err)
	}
	conn.enqueueEvent(encodeEventFrame(directEventEucliBoxRun, json.RawMessage(`{"type":"assistant_message_delta"}`)), false)

	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, first, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage() error = %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(first, &frame); err != nil {
		t.Fatalf("decode frame error = %v", err)
	}
	if frame["type"] != "response" || frame["id"] != "req-1" {
		t.Fatalf("响应必须优先于事件：%#v", frame)
	}
}

func TestConnectionCloseCancelsInFlightRequests(t *testing.T) {
	server, client := newWebSocketPair(t)
	defer client.Close()

	conn := newDirectConnection(server)
	cancelled := make(chan struct{}, 1)
	conn.registerCancel("req-1", func() {
		select {
		case cancelled <- struct{}{}:
		default:
		}
	})

	_ = conn.close()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("关闭连接必须取消所有在途请求的等待")
	}
}
