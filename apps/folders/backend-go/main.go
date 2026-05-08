package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	dataSchemaVersion = 1
	dataVersion       = 1
	dataFile          = "data.json"
	foldersFile       = "folders.json"
	settingsFile      = "settings.json"
	metaFile          = "_meta.json"
	migrationsFile    = "_migrations.json"
	defaultGroupID    = "default"
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

type folderGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type folderItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	GroupID     string `json:"groupId"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	CreatedAtMS int64  `json:"createdAtMs"`
	UpdatedAtMS int64  `json:"updatedAtMs"`
}

type foldersDoc struct {
	SchemaVersion int           `json:"schemaVersion"`
	DataVersion   int           `json:"dataVersion"`
	Groups        []folderGroup `json:"groups"`
	Items         []folderItem  `json:"items"`
	UpdatedAt     string        `json:"updatedAt"`
}

type appSettings struct {
	SchemaVersion int    `json:"schemaVersion"`
	DataVersion   int    `json:"dataVersion"`
	View          string `json:"view"`
	UpdatedAt     string `json:"updatedAt"`
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
		return errors.New("folders backend missing FW_APP_SESSION_TOKEN")
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
		return nil, errors.New("folders backend missing FW_APP_DATA_DIR")
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
	case "folders.health":
		return map[string]any{"ok": true, "dataDir": svc.dataDir, "time": time.Now().UTC().Format(time.RFC3339)}, nil
	case "folders.echo":
		var payload any
		if len(params) > 0 {
			_ = json.Unmarshal(params, &payload)
		}
		return map[string]any{"echo": payload}, nil
	case "folders.list":
		return svc.readFolders()
	case "folders.getData":
		return svc.readFolders()
	case "folders.saveData":
		var payload foldersDoc
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid data payload: %w", err)
		}
		return svc.saveFoldersData(payload)
	case "folders.add":
		var payload folderItem
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid folder payload: %w", err)
		}
		return svc.addFolder(payload)
	case "folders.update":
		var payload folderItem
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid folder payload: %w", err)
		}
		return svc.updateFolder(payload)
	case "folders.remove":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid remove payload: %w", err)
		}
		return svc.removeFolder(payload.ID)
	case "folders.move":
		var payload struct {
			ID      string `json:"id"`
			GroupID string `json:"groupId"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid move payload: %w", err)
		}
		return svc.moveFolder(payload.ID, payload.GroupID)
	case "folders.groups.add":
		var payload folderGroup
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid group payload: %w", err)
		}
		return svc.addGroup(payload)
	case "folders.groups.update":
		var payload folderGroup
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid group payload: %w", err)
		}
		return svc.updateGroup(payload)
	case "folders.groups.remove":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid remove group payload: %w", err)
		}
		return svc.removeGroup(payload.ID)
	case "folders.open-folder":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid open payload: %w", err)
		}
		return svc.openFolder(payload.ID)
	case "folders.settings.get":
		return svc.readSettings()
	case "folders.settings.save":
		var payload appSettings
		if err := json.Unmarshal(params, &payload); err != nil && len(params) > 0 {
			return nil, fmt.Errorf("invalid settings payload: %w", err)
		}
		return svc.saveSettings(payload.View)
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
	if _, err := os.Stat(filepath.Join(svc.dataDir, dataFile)); errors.Is(err, os.ErrNotExist) {
		if err := svc.writeFolders(defaultFoldersDoc()); err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, settingsFile)); errors.Is(err, os.ErrNotExist) {
		_, err = svc.saveSettings("grid")
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
	dataPath := filepath.Join(svc.dataDir, dataFile)
	if _, err := os.Stat(dataPath); errors.Is(err, os.ErrNotExist) {
		if migrated, migrationID, err := svc.loadLegacyFoldersDoc(); err != nil {
			return err
		} else if migrated != nil {
			if err := writeJSON(dataPath, normalizeFoldersDoc(*migrated)); err != nil {
				return err
			}
			ledger.Applied = appendMigration(ledger.Applied, migrationEntry{ID: migrationID, FromVersion: 0, ToVersion: dataVersion, Description: "migrate folders app data into data.json", AppliedAt: nowText()})
		}
	}

	if err := writeJSON(path, ledger); err != nil {
		return err
	}
	return writeJSON(filepath.Join(svc.dataDir, metaFile), metaDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, UpdatedAt: nowText()})
}

