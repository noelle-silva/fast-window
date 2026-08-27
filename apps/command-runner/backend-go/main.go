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
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	settingsFile   = "settings.json"
	reposFile      = "repos.json"
	commandsFile   = "commands.json"
	metaFile       = "_meta.json"
	migrationsFile = "_migrations.json"
	runTmpDir      = "run-tmp"
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

func main() {
	if err := run(); err != nil {
		log.Printf("fatal %v", err)
		os.Exit(1)
	}
}

func run() error {
	token := strings.TrimSpace(os.Getenv("FW_APP_SESSION_TOKEN"))
	if token == "" {
		return errors.New("command-runner backend missing FW_APP_SESSION_TOKEN")
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
		return nil, errors.New("command-runner backend missing FW_APP_DATA_DIR")
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
	case "commandRunner.health":
		return map[string]any{"ok": true, "dataDir": svc.dataDir, "time": time.Now().UTC().Format(time.RFC3339)}, nil

	case "commandRunner.settings.get":
		return svc.readSettings()

	case "commandRunner.settings.save":
		var payload struct {
			DefaultShellID          string `json:"defaultShellId"`
			DefaultCloseMode        string `json:"defaultCloseMode"`
			DefaultCountdownSeconds int    `json:"defaultCountdownSeconds"`
		}
		if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
			return nil, fmt.Errorf("invalid settings payload: %w", err)
		}
		return svc.saveGlobalSettings(payload.DefaultShellID, payload.DefaultCloseMode, payload.DefaultCountdownSeconds)

	case "commandRunner.terminals.list":
		return svc.listTerminals()

	case "commandRunner.shells.custom.add":
		var payload struct {
			Name         string `json:"name"`
			ExePath      string `json:"exePath"`
			ArgsTemplate string `json:"argsTemplate"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid custom shell payload: %w", err)
		}
		return svc.addCustomShell(payload.Name, payload.ExePath, payload.ArgsTemplate)

	case "commandRunner.shells.custom.remove":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid custom shell payload: %w", err)
		}
		return svc.removeCustomShell(payload.ID)

	case "commandRunner.repos.list":
		return svc.listRepos()

	case "commandRunner.repos.create":
		var payload struct {
			Name string `json:"name"`
			Path string `json:"path"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid repo payload: %w", err)
		}
		return svc.createRepo(payload.Name, payload.Path)

	case "commandRunner.repos.update":
		var payload struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Path string `json:"path"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid repo payload: %w", err)
		}
		return svc.updateRepo(payload.ID, payload.Name, payload.Path)

	case "commandRunner.repos.delete":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid repo payload: %w", err)
		}
		return nil, svc.deleteRepo(payload.ID)

	case "commandRunner.repos.reorder":
		var payload struct {
			OrderedIDs []string `json:"orderedIds"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid repo payload: %w", err)
		}
		return nil, svc.reorderRepos(payload.OrderedIDs)

	case "commandRunner.commands.list":
		var payload struct {
			RepoID string `json:"repoId"`
		}
		if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
			return nil, fmt.Errorf("invalid command query payload: %w", err)
		}
		return svc.listCommands(payload.RepoID)

	case "commandRunner.commands.create":
		var draft commandDraft
		if err := json.Unmarshal(params, &draft); err != nil {
			return nil, fmt.Errorf("invalid command payload: %w", err)
		}
		return svc.createCommand(draft)

	case "commandRunner.commands.update":
		var payload struct {
			ID    string          `json:"id"`
			Draft commandDraft    `json:"draft"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid command payload: %w", err)
		}
		return svc.updateCommand(payload.ID, payload.Draft)

	case "commandRunner.commands.delete":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid command payload: %w", err)
		}
		return nil, svc.deleteCommand(payload.ID)

	case "commandRunner.commands.reorder":
		var payload struct {
			OrderedIDs []string `json:"orderedIds"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid command payload: %w", err)
		}
		return nil, svc.reorderCommands(payload.OrderedIDs)

	case "commandRunner.commands.run":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid command payload: %w", err)
		}
		return svc.runCommand(payload.ID)

	default:
		return nil, fmt.Errorf("unknown method: %s", method)
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

func nowText() string {
	return time.Now().UTC().Format(time.RFC3339)
}
