package main

import (
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

type directClient struct {
	conn      *websocket.Conn
	helloDone bool
	sendMu    sync.Mutex
}

type directServer struct {
	token    string
	upgrader websocket.Upgrader
	svc      *service
	mu       sync.Mutex
	clients  map[*directClient]struct{}
}

func newDirectServer(token string, dataDir string) (*directServer, error) {
	server := &directServer{
		token:    strings.TrimSpace(token),
		upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }},
		clients:  map[*directClient]struct{}{},
	}
	svc, err := newService(dataDir, server)
	if err != nil {
		return nil, err
	}
	server.svc = svc
	return server, nil
}

func (server *directServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("token") != server.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := server.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &directClient{conn: conn}
	server.addClient(client)
	go server.handleConnection(client)
}

func (server *directServer) Broadcast(event eventFrame) {
	server.mu.Lock()
	clients := make([]*directClient, 0, len(server.clients))
	for client := range server.clients {
		if client.helloDone {
			clients = append(clients, client)
		}
	}
	server.mu.Unlock()

	for _, client := range clients {
		client.sendMu.Lock()
		if err := client.conn.WriteJSON(event); err != nil {
			client.sendMu.Unlock()
			server.removeClient(client)
			_ = client.conn.Close()
			continue
		}
		client.sendMu.Unlock()
	}
}

func (server *directServer) dispose() {
	if server.svc != nil {
		server.svc.dispose()
	}
	server.mu.Lock()
	clients := make([]*directClient, 0, len(server.clients))
	for client := range server.clients {
		clients = append(clients, client)
	}
	server.clients = map[*directClient]struct{}{}
	server.mu.Unlock()
	for _, client := range clients {
		_ = client.conn.Close()
	}
}

func (server *directServer) addClient(client *directClient) {
	server.mu.Lock()
	defer server.mu.Unlock()
	server.clients[client] = struct{}{}
}

func (server *directServer) removeClient(client *directClient) {
	server.mu.Lock()
	defer server.mu.Unlock()
	delete(server.clients, client)
}

func (server *directServer) markHelloDone(client *directClient) {
	server.mu.Lock()
	defer server.mu.Unlock()
	client.helloDone = true
}

func (server *directServer) handleConnection(client *directClient) {
	defer func() {
		server.removeClient(client)
		_ = client.conn.Close()
	}()

	for {
		var frame requestFrame
		if err := client.conn.ReadJSON(&frame); err != nil {
			return
		}
		if frame.ID == "" || frame.Type != "request" || strings.TrimSpace(frame.Method) == "" {
			continue
		}

		if !client.helloDone && frame.Method != methodProtocolHello {
			server.writeResponse(client, errorResponse(frame.ID, newDirectError(errorBadRequest, "请先完成 protocol.hello")))
			continue
		}

		result, err := server.svc.dispatch(frame.Method, frame.Params)
		if err == nil && frame.Method == methodProtocolHello {
			server.markHelloDone(client)
		}
		response := responseFrame{ID: frame.ID, Type: "response", OK: err == nil, Result: result}
		if err != nil {
			response = errorResponse(frame.ID, err)
		}
		server.writeResponse(client, response)
	}
}

func (server *directServer) writeResponse(client *directClient, response responseFrame) {
	client.sendMu.Lock()
	defer client.sendMu.Unlock()
	_ = client.conn.WriteJSON(response)
}
