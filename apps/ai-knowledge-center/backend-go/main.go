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
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	dataSchemaVersion    = 1
	dataVersion          = 1
	settingsFile         = "connection.json"
	secretsFile          = "secrets.json"
	metaFile             = "_meta.json"
	migrationsFile       = "_migrations.json"
	defaultServerBaseURL = "http://127.0.0.1:17321"
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
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	ServerBaseURL string `json:"serverBaseUrl"`
	UpdatedAt     string `json:"updatedAt"`
}

type appSecrets struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	ServerKey     string `json:"serverKey"`
	UpdatedAt     string `json:"updatedAt"`
}

type connectionView struct {
	SchemaVersion        int    `json:"schemaVersion"`
	DataVersion          int    `json:"dataVersion"`
	ServerBaseURL        string `json:"serverBaseUrl"`
	DefaultServerBaseURL string `json:"defaultServerBaseUrl"`
	HasServerKey         bool   `json:"hasServerKey"`
	UpdatedAt            string `json:"updatedAt"`
}

type saveConnectionInput struct {
	ServerBaseURL  string  `json:"serverBaseUrl"`
	ServerKey      *string `json:"serverKey"`
	ClearServerKey bool    `json:"clearServerKey"`
}

type documentListInput struct {
	Status string `json:"status"`
	Query  string `json:"query"`
	Tag    string `json:"tag"`
}

