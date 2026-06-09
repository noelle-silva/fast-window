package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	dataSchemaVersion = 1
	dataVersion       = 1
	tasksFile         = "tasks.json"
	metaFile          = "_meta.json"
	migrationsFile    = "_migrations.json"
)

type service struct {
	dataDir string
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

type taskStoreDoc struct {
	SchemaVersion int         `json:"schemaVersion"`
	DataVersion   int         `json:"dataVersion"`
	Boards        []taskBoard `json:"boards"`
	UpdatedAt     string      `json:"updatedAt"`
}

type taskBoard struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Tasks       []taskItem `json:"tasks"`
	CreatedAt   string     `json:"createdAt"`
	UpdatedAt   string     `json:"updatedAt"`
}

type taskItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
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
		return errors.New("task-manager backend missing FW_APP_SESSION_TOKEN")
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
		return nil, errors.New("task-manager backend missing FW_APP_DATA_DIR")
	}
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve data dir failed: %w", err)
	}
	return &service{dataDir: abs}, nil
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
	case "taskManager.health":
		return map[string]any{"ok": true, "dataDir": svc.dataDir, "time": nowText()}, nil
	case "taskManager.boards.list":
		store, err := svc.readStore()
		if err != nil {
			return nil, err
		}
		return store.Boards, nil
	case "taskManager.boards.create":
		var payload struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := decodeParams(params, &payload); err != nil {
			return nil, err
		}
		return svc.createBoard(payload.Title, payload.Description)
	case "taskManager.tasks.create":
		var payload struct {
			BoardID     string `json:"boardId"`
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := decodeParams(params, &payload); err != nil {
			return nil, err
		}
		return svc.createTask(payload.BoardID, payload.Title, payload.Description)
	case "taskManager.tasks.update":
		var payload struct {
			BoardID     string `json:"boardId"`
			TaskID      string `json:"taskId"`
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if err := decodeParams(params, &payload); err != nil {
			return nil, err
		}
		return svc.updateTask(payload.BoardID, payload.TaskID, payload.Title, payload.Description)
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
	if _, err := os.Stat(svc.storePath()); errors.Is(err, os.ErrNotExist) {
		return svc.writeStore(newTaskStore())
	}
	_, err := svc.readStore()
	return err
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

func (svc *service) createBoard(title string, description string) (taskBoard, error) {
	title = normalizeRequiredTitle(title)
	if title == "" {
		return taskBoard{}, errors.New("任务分组标题不能为空")
	}
	store, err := svc.readStore()
	if err != nil {
		return taskBoard{}, err
	}
	now := nowText()
	id, err := randomID("board")
	if err != nil {
		return taskBoard{}, err
	}
	board := taskBoard{ID: id, Title: title, Description: strings.TrimSpace(description), Tasks: []taskItem{}, CreatedAt: now, UpdatedAt: now}
	store.Boards = append(store.Boards, board)
	store.UpdatedAt = now
	if err := svc.writeStore(store); err != nil {
		return taskBoard{}, err
	}
	return board, nil
}

func (svc *service) createTask(boardID string, title string, description string) (taskItem, error) {
	boardID = strings.TrimSpace(boardID)
	title = normalizeRequiredTitle(title)
	if boardID == "" {
		return taskItem{}, errors.New("任务分组 ID 不能为空")
	}
	if title == "" {
		return taskItem{}, errors.New("任务标题不能为空")
	}
	store, err := svc.readStore()
	if err != nil {
		return taskItem{}, err
	}
	boardIndex := findBoardIndex(store.Boards, boardID)
	if boardIndex < 0 {
		return taskItem{}, fmt.Errorf("任务分组不存在: %s", boardID)
	}
	now := nowText()
	id, err := randomID("task")
	if err != nil {
		return taskItem{}, err
	}
	task := taskItem{ID: id, Title: title, Description: strings.TrimSpace(description), CreatedAt: now, UpdatedAt: now}
	store.Boards[boardIndex].Tasks = append(store.Boards[boardIndex].Tasks, task)
	store.Boards[boardIndex].UpdatedAt = now
	store.UpdatedAt = now
	if err := svc.writeStore(store); err != nil {
		return taskItem{}, err
	}
	return task, nil
}

func (svc *service) updateTask(boardID string, taskID string, title string, description string) (taskItem, error) {
	boardID = strings.TrimSpace(boardID)
	taskID = strings.TrimSpace(taskID)
	title = normalizeRequiredTitle(title)
	if boardID == "" {
		return taskItem{}, errors.New("任务分组 ID 不能为空")
	}
	if taskID == "" {
		return taskItem{}, errors.New("任务 ID 不能为空")
	}
	if title == "" {
		return taskItem{}, errors.New("任务标题不能为空")
	}
	store, err := svc.readStore()
	if err != nil {
		return taskItem{}, err
	}
	boardIndex := findBoardIndex(store.Boards, boardID)
	if boardIndex < 0 {
		return taskItem{}, fmt.Errorf("任务分组不存在: %s", boardID)
	}
	taskIndex := findTaskIndex(store.Boards[boardIndex].Tasks, taskID)
	if taskIndex < 0 {
		return taskItem{}, fmt.Errorf("任务不存在: %s", taskID)
	}
	task := store.Boards[boardIndex].Tasks[taskIndex]
	task.Title = title
	task.Description = strings.TrimSpace(description)
	task.UpdatedAt = nowText()
	store.Boards[boardIndex].Tasks[taskIndex] = task
	store.Boards[boardIndex].UpdatedAt = task.UpdatedAt
	store.UpdatedAt = task.UpdatedAt
	if err := svc.writeStore(store); err != nil {
		return taskItem{}, err
	}
	return task, nil
}

func (svc *service) readStore() (taskStoreDoc, error) {
	var store taskStoreDoc
	if err := readJSON(svc.storePath(), &store); err != nil {
		return taskStoreDoc{}, err
	}
	if store.SchemaVersion != dataSchemaVersion {
		return taskStoreDoc{}, fmt.Errorf("schema version %d is not supported", store.SchemaVersion)
	}
	if store.DataVersion > dataVersion {
		return taskStoreDoc{}, fmt.Errorf("data version %d is newer than supported version %d", store.DataVersion, dataVersion)
	}
	if store.Boards == nil {
		store.Boards = []taskBoard{}
	}
	for i := range store.Boards {
		if store.Boards[i].Tasks == nil {
			store.Boards[i].Tasks = []taskItem{}
		}
	}
	return store, nil
}

func (svc *service) writeStore(store taskStoreDoc) error {
	store.SchemaVersion = dataSchemaVersion
	store.DataVersion = dataVersion
	if store.Boards == nil {
		store.Boards = []taskBoard{}
	}
	if strings.TrimSpace(store.UpdatedAt) == "" {
		store.UpdatedAt = nowText()
	}
	return writeJSON(svc.storePath(), store)
}

func (svc *service) storePath() string {
	return filepath.Join(svc.dataDir, tasksFile)
}

func newTaskStore() taskStoreDoc {
	return taskStoreDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Boards: []taskBoard{}, UpdatedAt: nowText()}
}

func decodeParams(params json.RawMessage, target any) error {
	if len(params) == 0 {
		return nil
	}
	if err := json.Unmarshal(params, target); err != nil {
		return fmt.Errorf("invalid request payload: %w", err)
	}
	return nil
}

func findBoardIndex(boards []taskBoard, id string) int {
	for index, board := range boards {
		if board.ID == id {
			return index
		}
	}
	return -1
}

func findTaskIndex(tasks []taskItem, id string) int {
	for index, task := range tasks {
		if task.ID == id {
			return index
		}
	}
	return -1
}

func normalizeRequiredTitle(value string) string {
	return strings.TrimSpace(value)
}

func randomID(prefix string) (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate id failed: %w", err)
	}
	return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UnixMilli(), hex.EncodeToString(bytes)), nil
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
	path := filepath.Join(dir, ".fw-task-manager-write-test")
	if err := os.WriteFile(path, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data dir is not writable: %w", err)
	}
	_ = os.Remove(path)
	return nil
}

func nowText() string {
	return time.Now().UTC().Format(time.RFC3339)
}
