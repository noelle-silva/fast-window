package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	dataSchemaVersion = 1
	dataVersion       = 1
	settingsFile      = "settings.json"
	historyFile       = "history.json"
	metaFile          = "_meta.json"
	migrationsFile    = "_migrations.json"
)

type service struct {
	dataDir string
	client  *http.Client
	mu      sync.Mutex
}

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

type appSettings struct {
	SchemaVersion int      `json:"schemaVersion"`
	DataVersion   int      `json:"dataVersion"`
	ProviderName  string   `json:"providerName"`
	BaseURL       string   `json:"baseUrl"`
	APIKey        string   `json:"apiKey"`
	Model         string   `json:"model"`
	SystemPrompt  string   `json:"systemPrompt"`
	Temperature   *float64 `json:"temperature,omitempty"`
	UpdatedAt     string   `json:"updatedAt"`
}

type historyDoc struct {
	SchemaVersion int            `json:"schemaVersion"`
	DataVersion   int            `json:"dataVersion"`
	Items         []historyEntry `json:"items"`
}

type historyEntry struct {
	ID           string `json:"id"`
	Prompt       string `json:"prompt"`
	Answer       string `json:"answer"`
	Model        string `json:"model"`
	ProviderName string `json:"providerName"`
	CreatedAt    string `json:"createdAt"`
	Error        string `json:"error,omitempty"`
}

type metaDoc struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	UpdatedAt     string `json:"updatedAt"`
}

type migrationsLedger struct {
	SchemaVersion int              `json:"schemaVersion"`
	DataVersion   int              `json:"dataVersion"`
	Applied       []migrationEntry `json:"applied"`
}

type migrationEntry struct {
	ID          string `json:"id"`
	FromVersion int    `json:"fromVersion"`
	ToVersion   int    `json:"toVersion"`
	Description string `json:"description"`
	AppliedAt   string `json:"appliedAt"`
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
		return errors.New("ai-once backend missing FW_APP_SESSION_TOKEN")
	}

	svc, err := newService()
	if err != nil {
		return err
	}
	if err := svc.ensureReady(); err != nil {
		return err
	}

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

func newService() (*service, error) {
	dataDir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	if dataDir == "" {
		return nil, errors.New("ai-once backend missing FW_APP_DATA_DIR")
	}
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve data dir failed: %w", err)
	}
	return &service{dataDir: abs, client: &http.Client{Timeout: 70 * time.Second}}, nil
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

		result, err := svc.dispatchSafe(frame.Method, frame.Params)
		response := responseFrame{ID: frame.ID, Type: "response", OK: err == nil, Result: result}
		if err != nil {
			response.Error = map[string]any{"message": err.Error()}
		}
		_ = conn.WriteJSON(response)
	}
}

func (svc *service) dispatchSafe(method string, params json.RawMessage) (result any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("request handler panic: %v", recovered)
		}
	}()
	return svc.dispatch(method, params)
}

func (svc *service) dispatch(method string, params json.RawMessage) (any, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()

	switch method {
	case "aiOnce.health":
		return map[string]any{"ok": true, "dataDir": svc.dataDir, "time": nowText()}, nil
	case "aiOnce.echo":
		var payload any
		if len(params) > 0 {
			_ = json.Unmarshal(params, &payload)
		}
		return map[string]any{"echo": payload}, nil
	case "aiOnce.settings.get":
		return svc.readSettings()
	case "aiOnce.settings.save":
		var payload appSettings
		if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
			return nil, fmt.Errorf("invalid settings payload: %w", err)
		}
		return svc.saveSettings(payload)
	case "aiOnce.history.list":
		return svc.readHistory()
	case "aiOnce.history.clear":
		doc := historyDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Items: []historyEntry{}}
		return doc, writeJSON(filepath.Join(svc.dataDir, historyFile), doc)
	case "aiOnce.ask":
		var payload struct {
			Prompt       string `json:"prompt"`
			SystemPrompt string `json:"systemPrompt"`
			Model        string `json:"model"`
		}
		if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
			return nil, fmt.Errorf("invalid ask payload: %w", err)
		}
		return svc.ask(payload.Prompt, payload.SystemPrompt, payload.Model)
	default:
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

