package main

import (
	"sync"

	"github.com/gorilla/websocket"
)

// eventFrame 是后端主动推送给前端的事件帧，与 request/response 帧共用同一条 WebSocket。
type eventFrame struct {
	Type  string `json:"type"` // 恒为 "event"
	Event any    `json:"event"`
}

// safeConn 包装 WebSocket，使响应写入与广播写入互不踩踏（gorilla 不允许并发写）。
type safeConn struct {
	mu  sync.Mutex
	conn *websocket.Conn
}

func (s *safeConn) writeJSON(value any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn.WriteJSON(value)
}

// eventBus 维护全部活跃连接并负责事件广播。
type eventBus struct {
	mu       sync.Mutex
	conns    map[*safeConn]bool
	observer func(map[string]any) // 测试观察钩子
}

func newEventBus() *eventBus {
	return &eventBus{conns: make(map[*safeConn]bool)}
}

func (bus *eventBus) register(conn *safeConn) {
	bus.mu.Lock()
	defer bus.mu.Unlock()
	bus.conns[conn] = true
}

func (bus *eventBus) unregister(conn *safeConn) {
	bus.mu.Lock()
	defer bus.mu.Unlock()
	delete(bus.conns, conn)
}

// broadcast 向全部活跃连接推送事件；推送失败的连接直接剔除。
func (bus *eventBus) broadcast(event map[string]any) {
	frame := eventFrame{Type: "event", Event: event}
	bus.mu.Lock()
	defer bus.mu.Unlock()
	if bus.observer != nil {
		bus.observer(event)
	}
	for conn := range bus.conns {
		if err := conn.writeJSON(frame); err != nil {
			delete(bus.conns, conn)
		}
	}
}

func (svc *service) emitEvent(event map[string]any) {
	svc.bus.broadcast(event)
}