func (svc *service) loadLegacyFoldersDoc() (*foldersDoc, string, error) {
	foldersPath := filepath.Join(svc.dataDir, foldersFile)
	bytes, err := os.ReadFile(foldersPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("read legacy folders data failed: %w", err)
	}
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(bytes, &wrapped); err == nil && len(wrapped.Data) > 0 && string(wrapped.Data) != "null" {
		var doc foldersDoc
		if err := json.Unmarshal(wrapped.Data, &doc); err != nil {
			return nil, "", fmt.Errorf("parse legacy wrapped folders data failed: %w", err)
		}
		return &doc, "legacy-folders-json-wrapper-to-data-json", nil
	}
	var doc foldersDoc
	if err := json.Unmarshal(bytes, &doc); err != nil {
		return nil, "", fmt.Errorf("parse legacy folders data failed: %w", err)
	}
	return &doc, "legacy-folders-json-to-data-json", nil
}

func appendMigration(entries []migrationEntry, entry migrationEntry) []migrationEntry {
	for _, current := range entries {
		if current.ID == entry.ID {
			return entries
		}
	}
	return append(entries, entry)
}

func (svc *service) readFolders() (foldersDoc, error) {
	var doc foldersDoc
	if err := readJSON(filepath.Join(svc.dataDir, dataFile), &doc); err != nil {
		return foldersDoc{}, err
	}
	return normalizeFoldersDoc(doc), nil
}

func (svc *service) writeFolders(doc foldersDoc) error {
	doc = normalizeFoldersDoc(doc)
	doc.UpdatedAt = nowText()
	return writeJSON(filepath.Join(svc.dataDir, dataFile), doc)
}

func (svc *service) saveFoldersData(payload foldersDoc) (foldersDoc, error) {
	doc := normalizeFoldersDoc(payload)
	if len(doc.Groups) == 0 || doc.Groups[0].ID != defaultGroupID {
		return foldersDoc{}, errors.New("default group is required")
	}
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) addFolder(payload folderItem) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	if strings.TrimSpace(payload.Name) == "" {
		return foldersDoc{}, errors.New("folder name is required")
	}
	item, err := normalizeFolderItem(payload, doc.Groups, true)
	if err != nil {
		return foldersDoc{}, err
	}
	doc.Items = append([]folderItem{item}, doc.Items...)
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) updateFolder(payload folderItem) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	if strings.TrimSpace(payload.Name) == "" {
		return foldersDoc{}, errors.New("folder name is required")
	}
	item, err := normalizeFolderItem(payload, doc.Groups, false)
	if err != nil {
		return foldersDoc{}, err
	}
	for i := range doc.Items {
		if doc.Items[i].ID == item.ID {
			item.CreatedAtMS = doc.Items[i].CreatedAtMS
			doc.Items[i] = item
			if err := svc.writeFolders(doc); err != nil {
				return foldersDoc{}, err
			}
			return svc.readFolders()
		}
	}
	return foldersDoc{}, fmt.Errorf("folder not found: %s", item.ID)
}

