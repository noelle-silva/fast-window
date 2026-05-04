package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

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

type studioData struct {
	SchemaVersion int                    `json:"schemaVersion"`
	State         map[string]any         `json:"state"`
	Conversations []conversation         `json:"conversations"`
	Providers     []provider             `json:"providers"`
	UpdatedAt     int64                  `json:"updatedAt"`
}

type conversation struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Messages  []message      `json:"messages"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt int64          `json:"updatedAt"`
	Meta      map[string]any `json:"meta,omitempty"`
}

type message struct {
	ID        string         `json:"id"`
	Role      string         `json:"role"`
	Content   string         `json:"content"`
	CreatedAt int64          `json:"createdAt"`
	Meta      map[string]any `json:"meta,omitempty"`
}

type provider struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Kind      string         `json:"kind"`
	BaseURL   string         `json:"baseUrl,omitempty"`
	Models    []string       `json:"models"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt int64          `json:"updatedAt"`
	Meta      map[string]any `json:"meta,omitempty"`
}

type service struct {
	dataFile string
}

func main() {
	if err := run(); err != nil {
		log.Printf("fatal %v", err)
		os.Exit(1)
	}
}

func run() error {
	token := strings.TrimSpace(os.Getenv("FW_APP_SESSION_TOKEN"))
	if token == "" {
		return errors.New("ai-studio-backend missing FW_APP_SESSION_TOKEN")
	}

	svc := &service{dataFile: resolveDataFilePath()}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("failed to bind local websocket: %w", err)
	}

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		go handleConnection(conn, svc)
	})}

	addr := listener.Addr().(*net.TCPAddr)
	writeReady(addr.Port)
	log.Printf("ready {\"url\":\"ws://127.0.0.1:%d\"}", addr.Port)

	return server.Serve(listener)
}

func handleConnection(conn *websocket.Conn, svc *service) {
	defer conn.Close()
	for {
		var frame requestFrame
		if err := conn.ReadJSON(&frame); err != nil {
			return
		}
		if frame.ID == "" || frame.Type != "request" {
			continue
		}

		result, err := svc.dispatch(frame.Method, frame.Params)
		response := responseFrame{ID: frame.ID, Type: "response", OK: err == nil, Result: result}
		if err != nil {
			response.Error = map[string]any{"message": err.Error()}
		}
		_ = conn.WriteJSON(response)
	}
}

func writeReady(port int) {
	ready := map[string]any{
		"type": "ready",
		"ipc": map[string]any{
			"mode":            "direct",
			"transport":       "local-websocket",
			"url":             fmt.Sprintf("ws://127.0.0.1:%d", port),
			"protocolVersion": 1,
		},
	}
	line, _ := json.Marshal(ready)
	fmt.Println(string(line))
}

func resolveDataFilePath() string {
	dataDir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(mustGetwd(), "data")
	}
	return filepath.Join(dataDir, "studio.json")
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func (svc *service) dispatch(method string, params json.RawMessage) (any, error) {
	switch method {
	case "studio.bootstrap":
		return svc.bootstrap()
	case "studio.state.get":
		data, err := svc.load()
		if err != nil {
			return nil, err
		}
		return data.State, nil
	case "studio.state.save":
		return svc.saveState(params)
	case "studio.conversation.list":
		data, err := svc.load()
		if err != nil {
			return nil, err
		}
		return data.Conversations, nil
	case "studio.conversation.create":
		return svc.createConversation(params)
	case "studio.conversation.update":
		return svc.updateConversation(params)
	case "studio.conversation.delete":
		return svc.deleteConversation(params)
	case "studio.provider.list":
		data, err := svc.load()
		if err != nil {
			return nil, err
		}
		return data.Providers, nil
	case "studio.provider.save":
		return svc.saveProvider(params)
	case "studio.message.send":
		return nil, errors.New("AI 消息发送将在业务迁移阶段接入")
	case "studio.message.cancel":
		return map[string]bool{"cancelled": true}, nil
	case "studio.attachment.add", "studio.attachment.remove":
		return nil, errors.New("附件能力将在业务迁移阶段接入")
	case "aiChat.healthCheck":
		return map[string]any{"version": 1, "status": "ok"}, nil
	case "aiChat.storageGet":
		return svc.storageGet(params)
	case "aiChat.storageSet":
		return svc.storageSet(params)
	case "aiChat.storageRemove":
		return svc.storageRemove(params)
	default:
		return nil, fmt.Errorf("未知请求：%s", method)
	}
}

func (svc *service) bootstrap() (map[string]any, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"schemaVersion": data.SchemaVersion,
		"state":         data.State,
		"conversations": data.Conversations,
		"providers":     data.Providers,
		"dataFile":      svc.dataFile,
		"updatedAt":     data.UpdatedAt,
	}, nil
}

func (svc *service) load() (studioData, error) {
	if err := os.MkdirAll(filepath.Dir(svc.dataFile), 0o755); err != nil {
		return studioData{}, err
	}
	rawBytes, err := os.ReadFile(svc.dataFile)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return studioData{}, err
	}
	if errors.Is(err, os.ErrNotExist) || strings.TrimSpace(string(rawBytes)) == "" {
		data := defaultStudioData()
		return data, svc.save(data)
	}

	var data studioData
	if err := json.Unmarshal(rawBytes, &data); err != nil {
		return studioData{}, err
	}
	return normalizeData(data), nil
}

func (svc *service) save(data studioData) error {
	if err := os.MkdirAll(filepath.Dir(svc.dataFile), 0o755); err != nil {
		return err
	}
	normalized := normalizeData(data)
	normalized.UpdatedAt = nowMs()
	payload, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return os.WriteFile(svc.dataFile, payload, 0o644)
}

