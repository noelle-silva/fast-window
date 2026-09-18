package main

import (
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

func (h *eventHub) broadcast(event eventFrame) {
	h.mu.Lock()
	clients := make([]*directConnection, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.Unlock()
	for _, client := range clients {
		if err := client.writeJSON(event); err != nil {
			h.remove(client)
			_ = client.close()
		}
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
	for {
		state := b.service.connectionSnapshot()
		if state == nil || !state.BusinessAvailable {
			select {
			case <-ctx.Done():
				return
			case <-b.service.connectionChanged:
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
			continue
		case <-time.After(1500 * time.Millisecond):
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
		var decoded any
		if err := json.Unmarshal(payload, &decoded); err != nil {
			continue
		}
		b.hub.broadcast(eventFrame{Type: "event", Name: "eucliBox.run.event", Payload: decoded})
	}
}
