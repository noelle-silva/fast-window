package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/websocket"
)

type rpcServer struct {
	svc   *service
	token string
}
type rpcRequest struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}
type rpcResponse struct {
	ID     string    `json:"id"`
	Type   string    `json:"type"`
	OK     bool      `json:"ok"`
	Result any       `json:"result,omitempty"`
	Error  *rpcError `json:"error,omitempty"`
}
type rpcError struct {
	Message string `json:"message"`
}

func startRPC(svc *service) error {
	token := strings.TrimSpace(os.Getenv("FW_APP_SESSION_TOKEN"))
	if token == "" {
		token = "dev"
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	server := &rpcServer{svc: svc, token: token}
	mux := http.NewServeMux()
	mux.HandleFunc("/", server.handleWS)
	go func() { _ = http.Serve(ln, mux) }()
	fmt.Printf("{\"type\":\"ready\",\"ipc\":{\"url\":\"ws://%s\"}}\n", ln.Addr().String())
	select {}
}

func (s *rpcServer) handleWS(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("token") != s.token {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	c, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
	for {
		var req rpcRequest
		if err := c.ReadJSON(&req); err != nil {
			return
		}
		result, err := s.dispatch(req.Method, req.Params)
		res := rpcResponse{ID: req.ID, Type: "response", OK: err == nil, Result: result}
		if err != nil {
			res.Error = &rpcError{Message: err.Error()}
		}
		if err := c.WriteJSON(res); err != nil {
			return
		}
	}
}

func (s *rpcServer) dispatch(method string, params json.RawMessage) (any, error) {
	if err := s.svc.ensureReady(); err != nil {
		return nil, err
	}
	switch method {
	case "aiOnce.data.get":
		return s.svc.readData()
	case "aiOnce.data.save":
		var data AppData
		if err := json.Unmarshal(params, &data); err != nil {
			return nil, err
		}
		return s.svc.saveData(data)
	case "aiOnce.models.refresh":
		var p struct {
			ProviderID string `json:"providerId"`
		}
		_ = json.Unmarshal(params, &p)
		return s.svc.refreshModels(p.ProviderID)
	case "aiOnce.ask":
		var req AskRequest
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, err
		}
		return s.svc.ask(req)
	case "aiOnce.history.list":
		return s.svc.readHistory()
	case "aiOnce.history.entry":
		var p struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		return s.svc.readHistoryEntry(p.ID)
	case "aiOnce.health":
		return map[string]any{"ok": true, "dataDir": s.svc.dataDir, "version": dataVersion}, nil
	case "aiOnce.echo":
		var v any
		_ = json.Unmarshal(params, &v)
		return v, nil
	default:
		return nil, fmt.Errorf("未知 RPC: %s", method)
	}
}