func (svc *service) saveState(params json.RawMessage) (map[string]any, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(params, &payload); err != nil {
		return nil, err
	}
	state, _ := payload["state"].(map[string]any)
	if state == nil {
		state = payload
	}
	data.State = state
	return data.State, svc.save(data)
}

func (svc *service) createConversation(params json.RawMessage) ([]conversation, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	now := nowMs()
	item := conversation{
		ID:        safeID(asString(payload["id"]), "conv"),
		Title:     defaultString(asString(payload["title"]), "新对话"),
		Messages:  []message{},
		CreatedAt: now,
		UpdatedAt: now,
	}
	data.Conversations = append(data.Conversations, item)
	return data.Conversations, svc.save(data)
}

func (svc *service) updateConversation(params json.RawMessage) ([]conversation, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	id := strings.TrimSpace(asString(payload["id"]))
	if id == "" {
		return nil, errors.New("id is required")
	}
	for i := range data.Conversations {
		if data.Conversations[i].ID != id {
			continue
		}
		if title := strings.TrimSpace(asString(payload["title"])); title != "" {
			data.Conversations[i].Title = title
		}
		if rawMessages, ok := payload["messages"]; ok {
			data.Conversations[i].Messages = normalizeMessages(rawMessages)
		}
		data.Conversations[i].UpdatedAt = nowMs()
		return data.Conversations, svc.save(data)
	}
	return nil, fmt.Errorf("会话不存在：%s", id)
}

func (svc *service) deleteConversation(params json.RawMessage) ([]conversation, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	id := strings.TrimSpace(asString(payload["id"]))
	if id == "" {
		return nil, errors.New("id is required")
	}
	next := make([]conversation, 0, len(data.Conversations))
	for _, item := range data.Conversations {
		if item.ID != id {
			next = append(next, item)
		}
	}
	data.Conversations = next
	return data.Conversations, svc.save(data)
}

func (svc *service) saveProvider(params json.RawMessage) ([]provider, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	now := nowMs()
	item := provider{
		ID:        safeID(asString(payload["id"]), "provider"),
		Name:      defaultString(asString(payload["name"]), "未命名 Provider"),
		Kind:      defaultString(asString(payload["kind"]), "openai-compatible"),
		BaseURL:   strings.TrimSpace(asString(payload["baseUrl"])),
		Models:    normalizeStringList(payload["models"]),
		CreatedAt: now,
		UpdatedAt: now,
	}
	for i := range data.Providers {
		if data.Providers[i].ID == item.ID {
			item.CreatedAt = data.Providers[i].CreatedAt
			data.Providers[i] = item
			return data.Providers, svc.save(data)
		}
	}
	data.Providers = append(data.Providers, item)
	return data.Providers, svc.save(data)
}

func (svc *service) storageGet(params json.RawMessage) (any, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	key := requestKey(params)
	if key == "" {
		return nil, errors.New("key is required")
	}
	return data.State[key], nil
}

func (svc *service) storageSet(params json.RawMessage) (map[string]bool, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	key := strings.TrimSpace(asString(payload["key"]))
	if key == "" {
		return nil, errors.New("key is required")
	}
	if data.State == nil {
		data.State = map[string]any{}
	}
	data.State[key] = payload["value"]
	return map[string]bool{"ok": true}, svc.save(data)
}

func (svc *service) storageRemove(params json.RawMessage) (map[string]bool, error) {
	data, err := svc.load()
	if err != nil {
		return nil, err
	}
	key := requestKey(params)
	if key == "" {
		return nil, errors.New("key is required")
	}
	delete(data.State, key)
	return map[string]bool{"ok": true}, svc.save(data)
}

func defaultStudioData() studioData {
	now := nowMs()
	return studioData{
		SchemaVersion: 1,
		State:         map[string]any{},
		Conversations: []conversation{},
		Providers:     []provider{},
		UpdatedAt:     now,
	}
}

func normalizeData(data studioData) studioData {
	if data.SchemaVersion <= 0 {
		data.SchemaVersion = 1
	}
	if data.State == nil {
		data.State = map[string]any{}
	}
	if data.Conversations == nil {
		data.Conversations = []conversation{}
	}
	if data.Providers == nil {
		data.Providers = []provider{}
	}
	return data
}

func normalizeMessages(raw any) []message {
	list, ok := raw.([]any)
	if !ok {
		return []message{}
	}
	now := nowMs()
	items := make([]message, 0, len(list))
	for _, entry := range list {
		m, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, message{
			ID:        safeID(asString(m["id"]), "msg"),
			Role:      defaultString(asString(m["role"]), "user"),
			Content:   asString(m["content"]),
			CreatedAt: asInt64(m["createdAt"], now),
		})
	}
	return items
}

func requestKey(params json.RawMessage) string {
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	return strings.TrimSpace(asString(payload["key"]))
}

func normalizeStringList(raw any) []string {
	list, ok := raw.([]any)
	if !ok {
		return []string{}
	}
	items := make([]string, 0, len(list))
	for _, item := range list {
		value := strings.TrimSpace(asString(item))
		if value != "" {
			items = append(items, value)
		}
	}
	return items
}

func safeID(raw string, prefix string) string {
	id := strings.TrimSpace(raw)
	if id != "" {
		return id
	}
	return fmt.Sprintf("%s-%d", prefix, nowMs())
}

func defaultString(raw string, fallback string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback
	}
	return value
}

func asString(raw any) string {
	switch v := raw.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func asInt64(raw any, fallback int64) int64 {
	switch v := raw.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return fallback
	}
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}