func (svc *service) removeFolder(id string) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return foldersDoc{}, errors.New("folder id is required")
	}
	next := doc.Items[:0]
	removed := false
	for _, item := range doc.Items {
		if item.ID == id {
			removed = true
			continue
		}
		next = append(next, item)
	}
	if !removed {
		return foldersDoc{}, fmt.Errorf("folder not found: %s", id)
	}
	doc.Items = next
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) moveFolder(id string, groupID string) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	id = strings.TrimSpace(id)
	groupID = safeID(groupID, 32)
	if id == "" {
		return foldersDoc{}, errors.New("folder id is required")
	}
	if groupID == "" || !hasGroup(doc.Groups, groupID) {
		return foldersDoc{}, errors.New("valid group id is required")
	}
	for i := range doc.Items {
		if doc.Items[i].ID == id {
			doc.Items[i].GroupID = groupID
			doc.Items[i].UpdatedAtMS = time.Now().UnixMilli()
			doc.Items[i].UpdatedAt = nowText()
			if err := svc.writeFolders(doc); err != nil {
				return foldersDoc{}, err
			}
			return svc.readFolders()
		}
	}
	return foldersDoc{}, fmt.Errorf("folder not found: %s", id)
}

func (svc *service) addGroup(payload folderGroup) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	group, err := normalizeGroup(payload, true)
	if err != nil {
		return foldersDoc{}, err
	}
	if hasGroup(doc.Groups, group.ID) {
		return foldersDoc{}, fmt.Errorf("group already exists: %s", group.ID)
	}
	doc.Groups = append(doc.Groups, group)
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) updateGroup(payload folderGroup) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	group, err := normalizeGroup(payload, false)
	if err != nil {
		return foldersDoc{}, err
	}
	for i := range doc.Groups {
		if doc.Groups[i].ID == group.ID {
			doc.Groups[i].Name = group.Name
			if err := svc.writeFolders(doc); err != nil {
				return foldersDoc{}, err
			}
			return svc.readFolders()
		}
	}
	return foldersDoc{}, fmt.Errorf("group not found: %s", group.ID)
}

func (svc *service) removeGroup(id string) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	id = safeID(id, 32)
	if id == "" {
		return foldersDoc{}, errors.New("group id is required")
	}
	if id == defaultGroupID {
		return foldersDoc{}, errors.New("default group cannot be removed")
	}
	nextGroups := doc.Groups[:0]
	removed := false
	for _, group := range doc.Groups {
		if group.ID == id {
			removed = true
			continue
		}
		nextGroups = append(nextGroups, group)
	}
	if !removed {
		return foldersDoc{}, fmt.Errorf("group not found: %s", id)
	}
	for i := range doc.Items {
		if doc.Items[i].GroupID == id {
			doc.Items[i].GroupID = defaultGroupID
			doc.Items[i].UpdatedAtMS = time.Now().UnixMilli()
			doc.Items[i].UpdatedAt = nowText()
		}
	}
	doc.Groups = nextGroups
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) openFolder(id string) (map[string]any, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	for _, item := range doc.Items {
		if item.ID == id {
			if err := openPath(item.Path); err != nil {
				return nil, err
			}
			return map[string]any{"ok": true, "path": item.Path}, nil
		}
	}
	return nil, fmt.Errorf("folder not found: %s", id)
}

func (svc *service) readSettings() (appSettings, error) {
	var settings appSettings
	if err := readJSON(filepath.Join(svc.dataDir, settingsFile), &settings); err != nil {
		return appSettings{}, err
	}
	return normalizeSettings(settings), nil
}

func (svc *service) saveSettings(view string) (appSettings, error) {
	settings := normalizeSettings(appSettings{View: view})
	settings.UpdatedAt = nowText()
	if err := writeJSON(filepath.Join(svc.dataDir, settingsFile), settings); err != nil {
		return appSettings{}, err
	}
	return settings, nil
}

func defaultFoldersDoc() foldersDoc {
	return foldersDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Groups: []folderGroup{{ID: defaultGroupID, Name: "默认"}}, Items: []folderItem{}, UpdatedAt: nowText()}
}

