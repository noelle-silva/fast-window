package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
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
	dataSchemaVersion      = 1
	dataVersion            = 4
	dataFile               = "data.json"
	foldersFile            = "folders.json"
	metaFile               = "_meta.json"
	migrationsFile         = "_migrations.json"
	assetsDir              = "assets"
	iconAssetsDir          = "icons"
	wallpaperAssetsDir     = "wallpapers"
	defaultGroupID         = "default"
	maxLayoutCoord         = 2000
	maxIconAssetBytes      = 12 * 1024 * 1024
	maxWallpaperAssetBytes = 32 * 1024 * 1024
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
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Path        string            `json:"path"`
	GroupID     string            `json:"groupId"`
	ContainerID string            `json:"containerId,omitempty"`
	CreatedAt   string            `json:"createdAt"`
	UpdatedAt   string            `json:"updatedAt"`
	CreatedAtMS int64             `json:"createdAtMs"`
	UpdatedAtMS int64             `json:"updatedAtMs"`
	Layout      *folderGridLayout `json:"layout,omitempty"`
	Icon        *desktopIcon      `json:"icon,omitempty"`
}

type folderGridLayout struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type desktopLayoutPatch struct {
	Kind   string           `json:"kind"`
	ID     string           `json:"id"`
	Layout folderGridLayout `json:"layout"`
}

type desktopIcon struct {
	Kind    string `json:"kind"`
	Color   string `json:"color,omitempty"`
	AssetID string `json:"assetId,omitempty"`
}

type desktopContainer struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	CreatedAt   string            `json:"createdAt"`
	UpdatedAt   string            `json:"updatedAt"`
	CreatedAtMS int64             `json:"createdAtMs"`
	UpdatedAtMS int64             `json:"updatedAtMs"`
	Layout      *folderGridLayout `json:"layout,omitempty"`
	Icon        *desktopIcon      `json:"icon,omitempty"`
}

type desktopWallpaper struct {
	AssetID string `json:"assetId"`
}

type desktopState struct {
	Wallpaper *desktopWallpaper `json:"wallpaper,omitempty"`
}

type foldersDoc struct {
	SchemaVersion int                `json:"schemaVersion"`
	DataVersion   int                `json:"dataVersion"`
	Groups        []folderGroup      `json:"groups"`
	Items         []folderItem       `json:"items"`
	Containers    []desktopContainer `json:"containers"`
	Desktop       desktopState       `json:"desktop"`
	UpdatedAt     string             `json:"updatedAt"`
}

