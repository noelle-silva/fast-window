package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const cancelRequestMethod = "aiChat.cancelRequest"

type directServer struct {
	token   string
	service *service
	hub     *eventHub
	// laneBudget 是每条道「名额已满时最多等多久」的上界。
	// 它属于服务端配置，构造时注入（测试可传更短值），不是包级可变状态。
	laneBudget time.Duration
}

func newDirectServer(token string, service *service, hub *eventHub) *directServer {
	return newDirectServerWithLaneBudget(token, service, hub, laneAcquireBudgetDefault)
}

func newDirectServerWithLaneBudget(token string, service *service, hub *eventHub, laneBudget time.Duration) *directServer {
	if laneBudget <= 0 {
		laneBudget = laneAcquireBudgetDefault
	}
	return &directServer{token: token, service: service, hub: hub, laneBudget: laneBudget}
}

func (s *directServer) listenAndServe(ctx context.Context) error {
	serverContext, cancel := context.WithCancel(ctx)
	defer cancel()
	s.service.setShutdown(cancel)
	defer s.service.setShutdown(nil)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	server := &http.Server{Handler: s}
	go func() {
		<-serverContext.Done()
		_ = server.Close()
	}()
	addr := listener.Addr().(*net.TCPAddr)
	writeReady(addr.Port)
	return server.Serve(listener)
}

func (s *directServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(r.URL.Query().Get("token")) != s.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	rawConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn := newDirectConnection(rawConn)
	go s.handleConnection(conn)
}

// connectionDispatcher 持有一个连接的并发闸门。
//
// 结构：reader（唯一读循环，只做校验 + 门禁 + 入道）+ 每请求 goroutine。
// reader 永不阻塞在业务上，因此 cancel 帧与 healthCheck 永远读得到。
type connectionDispatcher struct {
	server *directServer
	conn   *directConnection

	local  *laneGate
	remote *laneGate
	keys   *keyGate

	// healthChecked 只在 healthCheck 成功后置位（worker 写、reader 读）：
	// 这是两个 goroutine 之间唯一共享的布尔，必须用原子量。
	healthChecked atomic.Bool
}

func (s *directServer) handleConnection(conn *directConnection) {
	defer conn.close()
	s.hub.add(conn)
	defer s.hub.remove(conn)
	conn.startWriter()

	dispatcher := &connectionDispatcher{
		server: s,
		conn:   conn,
		local:  newLaneGate(localLaneConcurrency, s.laneBudget),
		remote: newLaneGate(remoteLaneConcurrency, s.laneBudget),
		keys:   newKeyGate(),
	}

	// reader 只做三件事：校验、门禁、入道。任何耗时动作都在 worker goroutine。
	for {
		var frame requestFrame
		if err := conn.readJSON(&frame); err != nil {
			return
		}
		if frame.ID == "" || frame.Type != "request" || frame.Method == "" {
			continue
		}
		dispatcher.handle(frame)
	}
}

func (d *connectionDispatcher) handle(frame requestFrame) {
	// 取消帧在 reader 里直接处理：它是「停止等待」，绝不能排在业务队列后面。
	if frame.Method == cancelRequestMethod {
		d.handleCancel(frame)
		return
	}
	if !d.healthChecked.Load() && frame.Method != "aiChat.healthCheck" {
		_ = d.conn.enqueueResponse(marshalResponse(errorResponseFor(frame.ID, newError("HEALTH_CHECK_REQUIRED", "请先完成 healthCheck"))))
		return
	}

	peek := peekRequestParams(frame.Method, frame.Params)
	intent := classifyRequest(frame.Method, peek)
	gate := d.gateFor(intent.lane)

	// 一次解析：分道 / 超时 / 观测共用同一份预览，dispatch 从 context 复用。
	timeout := studioTimeoutForClass(methodTimeoutClass(frame.Method, peek.Envelope))
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	ctx = withRequestPeek(ctx, peek)
	d.conn.registerCancel(frame.ID, cancel)

	go d.run(ctx, cancel, gate, intent, frame)
}

