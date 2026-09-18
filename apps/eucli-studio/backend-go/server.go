package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

type directServer struct {
	token   string
	service *service
	hub     *eventHub
}

func newDirectServer(token string, service *service, hub *eventHub) *directServer {
	return &directServer{token: token, service: service, hub: hub}
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

func (s *directServer) handleConnection(conn *directConnection) {
	defer conn.close()
	s.hub.add(conn)
	defer s.hub.remove(conn)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	healthChecked := false
	for {
		var frame requestFrame
		if err := conn.readJSON(&frame); err != nil {
			return
		}
		if frame.ID == "" || frame.Type != "request" || frame.Method == "" {
			continue
		}
		if !healthChecked && frame.Method != "aiChat.healthCheck" {
			_ = conn.writeJSON(errorResponseFor(frame.ID, newError("HEALTH_CHECK_REQUIRED", "请先完成 healthCheck")))
			continue
		}
		result, err := s.service.dispatch(ctx, frame.Method, frame.Params)
		if frame.Method == "aiChat.healthCheck" && err == nil {
			healthChecked = true
		}
		if err != nil {
			_ = conn.writeJSON(errorResponseFor(frame.ID, err))
			continue
		}
		_ = conn.writeJSON(okResponse(frame.ID, result))
	}
}

func writeReady(port int) {
	line, err := json.Marshal(readyFrame{Type: "ready", IPC: readyIPC{Mode: "direct", Transport: "local-websocket", URL: fmt.Sprintf("ws://127.0.0.1:%d", port), ProtocolVersion: directProtocolVersion}})
	if err != nil {
		log.Printf("ready frame marshal failed: %v", err)
		return
	}
	fmt.Println(string(line))
}