func normalizeFoldersDoc(doc foldersDoc) foldersDoc {
	groups := []folderGroup{{ID: defaultGroupID, Name: "默认"}}
	seen := map[string]bool{defaultGroupID: true}
	for _, group := range doc.Groups {
		normalized, err := normalizeGroup(group, false)
		if err != nil || seen[normalized.ID] {
			continue
		}
		groups = append(groups, normalized)
		seen[normalized.ID] = true
	}

	items := make([]folderItem, 0, len(doc.Items))
	itemIDs := map[string]bool{}
	for _, raw := range doc.Items {
		item, err := normalizeFolderItem(raw, groups, false)
		if err != nil || itemIDs[item.ID] {
			continue
		}
		items = append(items, item)
		itemIDs[item.ID] = true
	}
	return foldersDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, Groups: groups, Items: items, UpdatedAt: firstNonEmpty(doc.UpdatedAt, nowText())}
}

func normalizeGroup(raw folderGroup, allowGeneratedID bool) (folderGroup, error) {
	name := trimMax(raw.Name, 40)
	id := safeID(raw.ID, 32)
	if id == "" && allowGeneratedID {
		id = safeID(name, 32)
	}
	if id == "" {
		return folderGroup{}, errors.New("group id is required")
	}
	if name == "" {
		return folderGroup{}, errors.New("group name is required")
	}
	return folderGroup{ID: id, Name: name}, nil
}

func normalizeFolderItem(raw folderItem, groups []folderGroup, allowNewID bool) (folderItem, error) {
	now := time.Now().UnixMilli()
	nowString := nowText()
	id := strings.TrimSpace(raw.ID)
	if id == "" && allowNewID {
		id = fmt.Sprintf("%d", now)
	}
	if id == "" {
		return folderItem{}, errors.New("folder id is required")
	}
	path := strings.TrimSpace(raw.Path)
	if path == "" {
		return folderItem{}, errors.New("folder path is required")
	}
	name := trimMax(raw.Name, 80)
	if name == "" {
		name = trimMax(filepath.Base(filepath.Clean(path)), 80)
		if name == "" || name == "." {
			return folderItem{}, errors.New("folder name is required")
		}
	}
	groupID := safeID(raw.GroupID, 32)
	if groupID == "" || !hasGroup(groups, groupID) {
		return folderItem{}, errors.New("valid group id is required")
	}
	createdAt := raw.CreatedAtMS
	if createdAt <= 0 {
		createdAt = now
	}
	updatedAt := raw.UpdatedAtMS
	if updatedAt <= 0 {
		updatedAt = now
	}
	createdAtText := strings.TrimSpace(raw.CreatedAt)
	if createdAtText == "" {
		createdAtText = nowString
	}
	updatedAtText := strings.TrimSpace(raw.UpdatedAt)
	if updatedAtText == "" {
		updatedAtText = nowString
	}
	return folderItem{ID: id, Name: name, Path: path, GroupID: groupID, CreatedAt: createdAtText, UpdatedAt: updatedAtText, CreatedAtMS: createdAt, UpdatedAtMS: updatedAt}, nil
}

func normalizeSettings(settings appSettings) appSettings {
	view := strings.TrimSpace(settings.View)
	if view != "list" {
		view = "grid"
	}
	return appSettings{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, View: view, UpdatedAt: firstNonEmpty(settings.UpdatedAt, nowText())}
}

func hasGroup(groups []folderGroup, id string) bool {
	for _, group := range groups {
		if group.ID == id {
			return true
		}
	}
	return false
}

func openPath(path string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("folder path is required")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
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
	path := filepath.Join(dir, ".fw-folders-write-test")
	if err := os.WriteFile(path, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("data dir is not writable: %w", err)
	}
	_ = os.Remove(path)
	return nil
}

func trimMax(value string, max int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= max {
		return value
	}
	return string([]rune(value)[:max])
}

func safeID(value string, max int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var b strings.Builder
	for _, ch := range strings.ToLower(value) {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' {
			b.WriteRune(ch)
		}
	}
	return trimMax(b.String(), max)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func nowText() string {
	return time.Now().UTC().Format(time.RFC3339)
}