func (d *connectionDispatcher) handleCancel(frame requestFrame) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	_ = json.Unmarshal(paramsOrEmpty(frame.Params), &req)
	target := strings.TrimSpace(req.RequestID)
	if target != "" {
		// 平面 A：停止等待。平面 B（真正停止 box 里的工作）必须由显式业务命令触发。
		d.conn.cancelRequest(target)
	}
	_ = d.conn.enqueueResponse(marshalResponse(okResponse(frame.ID, map[string]any{"cancelled": target != ""})))
}

func (d *connectionDispatcher) gateFor(lane requestLane) *laneGate {
	switch lane {
	case laneLocal:
		return d.local
	case laneRemote:
		return d.remote
	default:
		return nil
	}
}

func (d *connectionDispatcher) run(ctx context.Context, cancel context.CancelFunc, gate *laneGate, intent dispatchIntent, frame requestFrame) {
	defer cancel()
	defer d.conn.unregisterCancel(frame.ID)
	// 名额在有界等待之后才判定：启动洪峰只是瞬时超额，退避即可排空，
	// 不该让首屏关键请求被一次拒绝就永久失败。等待发生在 worker 里，reader 不受影响。
	if gate != nil {
		if !gate.acquire(ctx) {
			if ctx.Err() != nil {
				_ = d.conn.enqueueResponse(marshalResponse(errorResponseFor(frame.ID, newError("REQUEST_CANCELLED", "请求已取消"))))
				return
			}
			// 上界耗尽才拒绝该帧，且不中断连接。
			// 这一帧在入道前就被拒、从未进入 service.dispatch，因此可以安全重试：
			// 用协议级 retryable 声明表达，而不是让前端去认 SERVER_BUSY 这个业务码。
			_ = d.conn.enqueueResponse(marshalResponse(errorResponseFor(frame.ID, newRetryableError(
				"SERVER_BUSY",
				"服务端繁忙，请稍后重试",
				int(laneBusyRetryAfter/time.Millisecond),
			))))
			return
		}
		defer gate.release()
	}
	if intent.sequenceKey != "" {
		if err := d.keys.acquire(ctx, intent.sequenceKey); err != nil {
			_ = d.conn.enqueueResponse(marshalResponse(errorResponseFor(frame.ID, newError("REQUEST_CANCELLED", "请求已取消"))))
			return
		}
		defer d.keys.release(intent.sequenceKey)
	}

	result, err := d.server.service.dispatch(ctx, frame.Method, frame.Params)
	if err != nil {
		_ = d.conn.enqueueResponse(marshalResponse(errorResponseFor(frame.ID, err)))
		return
	}
	// 门禁在 healthCheck 真正成功之后才放行后续请求。
	if frame.Method == "aiChat.healthCheck" {
		d.healthChecked.Store(true)
	}
	// 字节中继：结果已经是业务端原始字节时直接拼帧，绝不二次编码。
	if raw, ok := result.(rawResult); ok {
		_ = d.conn.enqueueResponse(encodeResultFrame(frame.ID, raw.payload))
		return
	}
	payload, marshalErr := json.Marshal(okResponse(frame.ID, result))
	if marshalErr != nil {
		_ = d.conn.enqueueResponse(marshalResponse(errorResponseFor(frame.ID, marshalErr)))
		return
	}
	_ = d.conn.enqueueResponse(payload)
}

func marshalResponse(frame responseFrame) []byte {
	payload, err := json.Marshal(frame)
	if err != nil {
		log.Printf("response marshal failed: %v", err)
		return []byte(`{"id":"","type":"response","ok":false,"error":{"code":"BACKEND_ERROR","message":"响应编码失败"}}`)
	}
	return payload
}

func writeReady(port int) {
	line, err := json.Marshal(readyFrame{Type: "ready", IPC: readyIPC{Mode: "direct", Transport: "local-websocket", URL: fmt.Sprintf("ws://127.0.0.1:%d", port), ProtocolVersion: directProtocolVersion}})
	if err != nil {
		log.Printf("ready frame marshal failed: %v", err)
		return
	}
	fmt.Println(string(line))
}