type idInput struct {
	ID string `json:"id"`
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

type fileSnapshot struct {
	path    string
	exists  bool
	content []byte
}

type connectionState struct {
	settings appSettings
	secrets  appSecrets
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
		return errors.New("ai-knowledge-center backend missing FW_APP_SESSION_TOKEN")
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
		return nil, errors.New("ai-knowledge-center backend missing FW_APP_DATA_DIR")
	}
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve data dir failed: %w", err)
	}
	return &service{dataDir: abs, client: &http.Client{Timeout: 10 * time.Second}}, nil
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
	switch method {
	case "knowledge.connection.get":
		return svc.readConnection()
	case "knowledge.connection.save":
		var input saveConnectionInput
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return svc.saveConnection(input)
	case "knowledge.connection.clear":
		return svc.clearConnection()
	case "knowledge.health":
		return svc.serverRequest(http.MethodGet, "/health", nil)
	case "knowledge.documents.list":
		var input documentListInput
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return svc.serverRequest(http.MethodGet, documentListPath(input), nil)
	case "knowledge.documents.get":
		var input idInput
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		id := strings.TrimSpace(input.ID)
		if id == "" {
			return nil, errors.New("document id is required")
		}
		return svc.serverRequest(http.MethodGet, "/v1/documents/"+url.PathEscape(id), nil)
	case "knowledge.collections.list":
		return svc.serverRequest(http.MethodGet, "/v1/collections", nil)
	case "knowledge.collections.get":
		var input idInput
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		id := strings.TrimSpace(input.ID)
		if id == "" {
			return nil, errors.New("collection id is required")
		}
		return svc.serverRequest(http.MethodGet, "/v1/collections/"+url.PathEscape(id), nil)
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
	if _, err := os.Stat(svc.settingsPath()); errors.Is(err, os.ErrNotExist) {
		if err := svc.writeSettings(defaultSettings()); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err := os.Stat(svc.secretsPath()); errors.Is(err, os.ErrNotExist) {
		return svc.writeSecrets(defaultSecrets())
	} else if err != nil {
		return err
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

func (svc *service) readConnection() (connectionView, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	state, err := svc.readConnectionState()
	if err != nil {
		return connectionView{}, err
	}
	return connectionViewFromState(state), nil
}

func (svc *service) saveConnection(input saveConnectionInput) (connectionView, error) {
	baseURL, err := normalizeServerBaseURL(input.ServerBaseURL)
	if err != nil {
		return connectionView{}, err
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()
	state, err := svc.readConnectionState()
	if err != nil {
		return connectionView{}, err
	}
	state.settings.ServerBaseURL = baseURL
	state.settings.UpdatedAt = nowText()
	if input.ClearServerKey {
		state.secrets.ServerKey = ""
		state.secrets.UpdatedAt = state.settings.UpdatedAt
	} else if input.ServerKey != nil {
		state.secrets.ServerKey = strings.TrimSpace(*input.ServerKey)
		state.secrets.UpdatedAt = state.settings.UpdatedAt
	}
	if err := svc.writeConnectionStateWithRollback(state); err != nil {
		return connectionView{}, err
	}
	return connectionViewFromState(state), nil
}

func (svc *service) clearConnection() (connectionView, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	state := connectionState{settings: defaultSettings(), secrets: defaultSecrets()}
	if err := svc.writeConnectionStateWithRollback(state); err != nil {
		return connectionView{}, err
	}
	return connectionViewFromState(state), nil
}

func (svc *service) serverRequest(method string, path string, body any) (any, error) {
	state, err := svc.connectionForRequest()
	if err != nil {
		return nil, err
	}
	endpoint, err := endpointURL(state.settings.ServerBaseURL, path)
	if err != nil {
		return nil, err
	}
	var payload io.Reader
	if body != nil {
		payloadBytes, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		payload = bytes.NewReader(payloadBytes)
	}
	request, err := http.NewRequest(method, endpoint, payload)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+state.secrets.ServerKey)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := svc.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("知识中心服务器连接失败: %w", err)
	}
	defer response.Body.Close()
	bodyBytes, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("读取知识中心服务器响应失败: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, serverError(response.StatusCode, bodyBytes)
	}
	var result any
	if len(strings.TrimSpace(string(bodyBytes))) == 0 {
		return map[string]any{}, nil
	}
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, fmt.Errorf("解析知识中心服务器响应失败: %w", err)
	}
	return result, nil
}

func (svc *service) connectionForRequest() (connectionState, error) {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	state, err := svc.readConnectionState()
	if err != nil {
		return connectionState{}, err
	}
	if strings.TrimSpace(state.secrets.ServerKey) == "" {
		return connectionState{}, errors.New("访问钥匙未配置")
	}
	return state, nil
}

func (svc *service) readConnectionState() (connectionState, error) {
	settings := defaultSettings()
	if err := readJSON(svc.settingsPath(), &settings); err != nil {
		return connectionState{}, err
	}
	secrets := defaultSecrets()
	if err := readJSON(svc.secretsPath(), &secrets); err != nil {
		return connectionState{}, err
	}
	settings.SchemaVersion = dataSchemaVersion
	settings.DataVersion = dataVersion
	settings.ServerBaseURL = strings.TrimRight(strings.TrimSpace(settings.ServerBaseURL), "/")
	secrets.SchemaVersion = dataSchemaVersion
	secrets.DataVersion = dataVersion
	secrets.ServerKey = strings.TrimSpace(secrets.ServerKey)
	return connectionState{settings: settings, secrets: secrets}, nil
}

func (svc *service) writeConnectionStateWithRollback(state connectionState) error {
	settingsSnapshot, err := snapshotFile(svc.settingsPath())
	if err != nil {
		return err
	}
	secretsSnapshot, err := snapshotFile(svc.secretsPath())
	if err != nil {
		return err
	}
	if err := svc.writeSettings(state.settings); err != nil {
		restoreSnapshot(settingsSnapshot)
		restoreSnapshot(secretsSnapshot)
		return err
	}
	if err := svc.writeSecrets(state.secrets); err != nil {
		restoreSnapshot(settingsSnapshot)
		restoreSnapshot(secretsSnapshot)
		return err
	}
	return nil
}

func (svc *service) writeSettings(settings appSettings) error {
	settings.SchemaVersion = dataSchemaVersion
	settings.DataVersion = dataVersion
	return writeJSON(svc.settingsPath(), settings)
}

func (svc *service) writeSecrets(secrets appSecrets) error {
	secrets.SchemaVersion = dataSchemaVersion
	secrets.DataVersion = dataVersion
	return writeJSON(svc.secretsPath(), secrets)
}

func (svc *service) settingsPath() string {
	return filepath.Join(svc.dataDir, settingsFile)
}

func (svc *service) secretsPath() string {
	return filepath.Join(svc.dataDir, secretsFile)
}

func defaultSettings() appSettings {
	return appSettings{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, ServerBaseURL: defaultServerBaseURL, UpdatedAt: nowText()}
}

func defaultSecrets() appSecrets {
	return appSecrets{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, ServerKey: "", UpdatedAt: nowText()}
}

func connectionViewFromState(state connectionState) connectionView {
	updatedAt := state.settings.UpdatedAt
	if state.secrets.UpdatedAt > updatedAt {
		updatedAt = state.secrets.UpdatedAt
	}
	return connectionView{
		SchemaVersion:        dataSchemaVersion,
		DataVersion:          dataVersion,
		ServerBaseURL:        state.settings.ServerBaseURL,
		DefaultServerBaseURL: defaultServerBaseURL,
		HasServerKey:         strings.TrimSpace(state.secrets.ServerKey) != "",
		UpdatedAt:            updatedAt,
	}
}

func normalizeServerBaseURL(input string) (string, error) {
	value := strings.TrimRight(strings.TrimSpace(input), "/")
	if value == "" {
		return "", errors.New("服务器地址不能为空")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("服务器地址格式无效")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("服务器地址只支持 http 或 https")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("服务器地址不能包含查询参数或片段")
	}
	return value, nil
}

func endpointURL(baseURL string, path string) (string, error) {
	base, err := normalizeServerBaseURL(baseURL)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(path, "/") {
		return "", errors.New("server request path must start with /")
	}
	return base + path, nil
}

func documentListPath(input documentListInput) string {
	query := url.Values{}
	if value := strings.TrimSpace(input.Status); value != "" {
		query.Set("status", value)
	}
	if value := strings.TrimSpace(input.Query); value != "" {
		query.Set("q", value)
	}
	if value := strings.TrimSpace(input.Tag); value != "" {
		query.Set("tag", value)
	}
	if encoded := query.Encode(); encoded != "" {
		return "/v1/documents?" + encoded
	}
	return "/v1/documents"
}

func serverError(statusCode int, body []byte) error {
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && strings.TrimSpace(payload.Error) != "" {
		return fmt.Errorf("知识中心服务器返回错误 %d: %s", statusCode, payload.Error)
	}
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = http.StatusText(statusCode)
	}
	return fmt.Errorf("知识中心服务器返回错误 %d: %s", statusCode, message)
}

func decodeParams(params json.RawMessage, target any) error {
	if len(params) == 0 {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(params))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func snapshotFile(path string) (fileSnapshot, error) {
	content, err := os.ReadFile(path)
	if err == nil {
		return fileSnapshot{path: path, exists: true, content: content}, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return fileSnapshot{path: path}, nil
	}
	return fileSnapshot{}, err
}

func restoreSnapshot(snapshot fileSnapshot) {
	if snapshot.exists {
		_ = os.MkdirAll(filepath.Dir(snapshot.path), 0o755)
		_ = os.WriteFile(snapshot.path, snapshot.content, 0o644)
		return
	}
	_ = os.Remove(snapshot.path)
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
	path := filepath.Join(dir, ".fw-ai-knowledge-center-write-test")
	if err := os.WriteFile(path, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data dir is not writable: %w", err)
	}
	_ = os.Remove(path)
	return nil
}

func nowText() string {
	return time.Now().UTC().Format(time.RFC3339)
}