func (svc *service) ensureReady() error {
	if err := os.MkdirAll(svc.dataDir, 0o755); err != nil {
		return err
	}
	if err := ensureWritable(svc.dataDir); err != nil {
		return err
	}
	if err := svc.runMigrations(); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, settingsFile)); errors.Is(err, os.ErrNotExist) {
		if _, err := svc.saveSettings(defaultSettings()); err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, historyFile)); errors.Is(err, os.ErrNotExist) {
		return writeJSON(filepath.Join(svc.dataDir, historyFile), historyDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Items: []historyEntry{}})
	}
	return nil
}

func (svc *service) runMigrations() error {
	ledger := migrationsLedger{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Applied: []migrationEntry{}}
	path := filepath.Join(svc.dataDir, migrationsFile)
	if bytes, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(bytes, &ledger); err != nil {
			return fmt.Errorf("read migrations ledger failed: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read migrations ledger failed: %w", err)
	}

	if ledger.DataVersion > dataVersion {
		return fmt.Errorf("data version %d is newer than supported version %d", ledger.DataVersion, dataVersion)
	}
	ledger.SchemaVersion = dataSchemaVersion
	ledger.DataVersion = dataVersion
	if ledger.Applied == nil {
		ledger.Applied = []migrationEntry{}
	}
	if err := writeJSON(path, ledger); err != nil {
		return err
	}
	return writeJSON(filepath.Join(svc.dataDir, metaFile), metaDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, UpdatedAt: nowText()})
}

func (svc *service) readSettings() (appSettings, error) {
	var settings appSettings
	if err := readJSON(filepath.Join(svc.dataDir, settingsFile), &settings); err != nil {
		return appSettings{}, err
	}
	return normalizeSettings(settings), nil
}

func (svc *service) saveSettings(settings appSettings) (appSettings, error) {
	next := normalizeSettings(settings)
	next.UpdatedAt = nowText()
	if err := writeJSON(filepath.Join(svc.dataDir, settingsFile), next); err != nil {
		return appSettings{}, err
	}
	return next, nil
}

func (svc *service) readHistory() (historyDoc, error) {
	var doc historyDoc
	if err := readJSON(filepath.Join(svc.dataDir, historyFile), &doc); err != nil {
		return historyDoc{}, err
	}
	doc.SchemaVersion = dataSchemaVersion
	doc.DataVersion = dataVersion
	if doc.Items == nil {
		doc.Items = []historyEntry{}
	}
	sort.SliceStable(doc.Items, func(i, j int) bool { return doc.Items[i].CreatedAt > doc.Items[j].CreatedAt })
	return doc, nil
}

func (svc *service) ask(prompt string, systemPrompt string, overrideModel string) (historyEntry, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return historyEntry{}, errors.New("Prompt 不能为空")
	}
	settings, err := svc.readSettings()
	if err != nil {
		return historyEntry{}, err
	}
	baseURL := trimSlash(settings.BaseURL)
	apiKey := strings.TrimSpace(settings.APIKey)
	model := strings.TrimSpace(overrideModel)
	if model == "" {
		model = strings.TrimSpace(settings.Model)
	}
	if baseURL == "" {
		return historyEntry{}, errors.New("请先配置 Provider Endpoint")
	}
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		return historyEntry{}, errors.New("Provider Endpoint 必须以 http:// 或 https:// 开头")
	}
	if apiKey == "" {
		return historyEntry{}, errors.New("请先配置 API Key")
	}
	if model == "" {
		return historyEntry{}, errors.New("请先配置模型")
	}

	sys := strings.TrimSpace(systemPrompt)
	if sys == "" {
		sys = strings.TrimSpace(settings.SystemPrompt)
	}
	answer, err := svc.callChatCompletions(baseURL, apiKey, model, sys, prompt, settings.temperatureValue())
	entry := historyEntry{ID: newID("ask"), Prompt: prompt, Answer: answer, Model: model, ProviderName: settings.ProviderName, CreatedAt: nowText()}
	if err != nil {
		entry.Error = err.Error()
		_ = svc.appendHistory(entry)
		return entry, err
	}
	if err := svc.appendHistory(entry); err != nil {
		return historyEntry{}, err
	}
	return entry, nil
}

