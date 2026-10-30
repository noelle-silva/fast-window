package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// 事件帧策略（design-5 决策 3）：满时丢弃最旧的非终态事件，终态永不丢。

func TestEventQueueDropsOldestNonTerminal(t *testing.T) {
	queue := &eventQueue{}
	for i := 0; i < eventQueueMaxItems; i++ {
		queue.push([]byte(`{"type":"assistant_message_delta"}`), false)
	}
	// 再压一条：队列已满，必须丢掉最旧的一条而不是拒绝新的。
	queue.push([]byte(`{"type":"run_started"}`), false)
	if len(queue.items) != eventQueueMaxItems {
		t.Fatalf("queue size = %d, want %d", len(queue.items), eventQueueMaxItems)
	}
	if string(queue.items[len(queue.items)-1].frame) != `{"type":"run_started"}` {
		t.Fatal("最新的非终态事件必须入队")
	}
}

func TestEventQueueNeverDropsTerminalUnderPressure(t *testing.T) {
	queue := &eventQueue{}
	for i := 0; i < eventQueueMaxItems; i++ {
		queue.push([]byte(`{"type":"run_completed"}`), true)
	}
	// 队列全是终态：新的非终态事件被丢弃，终态一条不少。
	queue.push([]byte(`{"type":"assistant_message_delta"}`), false)
	if len(queue.items) != eventQueueMaxItems {
		t.Fatalf("终态不应被非终态挤掉：size = %d", len(queue.items))
	}
	for _, item := range queue.items {
		if !item.terminal {
			t.Fatal("满队列下不允许用非终态替换终态")
		}
	}
}

// TestEventQueueStaysBoundedWhenAllTerminal 钉住 8MB 上限是硬约束：
// 即使队列里全是终态事件，也不能无界增长（丢最旧终态，前端可用 RunProbe 补）。
func TestEventQueueStaysBoundedWhenAllTerminal(t *testing.T) {
	queue := &eventQueue{}
	big := make([]byte, eventQueueMaxBytes/2+1)
	for i := 0; i < 8; i++ {
		queue.push(big, true)
	}
	if queue.bytes > eventQueueMaxBytes {
		t.Fatalf("全终态队列也必须遵守字节上限：bytes = %d > %d", queue.bytes, eventQueueMaxBytes)
	}
	if len(queue.items) > eventQueueMaxItems {
		t.Fatalf("全终态队列也必须遵守条数上限：size = %d", len(queue.items))
	}
}

// TestEventQueueDropsOldestTerminalOnlyAtLimit 钉住「只在超限时才丢终态」：
// 未超限时终态必须完整保留（终态是 run 收尾的唯一信号）。
func TestEventQueueDropsOldestTerminalOnlyAtLimit(t *testing.T) {
	queue := &eventQueue{}
	queue.push([]byte(`{"type":"run_completed","id":"run-1"}`), true)
	queue.push([]byte(`{"type":"run_failed","id":"run-2"}`), true)
	if len(queue.items) != 2 {
		t.Fatalf("未超限时终态必须保留：size = %d", len(queue.items))
	}
}

func TestEventQueueRespectsByteBudget(t *testing.T) {
	queue := &eventQueue{}
	big := make([]byte, eventQueueMaxBytes/2+1)
	queue.push(big, false)
	queue.push(big, false)
	if queue.bytes > eventQueueMaxBytes {
		t.Fatalf("队列字节数 %d 超过预算 %d", queue.bytes, eventQueueMaxBytes)
	}
}

func TestEventPayloadIsTerminalScansOnlyTopLevelType(t *testing.T) {
	if !eventPayloadIsTerminal(json.RawMessage(`{"type":"run_completed","payload":{"type":"nested"}}`)) {
		t.Fatal("顶层 run_completed 必须判为终态")
	}
	if eventPayloadIsTerminal(json.RawMessage(`{"type":"assistant_message_delta","payload":{"type":"run_completed"}}`)) {
		t.Fatal("嵌套的 type 不参与终态判定")
	}
	if eventPayloadIsTerminal(json.RawMessage(`{"payload":{"type":"run_completed"}}`)) {
		t.Fatal("缺少顶层 type 时不判终态")
	}
	if !eventPayloadIsTerminal(json.RawMessage(`{"runId":"r1","type":"run_failed"}`)) {
		t.Fatal("字段顺序不影响判定")
	}
}

// keyGate：同一 key 严格 FIFO，不同 key 完全并行。