type desktopAsset struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
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
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			svc.serveAsset(w, r)
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
	case "folders.desktop.layout.save":
		var payload struct {
			Items []desktopLayoutPatch `json:"items"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid desktop layout payload: %w", err)
		}
		return svc.saveDesktopLayouts(payload.Items)
	case "folders.assets.import":
		var payload struct {
			Kind       string `json:"kind"`
			SourcePath string `json:"sourcePath"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid asset import payload: %w", err)
		}
		return svc.importAsset(payload.Kind, payload.SourcePath)
	case "folders.containers.add":
		var payload desktopContainer
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container payload: %w", err)
		}
		return svc.addContainer(payload)
	case "folders.containers.update":
		var payload desktopContainer
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container payload: %w", err)
		}
		return svc.updateContainer(payload)
	case "folders.containers.remove":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid remove container payload: %w", err)
		}
		return svc.removeContainer(payload.ID)
	case "folders.items.container.save":
		var payload struct {
			IDs         []string `json:"ids"`
			ContainerID string   `json:"containerId"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid item container payload: %w", err)
		}
		return svc.saveItemContainer(payload.IDs, payload.ContainerID)
	case "folders.icon.save":
		var payload struct {
			Kind string       `json:"kind"`
			ID   string       `json:"id"`
			Icon *desktopIcon `json:"icon"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid icon payload: %w", err)
		}
		return svc.saveDesktopIcon(payload.Kind, payload.ID, payload.Icon)
	case "folders.desktop.wallpaper.save":
		var payload struct {
			Wallpaper *desktopWallpaper `json:"wallpaper"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid wallpaper payload: %w", err)
		}
		return svc.saveDesktopWallpaper(payload.Wallpaper)
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
			item.CreatedAt = doc.Items[i].CreatedAt
			item.ContainerID = doc.Items[i].ContainerID
			if item.Layout == nil {
				item.Layout = doc.Items[i].Layout
			}
			if item.Icon == nil {
				item.Icon = doc.Items[i].Icon
			}
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

func (svc *service) saveDesktopLayouts(patches []desktopLayoutPatch) (foldersDoc, error) {
	if len(patches) == 0 {
		return svc.readFolders()
	}
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}

	type layoutUpdate struct {
		kind   string
		id     string
		layout folderGridLayout
	}
	updates := make([]layoutUpdate, 0, len(patches))
	for _, patch := range patches {
		kind := normalizeDesktopEntryKind(patch.Kind)
		id := strings.TrimSpace(patch.ID)
		if kind == "" || id == "" {
			return foldersDoc{}, errors.New("desktop layout kind and id are required")
		}
		updates = append(updates, layoutUpdate{kind: kind, id: id, layout: normalizeGridLayout(patch.Layout)})
	}

	found := make(map[string]bool, len(updates))
	now := time.Now().UnixMilli()
	nowString := nowText()
	for _, update := range updates {
		key := update.kind + ":" + update.id
		switch update.kind {
		case "folder":
			for i := range doc.Items {
				if doc.Items[i].ID != update.id {
					continue
				}
				layoutCopy := update.layout
				doc.Items[i].Layout = &layoutCopy
				doc.Items[i].UpdatedAtMS = now
				doc.Items[i].UpdatedAt = nowString
				found[key] = true
				break
			}
		case "container":
			for i := range doc.Containers {
				if doc.Containers[i].ID != update.id {
					continue
				}
				layoutCopy := update.layout
				doc.Containers[i].Layout = &layoutCopy
				doc.Containers[i].UpdatedAtMS = now
				doc.Containers[i].UpdatedAt = nowString
				found[key] = true
				break
			}
		}
	}

	for _, update := range updates {
		key := update.kind + ":" + update.id
		if !found[key] {
			return foldersDoc{}, fmt.Errorf("desktop entry not found: %s", key)
		}
	}

	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) addContainer(payload desktopContainer) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	container, err := normalizeDesktopContainer(payload, true)
	if err != nil {
		return foldersDoc{}, err
	}
	for _, current := range doc.Containers {
		if current.ID == container.ID {
			return foldersDoc{}, fmt.Errorf("container already exists: %s", container.ID)
		}
	}
	doc.Containers = append([]desktopContainer{container}, doc.Containers...)
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) updateContainer(payload desktopContainer) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	container, err := normalizeDesktopContainer(payload, false)
	if err != nil {
		return foldersDoc{}, err
	}
	for i := range doc.Containers {
		if doc.Containers[i].ID != container.ID {
			continue
		}
		container.CreatedAt = doc.Containers[i].CreatedAt
		container.CreatedAtMS = doc.Containers[i].CreatedAtMS
		if container.Layout == nil {
			container.Layout = doc.Containers[i].Layout
		}
		if container.Icon == nil {
			container.Icon = doc.Containers[i].Icon
		}
		doc.Containers[i] = container
		if err := svc.writeFolders(doc); err != nil {
			return foldersDoc{}, err
		}
		return svc.readFolders()
	}
	return foldersDoc{}, fmt.Errorf("container not found: %s", container.ID)
}

func (svc *service) removeContainer(id string) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return foldersDoc{}, errors.New("container id is required")
	}
	nextContainers := doc.Containers[:0]
	removed := false
	for _, container := range doc.Containers {
		if container.ID == id {
			removed = true
			continue
		}
		nextContainers = append(nextContainers, container)
	}
	if !removed {
		return foldersDoc{}, fmt.Errorf("container not found: %s", id)
	}
	now := time.Now().UnixMilli()
	nowString := nowText()
	for i := range doc.Items {
		if doc.Items[i].ContainerID == id {
			doc.Items[i].ContainerID = ""
			doc.Items[i].UpdatedAtMS = now
			doc.Items[i].UpdatedAt = nowString
		}
	}
	doc.Containers = nextContainers
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) saveItemContainer(ids []string, containerID string) (foldersDoc, error) {
	if len(ids) == 0 {
		return svc.readFolders()
	}
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	containerID = strings.TrimSpace(containerID)
	if containerID != "" && !hasContainer(doc.Containers, containerID) {
		return foldersDoc{}, fmt.Errorf("container not found: %s", containerID)
	}
	updates := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return foldersDoc{}, errors.New("folder id is required")
		}
		updates[id] = true
	}
	now := time.Now().UnixMilli()
	nowString := nowText()
	found := map[string]bool{}
	for i := range doc.Items {
		if !updates[doc.Items[i].ID] {
			continue
		}
		doc.Items[i].ContainerID = containerID
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		found[doc.Items[i].ID] = true
	}
	for id := range updates {
		if !found[id] {
			return foldersDoc{}, fmt.Errorf("folder not found: %s", id)
		}
	}
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) saveDesktopIcon(kind string, id string, icon *desktopIcon) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	kind = normalizeDesktopEntryKind(kind)
	id = strings.TrimSpace(id)
	if kind == "" || id == "" {
		return foldersDoc{}, errors.New("desktop icon kind and id are required")
	}
	normalizedIcon, err := validateDesktopIcon(icon)
	if err != nil {
		return foldersDoc{}, err
	}
	now := time.Now().UnixMilli()
	nowString := nowText()
	switch kind {
	case "folder":
		for i := range doc.Items {
			if doc.Items[i].ID != id {
				continue
			}
			doc.Items[i].Icon = normalizedIcon
			doc.Items[i].UpdatedAtMS = now
			doc.Items[i].UpdatedAt = nowString
			if err := svc.writeFolders(doc); err != nil {
				return foldersDoc{}, err
			}
			return svc.readFolders()
		}
	case "container":
		for i := range doc.Containers {
			if doc.Containers[i].ID != id {
				continue
			}
			doc.Containers[i].Icon = normalizedIcon
			doc.Containers[i].UpdatedAtMS = now
			doc.Containers[i].UpdatedAt = nowString
			if err := svc.writeFolders(doc); err != nil {
				return foldersDoc{}, err
			}
			return svc.readFolders()
		}
	}
	return foldersDoc{}, fmt.Errorf("desktop entry not found: %s:%s", kind, id)
}

func (svc *service) saveDesktopWallpaper(wallpaper *desktopWallpaper) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	normalized, err := validateDesktopWallpaper(wallpaper)
	if err != nil {
		return foldersDoc{}, err
	}
	doc.Desktop.Wallpaper = normalized
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) importAsset(kind string, sourcePath string) (desktopAsset, error) {
	kind = strings.TrimSpace(kind)
	assetSubdir := ""
	maxAssetBytes := int64(maxIconAssetBytes)
	switch kind {
	case "icon":
		assetSubdir = iconAssetsDir
	case "wallpaper":
		assetSubdir = wallpaperAssetsDir
		maxAssetBytes = maxWallpaperAssetBytes
	default:
		return desktopAsset{}, errors.New("asset kind must be icon or wallpaper")
	}

	sourcePath = strings.TrimSpace(sourcePath)
	if sourcePath == "" {
		return desktopAsset{}, errors.New("asset source path is required")
	}
	ext := strings.ToLower(filepath.Ext(sourcePath))
	if !isSupportedImageExt(ext) {
		return desktopAsset{}, errors.New("asset must be a png, jpg, jpeg, webp, or gif image")
	}
	file, err := os.Open(sourcePath)
	if err != nil {
		return desktopAsset{}, fmt.Errorf("open asset source failed: %w", err)
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return desktopAsset{}, fmt.Errorf("stat asset source failed: %w", err)
	}
	if stat.Size() <= 0 {
		return desktopAsset{}, errors.New("asset file is empty")
	}
	if stat.Size() > maxAssetBytes {
		return desktopAsset{}, fmt.Errorf("%s asset file is too large: max %d bytes", kind, maxAssetBytes)
	}
	if err := validateAssetImageContent(file, ext); err != nil {
		return desktopAsset{}, err
	}

	hasher := sha1.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return desktopAsset{}, fmt.Errorf("hash asset source failed: %w", err)
	}
	assetName := hex.EncodeToString(hasher.Sum(nil)) + ext
	assetID := filepath.ToSlash(filepath.Join(assetSubdir, assetName))
	targetPath := filepath.Join(svc.dataDir, assetsDir, assetSubdir, assetName)
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return desktopAsset{}, err
	}
	if _, err := os.Stat(targetPath); errors.Is(err, os.ErrNotExist) {
		if _, err := file.Seek(0, 0); err != nil {
			return desktopAsset{}, fmt.Errorf("rewind asset source failed: %w", err)
		}
		out, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return desktopAsset{}, fmt.Errorf("create asset target failed: %w", err)
		}
		_, copyErr := io.Copy(out, file)
		closeErr := out.Close()
		if copyErr != nil {
			_ = os.Remove(targetPath)
			return desktopAsset{}, fmt.Errorf("copy asset target failed: %w", copyErr)
		}
		if closeErr != nil {
			_ = os.Remove(targetPath)
			return desktopAsset{}, fmt.Errorf("close asset target failed: %w", closeErr)
		}
	} else if err != nil {
		return desktopAsset{}, err
	}
	return desktopAsset{ID: assetID, Kind: kind}, nil
}

func (svc *service) serveAsset(w http.ResponseWriter, r *http.Request) {
	assetID := strings.TrimPrefix(r.URL.Path, "/assets/")
	path, err := svc.assetPath(assetID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, path)
}

func (svc *service) assetPath(assetID string) (string, error) {
	assetID = strings.TrimSpace(filepath.ToSlash(assetID))
	if !isSafeAssetID(assetID) {
		return "", errors.New("invalid asset id")
	}
	return filepath.Join(svc.dataDir, assetsDir, filepath.FromSlash(assetID)), nil
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

func defaultFoldersDoc() foldersDoc {
	return foldersDoc{
		SchemaVersion: dataSchemaVersion,
		DataVersion:   dataVersion,
		Groups:        []folderGroup{{ID: defaultGroupID, Name: "默认"}},
		Items:         []folderItem{},
		Containers:    []desktopContainer{},
		Desktop:       desktopState{},
		UpdatedAt:     nowText(),
	}
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

	containers := make([]desktopContainer, 0, len(doc.Containers))
	containerIDs := map[string]bool{}
	for _, raw := range doc.Containers {
		container, err := normalizeDesktopContainer(raw, false)
		if err != nil || containerIDs[container.ID] {
			continue
		}
		containers = append(containers, container)
		containerIDs[container.ID] = true
	}

	items := make([]folderItem, 0, len(doc.Items))
	itemIDs := map[string]bool{}
	for _, raw := range doc.Items {
		item, err := normalizeFolderItem(raw, groups, false)
		if err != nil || itemIDs[item.ID] {
			continue
		}
		if item.ContainerID != "" && !containerIDs[item.ContainerID] {
			item.ContainerID = ""
		}
		items = append(items, item)
		itemIDs[item.ID] = true
	}
	desktop := normalizeDesktopState(doc.Desktop)
	return foldersDoc{
		SchemaVersion: dataSchemaVersion,
		DataVersion:   dataVersion,
		Groups:        groups,
		Items:         items,
		Containers:    containers,
		Desktop:       desktop,
		UpdatedAt:     firstNonEmpty(doc.UpdatedAt, nowText()),
	}
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
	var itemLayout *folderGridLayout
	if raw.Layout != nil {
		normalizedLayout := normalizeGridLayout(*raw.Layout)
		itemLayout = &normalizedLayout
	}
	icon, err := validateDesktopIcon(raw.Icon)
	if err != nil {
		return folderItem{}, err
	}
	return folderItem{ID: id, Name: name, Path: path, GroupID: groupID, ContainerID: strings.TrimSpace(raw.ContainerID), CreatedAt: createdAtText, UpdatedAt: updatedAtText, CreatedAtMS: createdAt, UpdatedAtMS: updatedAt, Layout: itemLayout, Icon: icon}, nil
}

func normalizeDesktopContainer(raw desktopContainer, allowNewID bool) (desktopContainer, error) {
	now := time.Now().UnixMilli()
	nowString := nowText()
	id := strings.TrimSpace(raw.ID)
	if id == "" && allowNewID {
		id = fmt.Sprintf("container-%d", now)
	}
	if id == "" {
		return desktopContainer{}, errors.New("container id is required")
	}
	name := trimMax(raw.Name, 80)
	if name == "" {
		return desktopContainer{}, errors.New("container name is required")
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
	var layout *folderGridLayout
	if raw.Layout != nil {
		normalizedLayout := normalizeGridLayout(*raw.Layout)
		layout = &normalizedLayout
	}
	icon, err := validateDesktopIcon(raw.Icon)
	if err != nil {
		return desktopContainer{}, err
	}
	return desktopContainer{ID: id, Name: name, CreatedAt: createdAtText, UpdatedAt: updatedAtText, CreatedAtMS: createdAt, UpdatedAtMS: updatedAt, Layout: layout, Icon: icon}, nil
}

func normalizeDesktopState(raw desktopState) desktopState {
	wallpaper, err := validateDesktopWallpaper(raw.Wallpaper)
	if err != nil {
		wallpaper = nil
	}
	return desktopState{Wallpaper: wallpaper}
}

func validateDesktopWallpaper(raw *desktopWallpaper) (*desktopWallpaper, error) {
	if raw == nil {
		return nil, nil
	}
	assetID := strings.TrimSpace(filepath.ToSlash(raw.AssetID))
	if !isSafeAssetID(assetID) || !strings.HasPrefix(assetID, wallpaperAssetsDir+"/") {
		return nil, errors.New("valid wallpaper asset id is required")
	}
	return &desktopWallpaper{AssetID: assetID}, nil
}

func validateDesktopIcon(raw *desktopIcon) (*desktopIcon, error) {
	if raw == nil {
		return nil, nil
	}
	kind := strings.TrimSpace(raw.Kind)
	if kind == "" {
		kind = "color"
	}
	switch kind {
	case "color":
		color := strings.ToUpper(strings.TrimSpace(raw.Color))
		if !isSupportedIconColor(color) {
			return nil, fmt.Errorf("unsupported icon color: %s", raw.Color)
		}
		return &desktopIcon{Kind: "color", Color: color}, nil
	case "image":
		assetID := strings.TrimSpace(filepath.ToSlash(raw.AssetID))
		if !isSafeAssetID(assetID) || !strings.HasPrefix(assetID, iconAssetsDir+"/") {
			return nil, errors.New("valid icon asset id is required")
		}
		return &desktopIcon{Kind: "image", AssetID: assetID}, nil
	default:
		return nil, fmt.Errorf("unsupported icon kind: %s", kind)
	}
}

func normalizeDesktopEntryKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "folder":
		return "folder"
	case "container":
		return "container"
	default:
		return ""
	}
}

func normalizeGridLayout(raw folderGridLayout) folderGridLayout {
	x := raw.X
	y := raw.Y
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	if x > maxLayoutCoord {
		x = maxLayoutCoord
	}
	if y > maxLayoutCoord {
		y = maxLayoutCoord
	}
	return folderGridLayout{X: x, Y: y}
}

func hasGroup(groups []folderGroup, id string) bool {
	for _, group := range groups {
		if group.ID == id {
			return true
		}
	}
	return false
}

func hasContainer(containers []desktopContainer, id string) bool {
	for _, container := range containers {
		if container.ID == id {
			return true
		}
	}
	return false
}

func isSupportedIconColor(color string) bool {
	switch strings.ToUpper(strings.TrimSpace(color)) {
	case "#8FA99B", "#8FA6B8", "#A79AB4", "#B7A38C", "#A9A18E", "#9AA38F", "#A08F8F", "#8F9FA3":
		return true
	default:
		return false
	}
}

func isSupportedImageExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		return true
	default:
		return false
	}
}

func validateAssetImageContent(file *os.File, ext string) error {
	if _, err := file.Seek(0, 0); err != nil {
		return fmt.Errorf("rewind asset source failed: %w", err)
	}
	if ext == ".webp" {
		header := make([]byte, 12)
		n, err := io.ReadFull(file, header)
		if err != nil || n != len(header) || string(header[:4]) != "RIFF" || string(header[8:12]) != "WEBP" {
			return errors.New("asset content is not a supported image")
		}
		_, err = file.Seek(0, 0)
		return err
	}
	if _, _, err := image.DecodeConfig(file); err != nil {
		return errors.New("asset content is not a supported image")
	}
	if _, err := file.Seek(0, 0); err != nil {
		return fmt.Errorf("rewind asset source failed: %w", err)
	}
	return nil
}

func isSafeAssetID(assetID string) bool {
	assetID = strings.TrimSpace(filepath.ToSlash(assetID))
	if assetID == "" || strings.Contains(assetID, "..") || strings.HasPrefix(assetID, "/") {
		return false
	}
	parts := strings.Split(assetID, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	if parts[0] != iconAssetsDir && parts[0] != wallpaperAssetsDir {
		return false
	}
	ext := strings.ToLower(filepath.Ext(parts[1]))
	if !isSupportedImageExt(ext) {
		return false
	}
	name := strings.TrimSuffix(parts[1], ext)
	if len(name) != 40 {
		return false
	}
	for _, ch := range name {
		if !((ch >= 'a' && ch <= 'f') || (ch >= '0' && ch <= '9')) {
			return false
		}
	}
	return true
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