func (svc *service) callChatCompletions(baseURL, apiKey, model, systemPrompt, prompt string, temperature float64) (string, error) {
	messages := []map[string]string{}
	if systemPrompt != "" {
		messages = append(messages, map[string]string{"role": "system", "content": systemPrompt})
	}
	messages = append(messages, map[string]string{"role": "user", "content": prompt})
	payload := map[string]any{"model": model, "messages": messages, "temperature": temperature, "stream": false}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, trimSlash(baseURL)+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	res, err := svc.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	resBody, _ := io.ReadAll(io.LimitReader(res.Body, 4*1024*1024))
	var parsed map[string]any
	_ = json.Unmarshal(resBody, &parsed)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		if msg := nestedString(parsed, "error", "message"); msg != "" {
			return "", fmt.Errorf("AI 请求失败: %s", msg)
		}
		return "", fmt.Errorf("AI 请求失败: HTTP %d %s", res.StatusCode, strings.TrimSpace(string(resBody)))
	}
	answer := extractAnswer(parsed)
	if answer == "" {
		return "", errors.New("AI 响应为空或格式不支持")
	}
	return answer, nil
}

func (svc *service) appendHistory(entry historyEntry) error {
	doc, err := svc.readHistory()
	if err != nil {
		doc = historyDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Items: []historyEntry{}}
	}
	doc.Items = append([]historyEntry{entry}, doc.Items...)
	if len(doc.Items) > 200 {
		doc.Items = doc.Items[:200]
	}
	return writeJSON(filepath.Join(svc.dataDir, historyFile), doc)
}

func defaultSettings() appSettings {
	t := 0.2
	return appSettings{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, ProviderName: "OpenAI Compatible", BaseURL: "https://api.openai.com/v1", APIKey: "", Model: "", SystemPrompt: "你是一个严谨、直接、可执行的助手。", Temperature: &t, UpdatedAt: nowText()}
}

func normalizeSettings(settings appSettings) appSettings {
	base := defaultSettings()
	settings.SchemaVersion = dataSchemaVersion
	settings.DataVersion = dataVersion
	settings.ProviderName = fallback(strings.TrimSpace(settings.ProviderName), base.ProviderName)
	settings.BaseURL = trimSlash(fallback(settings.BaseURL, base.BaseURL))
	settings.APIKey = strings.TrimSpace(settings.APIKey)
	settings.Model = strings.TrimSpace(settings.Model)
	settings.SystemPrompt = fallback(settings.SystemPrompt, base.SystemPrompt)
	if settings.Temperature == nil {
		settings.Temperature = base.Temperature
	}
	settings.UpdatedAt = fallback(settings.UpdatedAt, nowText())
	return settings
}

func (settings appSettings) temperatureValue() float64 {
	if settings.Temperature == nil {
		return 0.2
	}
	if *settings.Temperature < 0 {
		return 0
	}
	if *settings.Temperature > 2 {
		return 2
	}
	return *settings.Temperature
}

func extractAnswer(value map[string]any) string {
	choices, _ := value["choices"].([]any)
	if len(choices) == 0 {
		return ""
	}
	choice, _ := choices[0].(map[string]any)
	if text, _ := choice["text"].(string); strings.TrimSpace(text) != "" {
		return text
	}
	message, _ := choice["message"].(map[string]any)
	if content, _ := message["content"].(string); strings.TrimSpace(content) != "" {
		return content
	}
	return ""
}

func nestedString(value map[string]any, keys ...string) string {
	var cur any = value
	for _, key := range keys {
		m, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = m[key]
	}
	s, _ := cur.(string)
	return strings.TrimSpace(s)
}

func writeReady(port int) {
	ready := map[string]any{"type": "ready", "ipc": map[string]any{"mode": "direct", "transport": "local-websocket", "url": fmt.Sprintf("ws://127.0.0.1:%d", port), "protocolVersion": 1}}
	line, _ := json.Marshal(ready)
	fmt.Println(string(line))
}

func readJSON(path string, target any) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, target)
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(bytes, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func ensureWritable(dir string) error {
	path := filepath.Join(dir, ".fw-ai-once-write-test")
	if err := os.WriteFile(path, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data dir is not writable: %w", err)
	}
	_ = os.Remove(path)
	return nil
}

func trimSlash(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }

func fallback(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func nowText() string { return time.Now().UTC().Format(time.RFC3339) }

func newID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UTC().UnixNano())
}