func TestKeyGateSerializesSameKey(t *testing.T) {
	gate := newKeyGate()
	ctx := context.Background()
	if err := gate.acquire(ctx, "storage:meta/index"); err != nil {
		t.Fatalf("first acquire error = %v", err)
	}

	order := make([]int, 0, 2)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		index := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := gate.acquire(ctx, "storage:meta/index"); err != nil {
				return
			}
			mu.Lock()
			order = append(order, index)
			mu.Unlock()
			time.Sleep(5 * time.Millisecond)
			gate.release("storage:meta/index")
		}()
		time.Sleep(5 * time.Millisecond)
	}
	gate.release("storage:meta/index")
	wg.Wait()
	if len(order) != 2 || order[0] != 0 || order[1] != 1 {
		t.Fatalf("同 key 必须严格 FIFO：%v", order)
	}
}

func TestKeyGateAllowsDifferentKeysInParallel(t *testing.T) {
	gate := newKeyGate()
	ctx := context.Background()
	if err := gate.acquire(ctx, "storage:a"); err != nil {
		t.Fatalf("acquire a error = %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- gate.acquire(ctx, "storage:b") }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("acquire b error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("不同 key 必须并行，不能互相阻塞")
	}
	gate.release("storage:a")
	gate.release("storage:b")
}

func TestKeyGateCancelHandsTokenToNextWaiter(t *testing.T) {
	gate := newKeyGate()
	if err := gate.acquire(context.Background(), "k"); err != nil {
		t.Fatalf("first acquire error = %v", err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancelledDone := make(chan error, 1)
	go func() { cancelledDone <- gate.acquire(cancelled, "k") }()
	time.Sleep(10 * time.Millisecond)

	nextDone := make(chan error, 1)
	go func() { nextDone <- gate.acquire(context.Background(), "k") }()
	time.Sleep(10 * time.Millisecond)

	cancel()
	if err := <-cancelledDone; err == nil {
		t.Fatal("取消的等待者必须返回错误")
	}
	gate.release("k")

	select {
	case err := <-nextDone:
		if err != nil {
			t.Fatalf("下一位必须拿到令牌：%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("取消者不能永久占住队列")
	}
	gate.release("k")
}

// 并发 dispatch 的端到端验收：长请求期间 runtime 读仍然可用。

func TestDispatcherServesRuntimeReadWhileRemoteLaneSaturated(t *testing.T) {
	box := newBlockingRunBox(t)
	svc := newBusinessReadyTestService(configuredTestStore(t, box.server.URL), newEventHub())
	server := newDirectServer("token", svc, newEventHub())

	client := dialTestServer(t, server)
	defer client.Close()
	writeRequest(t, client, "hc", "aiChat.healthCheck", map[string]any{})
	readResponse(t, client, "hc")

	// 用满 remote 道名额：每条都是「一直不返回」的长请求。
	for i := 0; i < remoteLaneConcurrency; i++ {
		writeRequest(t, client, "slow-"+string(rune('a'+i)), "aiChat.netRequest", map[string]any{
			"method": "GET",
			"path":   "/api/slow",
		})
	}
	// 等它们真正进入 handler。
	box.waitForSlowRequests(t, remoteLaneConcurrency)

	// 满载时：只拒绝该帧（SERVER_BUSY），不中断连接。
	writeRequest(t, client, "busy", "aiChat.netRequest", map[string]any{"method": "GET", "path": "/api/slow"})
	busy := readResponse(t, client, "busy")
	if busy.Error == nil || busy.Error.Code != "SERVER_BUSY" {
		t.Fatalf("满载必须返回 SERVER_BUSY：%#v", busy.Error)
	}

	// 关键：runtime 读走 local 道，必须仍然立刻返回。
	writeRequest(t, client, "rt", "aiChat.storageGet", map[string]any{"key": "runtime/lock.chat.role.r.c"})
	rt := readResponse(t, client, "rt")
	if !rt.OK {
		t.Fatalf("长请求期间 runtime 读必须成功：%#v", rt.Error)
	}

	// healthCheck 走 control 道：永不占名额，也必须仍然立刻返回。
	writeRequest(t, client, "hc2", "aiChat.healthCheck", map[string]any{})
	hc2 := readResponse(t, client, "hc2")
	if !hc2.OK {
		t.Fatalf("长请求期间 healthCheck 必须成功：%#v", hc2.Error)
	}

	box.releaseSlowRequests()
}

func TestDispatcherCancelFrameStopsWaitingWithoutClosingConnection(t *testing.T) {
	box := newBlockingRunBox(t)
	svc := newBusinessReadyTestService(configuredTestStore(t, box.server.URL), newEventHub())
	server := newDirectServer("token", svc, newEventHub())

	client := dialTestServer(t, server)
	defer client.Close()
	writeRequest(t, client, "hc", "aiChat.healthCheck", map[string]any{})
	readResponse(t, client, "hc")

	writeRequest(t, client, "slow", "aiChat.netRequest", map[string]any{"method": "GET", "path": "/api/slow"})
	box.waitForSlowRequests(t, 1)

	// cancel 帧在 reader 里直接处理：即使 remote 道全满也读得到。
	writeRequest(t, client, "cancel", cancelRequestMethod, map[string]any{"requestId": "slow"})
	cancelAck := readResponse(t, client, "cancel")
	if !cancelAck.OK {
		t.Fatalf("cancel 帧必须被处理：%#v", cancelAck.Error)
	}

	// 连接仍然可用：取消只停止等待，不关闭连接。
	writeRequest(t, client, "rt", "aiChat.storageGet", map[string]any{"key": "runtime/anything"})
	if resp := readResponse(t, client, "rt"); !resp.OK {
		t.Fatalf("cancel 之后连接必须仍然可用：%#v", resp.Error)
	}
	box.releaseSlowRequests()
}

func TestDispatcherRejectsRequestsBeforeHealthCheck(t *testing.T) {
	box := newBlockingRunBox(t)
	svc := newBusinessReadyTestService(configuredTestStore(t, box.server.URL), newEventHub())
	server := newDirectServer("token", svc, newEventHub())

	client := dialTestServer(t, server)
	defer client.Close()

	writeRequest(t, client, "x", "aiChat.storageGet", map[string]any{"key": "runtime/a"})
	resp := readResponse(t, client, "x")
	if resp.Error == nil || resp.Error.Code != "HEALTH_CHECK_REQUIRED" {
		t.Fatalf("未 healthCheck 必须先被拒：%#v", resp.Error)
	}
}

// blockingRunBox 是「慢请求会一直挂着」的业务端桩。
type blockingRunBox struct {
	server      *httptest.Server
	slowStarted chan struct{}
	release     chan struct{}
	mu          sync.Mutex
	slowCount   int
}

func newBlockingRunBox(t *testing.T) *blockingRunBox {
	t.Helper()
	box := &blockingRunBox{
		slowStarted: make(chan struct{}, 64),
		release:     make(chan struct{}),
	}
	box.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/slow" {
			box.mu.Lock()
			box.slowCount++
			box.mu.Unlock()
			box.slowStarted <- struct{}{}
			<-box.release
			_, _ = w.Write([]byte(`{"data":{"ok":true}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"ok":true}}`))
	}))
	t.Cleanup(box.server.Close)
	return box
}

func (b *blockingRunBox) waitForSlowRequests(t *testing.T, count int) {
	t.Helper()
	for i := 0; i < count; i++ {
		select {
		case <-b.slowStarted:
		case <-time.After(3 * time.Second):
			t.Fatalf("等待第 %d 个慢请求超时", i+1)
		}
	}
}

func (b *blockingRunBox) releaseSlowRequests() {
	close(b.release)
}

func dialTestServer(t *testing.T, server *directServer) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen error = %v", err)
	}
	httpServer := &http.Server{Handler: server}
	go func() { _ = httpServer.Serve(listener) }()
	t.Cleanup(func() { _ = httpServer.Close() })
	addr := listener.Addr().(*net.TCPAddr)
	url := fmt.Sprintf("ws://127.0.0.1:%d?token=token", addr.Port)
	client, _, err := websocket.DefaultDialer.DialContext(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial error = %v", err)
	}
	return client
}

func writeRequest(t *testing.T, client *websocket.Conn, id string, method string, params map[string]any) {
	t.Helper()
	frame := map[string]any{"id": id, "type": "request", "method": method, "params": params}
	if err := client.WriteJSON(frame); err != nil {
		t.Fatalf("write request error = %v", err)
	}
}

// readResponse 按 id 匹配响应：并发下响应可以乱序，协议本身按 id 关联。
func readResponse(t *testing.T, client *websocket.Conn, id string) responseFrame {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("等待响应 %s 超时", id)
		}
		_ = client.SetReadDeadline(deadline)
		_, payload, err := client.ReadMessage()
		if err != nil {
			t.Fatalf("read message error = %v", err)
		}
		var frame responseFrame
		if err := json.Unmarshal(payload, &frame); err != nil {
			continue
		}
		if frame.Type != "response" || frame.ID != id {
			continue
		}
		return frame
	}
}
