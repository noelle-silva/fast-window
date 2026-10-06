package main

import (
	"sync"

	"github.com/gorilla/websocket"
)

// changeClient 是前端常驻连线的一个连接：响应与推送经同一把锁串行写出，
// 满足 websocket 单写者约束，避免推送与响应并发写坏帧。
type changeClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *changeClient) writeJSON(value any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(value)
}

// changeHub 是外部改动通知中心：登记前端常驻连线，维护每仓库的变更修订号。
// 外部写入成功后把「变了」（带仓库与变更类别）顺着既有连线推给前端；
// 本地界面自己的写入不经过这里，因此不会被自己的改动触发刷新。
type changeHub struct {
	mu        sync.Mutex
	clients   map[*changeClient]struct{}
	revisions map[string]uint64
}

func newChangeHub() *changeHub {
	return &changeHub{clients: map[*changeClient]struct{}{}, revisions: map[string]uint64{}}
}

func (h *changeHub) register(client *changeClient) {
	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()
}

func (h *changeHub) unregister(client *changeClient) {
	h.mu.Lock()
	delete(h.clients, client)
	h.mu.Unlock()
}

// publish 推进仓库修订号并把变更事件推给全部在线前端；写失败即静默丢弃该连接的通知。
func (h *changeHub) publish(repoID string, kinds ...string) {
	if len(kinds) == 0 {
		return
	}
	h.mu.Lock()
	h.revisions[repoID]++
	revision := h.revisions[repoID]
	clients := make([]*changeClient, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.Unlock()

	frame := map[string]any{
		"type":     "event",
		"event":    "changed",
		"repoId":   repoID,
		"kinds":    kinds,
		"revision": revision,
	}
	for _, client := range clients {
		_ = client.writeJSON(frame)
	}
}

// revision 返回仓库当前的变更修订号，供前端重连后对账（判断是否漏掉了通知）。
func (h *changeHub) revision(repoID string) uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.revisions[repoID]
}
