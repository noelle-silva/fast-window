package main

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

type requestFrame struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type responseFrame struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	OK     bool           `json:"ok"`
	Result any            `json:"result,omitempty"`
	Error  map[string]any `json:"error,omitempty"`
}

type progressFrame struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Event   string `json:"event"`
	Payload any    `json:"payload,omitempty"`
}

type requestProgress func(event string, payload any) error

type connectionWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (writer *connectionWriter) writeJSON(value any) error {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return writer.conn.WriteJSON(value)
}

type activeRequestRegistry struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func newActiveRequestRegistry() *activeRequestRegistry {
	return &activeRequestRegistry{cancels: map[string]context.CancelFunc{}}
}

func (registry *activeRequestRegistry) add(id string, cancel context.CancelFunc) {
	registry.mu.Lock()
	defer registry.mu.Unlock()
	registry.cancels[id] = cancel
}

func (registry *activeRequestRegistry) cancel(id string) {
	registry.mu.Lock()
	cancel := registry.cancels[id]
	delete(registry.cancels, id)
	registry.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (registry *activeRequestRegistry) remove(id string) {
	registry.mu.Lock()
	delete(registry.cancels, id)
	registry.mu.Unlock()
}

func (registry *activeRequestRegistry) cancelAll() {
	registry.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(registry.cancels))
	for _, cancel := range registry.cancels {
		cancels = append(cancels, cancel)
	}
	registry.cancels = map[string]context.CancelFunc{}
	registry.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
