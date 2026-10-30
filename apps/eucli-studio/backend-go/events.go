package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// 事件桥重连退避（design-5 第九节第 7 条）：1.5s 固定节奏改指数退避。
const (
	eventBridgeInitialBackoff = 500 * time.Millisecond
	eventBridgeMaxBackoff     = 30 * time.Second
)

type eventHub struct {
	mu      sync.Mutex
	clients map[*directConnection]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{clients: map[*directConnection]struct{}{}}
}

func (h *eventHub) add(conn *directConnection) {
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()
}

func (h *eventHub) remove(conn *directConnection) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
}

// broadcastRaw 是事件帧的唯一出口：帧在 hub 侧只编码一次，
// 每个连接拿到的都是同一份已编码字节；入队后由各连接自己的 writer 发出。
func (h *eventHub) broadcastRaw(name string, payload json.RawMessage) {
	frame := encodeEventFrame(name, payload)
	terminal := eventPayloadIsTerminal(payload)
	h.mu.Lock()
	clients := make([]*directConnection, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.Unlock()
	for _, client := range clients {
		client.enqueueEvent(frame, terminal)
	}
}

// eventPayloadIsTerminal 只扫描顶层的 type 字段，不重建整个载荷：
// 事件载荷可能很大（消息快照），终态判定必须保持「扫到 type 就停」。
func eventPayloadIsTerminal(payload json.RawMessage) bool {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return false
	}
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return false
		}
		key, ok := keyToken.(string)
		if !ok {
			return false
		}
		if key == "type" {
			var kind string
			if err := decoder.Decode(&kind); err != nil {
				return false
			}
			return isTerminalRunEventType(kind)
		}
		// 跳过该键的值（可能是一整棵子树，Decode 一次消费完）。
		var skipped json.RawMessage
		if err := decoder.Decode(&skipped); err != nil {
			return false
		}
	}
	return false
}

func isTerminalRunEventType(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "run_completed", "run_failed", "run_cancelled", "run_canceled":
		return true
	default:
		return false
	}
}

type eventBridge struct {
	service *service
	hub     *eventHub
}

func newEventBridge(service *service, hub *eventHub) *eventBridge {
	return &eventBridge{service: service, hub: hub}
}

func (b *eventBridge) run(ctx context.Context) {
	backoff := eventBridgeInitialBackoff
	for {
		state := b.service.connectionSnapshot()
		if state == nil || !state.BusinessAvailable {
			select {
			case <-ctx.Done():
				return
			case <-b.service.connectionChanged:
				backoff = eventBridgeInitialBackoff
				continue
			}
		}
		connectionCtx, cancel := context.WithCancel(ctx)
		done := make(chan error, 1)
		go func() { done <- b.connectOnce(connectionCtx) }()
		select {
		case <-ctx.Done():
			cancel()
			<-done
			return
		case <-b.service.connectionChanged:
			cancel()
			<-done
			backoff = eventBridgeInitialBackoff
			continue
		case err := <-done:
			cancel()
			if err != nil && ctx.Err() == nil {
				log.Printf("event bridge: %v", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-b.service.connectionChanged:
			backoff = eventBridgeInitialBackoff
			continue
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > eventBridgeMaxBackoff {
			backoff = eventBridgeMaxBackoff
		}
	}
}

func (b *eventBridge) connectOnce(ctx context.Context) error {
	connection, err := b.service.currentBoxConnection()
	if err != nil {
		return err
	}
	target, err := url.Parse(strings.TrimRight(connection.BaseURL, "/") + "/ws/events")
	if err != nil {
		return err
	}
	if target.Scheme == "http" {
		target.Scheme = "ws"
	} else if target.Scheme == "https" {
		target.Scheme = "wss"
	}
	header := http.Header{}
	if connection.Credential != "" {
		header.Set("Authorization", "Bearer "+connection.Credential)
	}
	b.service.release.applyHeaders(header)
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, target.String(), header)
	if err != nil {
		return err
	}
	defer conn.Close()
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		// 事件帧只做字节透传：不 decode、不 encode，
		// 每个连接拿到的是同一份已编码载荷。
		if !json.Valid(payload) {
			continue
		}
		b.hub.broadcastRaw(directEventEucliBoxRun, payload)
	}
}
