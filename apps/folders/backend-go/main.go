package main

import (
	"bytes"
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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	dataSchemaVersion      = 1
	dataVersion            = 3
	dataFile               = "data.json"
	metaFile               = "_meta.json"
	assetsDir              = "assets"
	iconAssetsDir          = "icons"
	wallpaperAssetsDir     = "wallpapers"
	defaultGroupID         = "default"
	maxLayoutCoord         = 2000
	maxIconAssetBytes      = 12 * 1024 * 1024
	defaultDesktopIconGap  = 38
	minDesktopIconGap      = 0
	maxDesktopIconGap      = 64
	minDesktopIconScale    = 0.75
	maxDesktopIconScale    = 1.35
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
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Path            string            `json:"path"`
	GroupID         string            `json:"groupId"`
	PageOrder       int64             `json:"pageOrder"`
	ContainerID     string            `json:"containerId,omitempty"`
	CreatedAt       string            `json:"createdAt"`
	UpdatedAt       string            `json:"updatedAt"`
	CreatedAtMS     int64             `json:"createdAtMs"`
	UpdatedAtMS     int64             `json:"updatedAtMs"`
	Layout          *folderGridLayout `json:"layout,omitempty"`
	ContainerLayout *folderGridLayout `json:"containerLayout,omitempty"`
	Icon            *desktopIcon      `json:"icon,omitempty"`
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

type desktopLayoutSavePayload struct {
	GroupID string               `json:"groupId"`
	Items   []desktopLayoutPatch `json:"items"`
}

type folderGroupTransferPayload struct {
	ID      string `json:"id"`
	GroupID string `json:"groupId"`
}

type containerLayoutPatch struct {
	ID     string           `json:"id"`
	Layout folderGridLayout `json:"layout"`
}

type containerItemsPlacement struct {
	ContainerID string                 `json:"containerId"`
	MovedID     string                 `json:"movedId,omitempty"`
	Items       []containerLayoutPatch `json:"items"`
}

type createContainerFromItemsPayload struct {
	SourceItemID string           `json:"sourceItemId"`
	TargetItemID string           `json:"targetItemId"`
	Layout       folderGridLayout `json:"layout"`
}

type extractContainerItemToDesktopPayload struct {
	ContainerID string               `json:"containerId"`
	ItemID      string               `json:"itemId"`
	Items       []desktopLayoutPatch `json:"items"`
}

type desktopIcon struct {
	Kind    string `json:"kind"`
	Color   string `json:"color,omitempty"`
	AssetID string `json:"assetId,omitempty"`
}

type desktopContainer struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	GroupID     string            `json:"groupId"`
	PageOrder   int64             `json:"pageOrder"`
	CreatedAt   string            `json:"createdAt"`
	UpdatedAt   string            `json:"updatedAt"`
	CreatedAtMS int64             `json:"createdAtMs"`
	UpdatedAtMS int64             `json:"updatedAtMs"`
	Layout      *folderGridLayout `json:"layout,omitempty"`
}

type desktopWallpaper struct {
	AssetID string `json:"assetId"`
}

type desktopIconLayout struct {
	RowGap    int     `json:"rowGap"`
	ColumnGap int     `json:"columnGap"`
	IconScale float64 `json:"iconScale"`
}

type desktopIconLayoutInput struct {
	RowGap    *int     `json:"rowGap"`
	ColumnGap *int     `json:"columnGap"`
	IconScale *float64 `json:"iconScale"`
}

type desktopState struct {
	Wallpaper  *desktopWallpaper `json:"wallpaper,omitempty"`
	IconLayout desktopIconLayout `json:"iconLayout"`
}

type desktopStateInput struct {
	Wallpaper  *desktopWallpaper       `json:"wallpaper,omitempty"`
	IconLayout *desktopIconLayoutInput `json:"iconLayout"`
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

type foldersDocInput struct {
	SchemaVersion *int                `json:"schemaVersion"`
	DataVersion   *int                `json:"dataVersion"`
	Groups        *[]folderGroup      `json:"groups"`
	Items         *[]folderItem       `json:"items"`
	Containers    *[]desktopContainer `json:"containers"`
	Desktop       *desktopStateInput  `json:"desktop"`
	UpdatedAt     *string             `json:"updatedAt"`
}

type foldersDataHealth struct {
	OK            bool   `json:"ok"`
	Error         string `json:"error,omitempty"`
	SchemaVersion int    `json:"schemaVersion,omitempty"`
	DataVersion   int    `json:"dataVersion,omitempty"`
}

type foldersHealth struct {
	OK      bool              `json:"ok"`
	DataDir string            `json:"dataDir"`
	Time    string            `json:"time"`
	Data    foldersDataHealth `json:"data"`
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
		return svc.health(), nil
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
	case "folders.data.reset":
		return svc.resetFoldersData()
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
	case "folders.folder.move-to-group":
		var payload folderGroupTransferPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid folder group move payload: %w", err)
		}
		return svc.moveFolderToGroup(payload)
	case "folders.folder.copy-to-group":
		var payload folderGroupTransferPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid folder group copy payload: %w", err)
		}
		return svc.copyFolderToGroup(payload)
	case "folders.desktop.layout.save":
		var payload desktopLayoutSavePayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid desktop layout payload: %w", err)
		}
		return svc.saveDesktopLayouts(payload)
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
	case "folders.containers.create-from-items":
		var payload createContainerFromItemsPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid create container payload: %w", err)
		}
		return svc.createContainerFromItems(payload)
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
	case "folders.container.items.place":
		var payload containerItemsPlacement
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container placement payload: %w", err)
		}
		return svc.placeContainerItems(payload)
	case "folders.container.item.extract-to-desktop":
		var payload extractContainerItemToDesktopPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container extraction payload: %w", err)
		}
		return svc.extractContainerItemToDesktop(payload)
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
	case "folders.desktop.icon-layout.save":
		var payload struct {
			IconLayout desktopIconLayout `json:"iconLayout"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid desktop icon layout payload: %w", err)
		}
		return svc.saveDesktopIconLayout(payload.IconLayout)
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
	if err := svc.writeMeta(); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(svc.dataDir, dataFile)); errors.Is(err, os.ErrNotExist) {
		return svc.writeFolders(defaultFoldersDoc())
	} else if err != nil {
		return err
	}
	return nil
}

func (svc *service) writeMeta() error {
	return writeJSON(filepath.Join(svc.dataDir, metaFile), metaDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, UpdatedAt: nowText()})
}

func (svc *service) readFolders() (foldersDoc, error) {
	bytes, err := os.ReadFile(filepath.Join(svc.dataDir, dataFile))
	if err != nil {
		return foldersDoc{}, err
	}
	return decodeCurrentFoldersDoc(bytes)
}

func (svc *service) writeFolders(doc foldersDoc) error {
	normalized, err := normalizeFoldersDoc(doc)
	if err != nil {
		return err
	}
	doc = normalized
	doc.UpdatedAt = nowText()
	return writeJSON(filepath.Join(svc.dataDir, dataFile), doc)
}

func (svc *service) saveFoldersData(payload foldersDoc) (foldersDoc, error) {
	doc, err := normalizeFoldersDoc(payload)
	if err != nil {
		return foldersDoc{}, err
	}
	if len(doc.Groups) == 0 || doc.Groups[0].ID != defaultGroupID {
		return foldersDoc{}, errors.New("default group is required")
	}
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) resetFoldersData() (foldersDoc, error) {
	if err := svc.writeFolders(defaultFoldersDoc()); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) health() foldersHealth {
	health := foldersHealth{OK: true, DataDir: svc.dataDir, Time: nowText(), Data: foldersDataHealth{OK: true}}
	doc, err := svc.readFolders()
	if err != nil {
		health.Data.OK = false
		health.Data.Error = err.Error()
		return health
	}
	health.Data.SchemaVersion = doc.SchemaVersion
	health.Data.DataVersion = doc.DataVersion
	return health
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
	item.PageOrder = nextPageOrder(doc, item.GroupID)
	doc.Items = append(doc.Items, item)
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
			if item.GroupID == doc.Items[i].GroupID {
				item.PageOrder = doc.Items[i].PageOrder
				item.ContainerID = doc.Items[i].ContainerID
				if item.Layout == nil {
					item.Layout = doc.Items[i].Layout
				}
				if item.ContainerLayout == nil {
					item.ContainerLayout = doc.Items[i].ContainerLayout
				}
			} else {
				item.PageOrder = nextPageOrder(doc, item.GroupID)
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

func (svc *service) moveFolderToGroup(payload folderGroupTransferPayload) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		return foldersDoc{}, errors.New("folder id is required")
	}
	targetGroupID, err := normalizeGroupID(payload.GroupID, doc.Groups)
	if err != nil {
		return foldersDoc{}, err
	}
	for i := range doc.Items {
		if doc.Items[i].ID != id {
			continue
		}
		if doc.Items[i].GroupID == targetGroupID {
			return doc, nil
		}
		now := time.Now().UnixMilli()
		nowString := nowText()
		doc.Items[i].GroupID = targetGroupID
		doc.Items[i].PageOrder = nextPageOrder(doc, targetGroupID)
		doc.Items[i].ContainerID = ""
		doc.Items[i].ContainerLayout = nil
		doc.Items[i].Layout = nil
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		if err := svc.writeFolders(doc); err != nil {
			return foldersDoc{}, err
		}
		return svc.readFolders()
	}
	return foldersDoc{}, fmt.Errorf("folder not found: %s", id)
}

func (svc *service) copyFolderToGroup(payload folderGroupTransferPayload) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		return foldersDoc{}, errors.New("folder id is required")
	}
	targetGroupID, err := normalizeGroupID(payload.GroupID, doc.Groups)
	if err != nil {
		return foldersDoc{}, err
	}
	for _, item := range doc.Items {
		if item.ID != id {
			continue
		}
		if item.GroupID == targetGroupID {
			return foldersDoc{}, errors.New("target group must be different")
		}
		now := time.Now().UnixMilli()
		nowString := nowText()
		copy := item
		copy.ID = uniqueFolderID(doc.Items, now)
		copy.GroupID = targetGroupID
		copy.PageOrder = nextPageOrder(doc, targetGroupID)
		copy.ContainerID = ""
		copy.ContainerLayout = nil
		copy.Layout = nil
		copy.CreatedAtMS = now
		copy.UpdatedAtMS = now
		copy.CreatedAt = nowString
		copy.UpdatedAt = nowString
		doc.Items = append(doc.Items, copy)
		if err := svc.writeFolders(doc); err != nil {
			return foldersDoc{}, err
		}
		return svc.readFolders()
	}
	return foldersDoc{}, fmt.Errorf("folder not found: %s", id)
}

func (svc *service) saveDesktopLayouts(payload desktopLayoutSavePayload) (foldersDoc, error) {
	if len(payload.Items) == 0 {
		return svc.readFolders()
	}
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	groupID, err := normalizeGroupID(payload.GroupID, doc.Groups)
	if err != nil {
		return foldersDoc{}, err
	}

	type layoutUpdate struct {
		kind   string
		id     string
		layout folderGridLayout
	}
	updates := make([]layoutUpdate, 0, len(payload.Items))
	for _, patch := range payload.Items {
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
				if doc.Items[i].ID != update.id || doc.Items[i].GroupID != groupID || doc.Items[i].ContainerID != "" {
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
				if doc.Containers[i].ID != update.id || doc.Containers[i].GroupID != groupID {
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
	renumberPageOrder(&doc, groupID)

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
	container, err := normalizeDesktopContainer(payload, doc.Groups, true)
	if err != nil {
		return foldersDoc{}, err
	}
	for _, current := range doc.Containers {
		if current.ID == container.ID {
			return foldersDoc{}, fmt.Errorf("container already exists: %s", container.ID)
		}
	}
	container.PageOrder = nextPageOrder(doc, container.GroupID)
	doc.Containers = append(doc.Containers, container)
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) createContainerFromItems(payload createContainerFromItemsPayload) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	sourceItemID := strings.TrimSpace(payload.SourceItemID)
	targetItemID := strings.TrimSpace(payload.TargetItemID)
	if sourceItemID == "" || targetItemID == "" {
		return foldersDoc{}, errors.New("source and target folder ids are required")
	}
	if sourceItemID == targetItemID {
		return foldersDoc{}, errors.New("source and target folder ids must be different")
	}

	sourceIndex := -1
	targetIndex := -1
	for i := range doc.Items {
		switch doc.Items[i].ID {
		case sourceItemID:
			sourceIndex = i
		case targetItemID:
			targetIndex = i
		}
	}
	if sourceIndex < 0 {
		return foldersDoc{}, fmt.Errorf("folder not found: %s", sourceItemID)
	}
	if targetIndex < 0 {
		return foldersDoc{}, fmt.Errorf("folder not found: %s", targetItemID)
	}
	if doc.Items[targetIndex].ContainerID != "" {
		return foldersDoc{}, errors.New("target folder must be on desktop")
	}
	if doc.Items[sourceIndex].GroupID != doc.Items[targetIndex].GroupID {
		return foldersDoc{}, errors.New("source and target folders must be in the same group")
	}

	now := time.Now().UnixMilli()
	nowString := nowText()
	layout := normalizeGridLayout(payload.Layout)
	containerID := uniqueContainerID(doc.Containers, now)
	containerLayout := layout
	containerGroupID := doc.Items[targetIndex].GroupID
	doc.Containers = append([]desktopContainer{{
		ID:          containerID,
		Name:        nextContainerName(doc.Containers),
		GroupID:     containerGroupID,
		PageOrder:   nextPageOrder(doc, containerGroupID),
		CreatedAt:   nowString,
		UpdatedAt:   nowString,
		CreatedAtMS: now,
		UpdatedAtMS: now,
		Layout:      &containerLayout,
	}}, doc.Containers...)

	for i := range doc.Items {
		if doc.Items[i].ID != targetItemID && doc.Items[i].ID != sourceItemID {
			continue
		}
		doc.Items[i].ContainerID = containerID
		doc.Items[i].Layout = nil
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		layoutCopy := folderGridLayout{X: 0, Y: 0}
		if doc.Items[i].ID == sourceItemID {
			layoutCopy = folderGridLayout{X: 1, Y: 0}
		}
		doc.Items[i].ContainerLayout = &layoutCopy
	}

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
	container, err := normalizeDesktopContainer(payload, doc.Groups, false)
	if err != nil {
		return foldersDoc{}, err
	}
	for i := range doc.Containers {
		if doc.Containers[i].ID != container.ID {
			continue
		}
		container.CreatedAt = doc.Containers[i].CreatedAt
		container.CreatedAtMS = doc.Containers[i].CreatedAtMS
		container.GroupID = doc.Containers[i].GroupID
		container.PageOrder = doc.Containers[i].PageOrder
		if container.Layout == nil {
			container.Layout = doc.Containers[i].Layout
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
			doc.Items[i].ContainerLayout = nil
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
	targetGroupID := ""
	if containerID != "" {
		container, ok := findContainer(doc.Containers, containerID)
		if !ok {
			return foldersDoc{}, fmt.Errorf("container not found: %s", containerID)
		}
		targetGroupID = container.GroupID
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
		if targetGroupID != "" && doc.Items[i].GroupID != targetGroupID {
			return foldersDoc{}, fmt.Errorf("folder group mismatch for container %s: %s", containerID, doc.Items[i].ID)
		}
		if doc.Items[i].ContainerID != containerID {
			doc.Items[i].ContainerLayout = nil
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

func (svc *service) placeContainerItems(payload containerItemsPlacement) (foldersDoc, error) {
	containerID := strings.TrimSpace(payload.ContainerID)
	movedID := strings.TrimSpace(payload.MovedID)
	if containerID == "" {
		return foldersDoc{}, errors.New("container id is required")
	}
	if len(payload.Items) == 0 {
		if movedID == "" {
			return svc.readFolders()
		}
		return foldersDoc{}, errors.New("moved folder layout is required")
	}

	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	container, ok := findContainer(doc.Containers, containerID)
	if !ok {
		return foldersDoc{}, fmt.Errorf("container not found: %s", containerID)
	}

	placements := make(map[string]folderGridLayout, len(payload.Items))
	for _, item := range payload.Items {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			return foldersDoc{}, errors.New("folder id is required")
		}
		if _, exists := placements[id]; exists {
			return foldersDoc{}, fmt.Errorf("duplicate folder placement: %s", id)
		}
		placements[id] = normalizeGridLayout(item.Layout)
	}
	if movedID != "" {
		if _, exists := placements[movedID]; !exists {
			return foldersDoc{}, errors.New("moved folder layout is required")
		}
	}

	now := time.Now().UnixMilli()
	nowString := nowText()
	found := make(map[string]bool, len(placements))
	movedFound := movedID == ""
	for i := range doc.Items {
		id := doc.Items[i].ID
		if id == movedID {
			if doc.Items[i].GroupID != container.GroupID {
				return foldersDoc{}, fmt.Errorf("folder group mismatch for container %s: %s", containerID, id)
			}
			doc.Items[i].ContainerID = containerID
			movedFound = true
		}
		layout, shouldPlace := placements[id]
		if !shouldPlace {
			continue
		}
		if doc.Items[i].ContainerID != containerID {
			return foldersDoc{}, fmt.Errorf("folder is not in container %s: %s", containerID, id)
		}
		if doc.Items[i].GroupID != container.GroupID {
			return foldersDoc{}, fmt.Errorf("folder group mismatch for container %s: %s", containerID, id)
		}
		layoutCopy := layout
		doc.Items[i].ContainerLayout = &layoutCopy
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		found[id] = true
	}
	if !movedFound {
		return foldersDoc{}, fmt.Errorf("folder not found: %s", movedID)
	}
	for id := range placements {
		if !found[id] {
			return foldersDoc{}, fmt.Errorf("folder not found: %s", id)
		}
	}

	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) extractContainerItemToDesktop(payload extractContainerItemToDesktopPayload) (foldersDoc, error) {
	containerID := strings.TrimSpace(payload.ContainerID)
	itemID := strings.TrimSpace(payload.ItemID)
	if containerID == "" {
		return foldersDoc{}, errors.New("container id is required")
	}
	if itemID == "" {
		return foldersDoc{}, errors.New("folder id is required")
	}
	if len(payload.Items) == 0 {
		return foldersDoc{}, errors.New("desktop layout patches are required")
	}

	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	container, ok := findContainer(doc.Containers, containerID)
	if !ok {
		return foldersDoc{}, fmt.Errorf("container not found: %s", containerID)
	}

	updates := make(map[string]desktopLayoutPatch, len(payload.Items))
	for _, patch := range payload.Items {
		kind := normalizeDesktopEntryKind(patch.Kind)
		id := strings.TrimSpace(patch.ID)
		if kind == "" || id == "" {
			return foldersDoc{}, errors.New("desktop layout kind and id are required")
		}
		key := kind + ":" + id
		if _, exists := updates[key]; exists {
			return foldersDoc{}, fmt.Errorf("duplicate desktop layout patch: %s", key)
		}
		updates[key] = desktopLayoutPatch{Kind: kind, ID: id, Layout: normalizeGridLayout(patch.Layout)}
	}
	itemPatch, ok := updates["folder:"+itemID]
	if !ok {
		return foldersDoc{}, errors.New("moved folder desktop layout is required")
	}

	found := map[string]bool{}
	movedFound := false
	now := time.Now().UnixMilli()
	nowString := nowText()
	for i := range doc.Items {
		key := "folder:" + doc.Items[i].ID
		patch, shouldUpdate := updates[key]
		if doc.Items[i].ID == itemID {
			if doc.Items[i].ContainerID != containerID {
				return foldersDoc{}, fmt.Errorf("folder is not in container %s: %s", containerID, itemID)
			}
			if doc.Items[i].GroupID != container.GroupID {
				return foldersDoc{}, fmt.Errorf("folder group mismatch for container %s: %s", containerID, itemID)
			}
			doc.Items[i].ContainerID = ""
			doc.Items[i].ContainerLayout = nil
			doc.Items[i].Layout = layoutPtr(itemPatch.Layout)
			doc.Items[i].UpdatedAtMS = now
			doc.Items[i].UpdatedAt = nowString
			found[key] = true
			movedFound = true
			continue
		}
		if !shouldUpdate {
			continue
		}
		if doc.Items[i].ContainerID != "" {
			return foldersDoc{}, fmt.Errorf("folder is not on desktop: %s", doc.Items[i].ID)
		}
		doc.Items[i].Layout = layoutPtr(patch.Layout)
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		found[key] = true
	}
	if !movedFound {
		return foldersDoc{}, fmt.Errorf("folder not found: %s", itemID)
	}

	for i := range doc.Containers {
		key := "container:" + doc.Containers[i].ID
		patch, shouldUpdate := updates[key]
		if !shouldUpdate {
			continue
		}
		doc.Containers[i].Layout = layoutPtr(patch.Layout)
		doc.Containers[i].UpdatedAtMS = now
		doc.Containers[i].UpdatedAt = nowString
		found[key] = true
	}
	for key := range updates {
		if !found[key] {
			return foldersDoc{}, fmt.Errorf("desktop entry not found: %s", key)
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
	if kind != "folder" {
		return foldersDoc{}, errors.New("only folder icons can be customized")
	}
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

func (svc *service) saveDesktopIconLayout(iconLayout desktopIconLayout) (foldersDoc, error) {
	doc, err := svc.readFolders()
	if err != nil {
		return foldersDoc{}, err
	}
	normalized, err := normalizeDesktopIconLayout(iconLayout)
	if err != nil {
		return foldersDoc{}, err
	}
	doc.Desktop.IconLayout = normalized
	if err := svc.writeFolders(doc); err != nil {
		return foldersDoc{}, err
	}
	return svc.readFolders()
}

func (svc *service) importAsset(kind string, sourcePath string) (desktopAsset, error) {
	kind = strings.TrimSpace(kind)
	assetSubdir := ""
	var maxAssetBytes int64
	switch kind {
	case "icon":
		assetSubdir = iconAssetsDir
		maxAssetBytes = maxIconAssetBytes
	case "wallpaper":
		assetSubdir = wallpaperAssetsDir
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
	if maxAssetBytes > 0 && stat.Size() > maxAssetBytes {
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
	nextOrder := nextPageOrder(doc, defaultGroupID)
	now := time.Now().UnixMilli()
	nowString := nowText()
	for i := range doc.Items {
		if doc.Items[i].GroupID == id {
			doc.Items[i].GroupID = defaultGroupID
			doc.Items[i].PageOrder = nextOrder
			doc.Items[i].ContainerID = ""
			doc.Items[i].ContainerLayout = nil
			doc.Items[i].Layout = nil
			doc.Items[i].UpdatedAtMS = now
			doc.Items[i].UpdatedAt = nowString
			nextOrder++
		}
	}
	for i := range doc.Containers {
		if doc.Containers[i].GroupID == id {
			doc.Containers[i].GroupID = defaultGroupID
			doc.Containers[i].PageOrder = nextOrder
			doc.Containers[i].Layout = nil
			doc.Containers[i].UpdatedAtMS = now
			doc.Containers[i].UpdatedAt = nowString
			nextOrder++
		}
	}
	doc.Groups = nextGroups
	renumberPageOrder(&doc, defaultGroupID)
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
		Desktop:       desktopState{IconLayout: defaultDesktopIconLayout()},
		UpdatedAt:     nowText(),
	}
}

func decodeCurrentFoldersDoc(payload []byte) (foldersDoc, error) {
	if len(bytes.TrimSpace(payload)) == 0 {
		return foldersDoc{}, errors.New("folders data file is empty")
	}
	var input foldersDocInput
	if err := json.Unmarshal(payload, &input); err != nil {
		return foldersDoc{}, fmt.Errorf("parse folders data failed: %w", err)
	}
	if input.SchemaVersion == nil {
		return foldersDoc{}, errors.New("folders data schemaVersion is required")
	}
	if *input.SchemaVersion != dataSchemaVersion {
		return foldersDoc{}, fmt.Errorf("folders data schemaVersion %d is not supported; expected %d", *input.SchemaVersion, dataSchemaVersion)
	}
	if input.DataVersion == nil {
		return foldersDoc{}, errors.New("folders data dataVersion is required")
	}
	if *input.DataVersion != dataVersion {
		return foldersDoc{}, fmt.Errorf("folders dataVersion %d is not supported in this development baseline; reset data or export it before switching versions", *input.DataVersion)
	}
	if input.Groups == nil {
		return foldersDoc{}, errors.New("folders data groups is required")
	}
	if input.Items == nil {
		return foldersDoc{}, errors.New("folders data items is required")
	}
	if input.Containers == nil {
		return foldersDoc{}, errors.New("folders data containers is required")
	}
	if input.Desktop == nil {
		return foldersDoc{}, errors.New("folders data desktop is required")
	}
	if input.Desktop.IconLayout == nil {
		return foldersDoc{}, errors.New("folders data desktop.iconLayout is required")
	}
	iconLayout, err := decodeDesktopIconLayout(*input.Desktop.IconLayout)
	if err != nil {
		return foldersDoc{}, err
	}
	updatedAt := ""
	if input.UpdatedAt != nil {
		updatedAt = *input.UpdatedAt
	}
	doc := foldersDoc{
		SchemaVersion: *input.SchemaVersion,
		DataVersion:   *input.DataVersion,
		Groups:        *input.Groups,
		Items:         *input.Items,
		Containers:    *input.Containers,
		Desktop:       desktopState{Wallpaper: input.Desktop.Wallpaper, IconLayout: iconLayout},
		UpdatedAt:     updatedAt,
	}
	return normalizeFoldersDoc(doc)
}

func decodeDesktopIconLayout(input desktopIconLayoutInput) (desktopIconLayout, error) {
	if input.RowGap == nil {
		return desktopIconLayout{}, errors.New("folders data desktop.iconLayout.rowGap is required")
	}
	if input.ColumnGap == nil {
		return desktopIconLayout{}, errors.New("folders data desktop.iconLayout.columnGap is required")
	}
	if input.IconScale == nil {
		return desktopIconLayout{}, errors.New("folders data desktop.iconLayout.iconScale is required")
	}
	return normalizeDesktopIconLayout(desktopIconLayout{RowGap: *input.RowGap, ColumnGap: *input.ColumnGap, IconScale: *input.IconScale})
}

func normalizeFoldersDoc(doc foldersDoc) (foldersDoc, error) {
	if len(doc.Groups) == 0 {
		return foldersDoc{}, errors.New("default group is required")
	}
	groups := make([]folderGroup, 0, len(doc.Groups))
	seen := map[string]bool{}
	for i, group := range doc.Groups {
		normalized, err := normalizeGroup(group, false)
		if err != nil {
			return foldersDoc{}, fmt.Errorf("groups[%d]: %w", i, err)
		}
		if i == 0 && normalized.ID != defaultGroupID {
			return foldersDoc{}, errors.New("default group must be first")
		}
		if seen[normalized.ID] {
			return foldersDoc{}, fmt.Errorf("duplicate group id: %s", normalized.ID)
		}
		groups = append(groups, normalized)
		seen[normalized.ID] = true
	}

	containers := make([]desktopContainer, 0, len(doc.Containers))
	containerIDs := map[string]bool{}
	containerGroupByID := map[string]string{}
	for i, raw := range doc.Containers {
		container, err := normalizeDesktopContainer(raw, groups, false)
		if err != nil {
			return foldersDoc{}, fmt.Errorf("containers[%d]: %w", i, err)
		}
		if containerIDs[container.ID] {
			return foldersDoc{}, fmt.Errorf("duplicate container id: %s", container.ID)
		}
		containers = append(containers, container)
		containerIDs[container.ID] = true
		containerGroupByID[container.ID] = container.GroupID
	}

	items := make([]folderItem, 0, len(doc.Items))
	itemIDs := map[string]bool{}
	for i, raw := range doc.Items {
		item, err := normalizeFolderItem(raw, groups, false)
		if err != nil {
			return foldersDoc{}, fmt.Errorf("items[%d]: %w", i, err)
		}
		if itemIDs[item.ID] {
			return foldersDoc{}, fmt.Errorf("duplicate folder id: %s", item.ID)
		}
		if item.ContainerID != "" && !containerIDs[item.ContainerID] {
			return foldersDoc{}, fmt.Errorf("items[%d]: container not found: %s", i, item.ContainerID)
		}
		if item.ContainerID != "" && containerGroupByID[item.ContainerID] != item.GroupID {
			return foldersDoc{}, fmt.Errorf("items[%d]: container group mismatch: %s", i, item.ContainerID)
		}
		if item.ContainerID == "" && item.ContainerLayout != nil {
			return foldersDoc{}, fmt.Errorf("items[%d]: containerLayout requires containerId", i)
		}
		items = append(items, item)
		itemIDs[item.ID] = true
	}
	desktop, err := normalizeDesktopState(doc.Desktop)
	if err != nil {
		return foldersDoc{}, err
	}
	return foldersDoc{
		SchemaVersion: dataSchemaVersion,
		DataVersion:   dataVersion,
		Groups:        groups,
		Items:         items,
		Containers:    containers,
		Desktop:       desktop,
		UpdatedAt:     firstNonEmpty(doc.UpdatedAt, nowText()),
	}, nil
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
	groupID, err := normalizeGroupID(raw.GroupID, groups)
	if err != nil {
		return folderItem{}, err
	}
	pageOrder := raw.PageOrder
	if pageOrder < 0 {
		return folderItem{}, errors.New("folder pageOrder must be non-negative")
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
		normalizedLayout, err := validateGridLayout(*raw.Layout)
		if err != nil {
			return folderItem{}, err
		}
		itemLayout = &normalizedLayout
	}
	var containerLayout *folderGridLayout
	if raw.ContainerLayout != nil {
		normalizedLayout, err := validateGridLayout(*raw.ContainerLayout)
		if err != nil {
			return folderItem{}, err
		}
		containerLayout = &normalizedLayout
	}
	icon, err := validateDesktopIcon(raw.Icon)
	if err != nil {
		return folderItem{}, err
	}
	return folderItem{ID: id, Name: name, Path: path, GroupID: groupID, PageOrder: pageOrder, ContainerID: strings.TrimSpace(raw.ContainerID), CreatedAt: createdAtText, UpdatedAt: updatedAtText, CreatedAtMS: createdAt, UpdatedAtMS: updatedAt, Layout: itemLayout, ContainerLayout: containerLayout, Icon: icon}, nil
}

func normalizeDesktopContainer(raw desktopContainer, groups []folderGroup, allowNewID bool) (desktopContainer, error) {
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
	groupID, err := normalizeGroupID(raw.GroupID, groups)
	if err != nil {
		return desktopContainer{}, err
	}
	pageOrder := raw.PageOrder
	if pageOrder < 0 {
		return desktopContainer{}, errors.New("container pageOrder must be non-negative")
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
		normalizedLayout, err := validateGridLayout(*raw.Layout)
		if err != nil {
			return desktopContainer{}, err
		}
		layout = &normalizedLayout
	}
	return desktopContainer{ID: id, Name: name, GroupID: groupID, PageOrder: pageOrder, CreatedAt: createdAtText, UpdatedAt: updatedAtText, CreatedAtMS: createdAt, UpdatedAtMS: updatedAt, Layout: layout}, nil
}

func normalizeDesktopState(raw desktopState) (desktopState, error) {
	wallpaper, err := validateDesktopWallpaper(raw.Wallpaper)
	if err != nil {
		return desktopState{}, err
	}
	iconLayout, err := normalizeDesktopIconLayout(raw.IconLayout)
	if err != nil {
		return desktopState{}, err
	}
	return desktopState{Wallpaper: wallpaper, IconLayout: iconLayout}, nil
}

func defaultDesktopIconLayout() desktopIconLayout {
	return desktopIconLayout{RowGap: defaultDesktopIconGap, ColumnGap: defaultDesktopIconGap, IconScale: 1}
}

func normalizeDesktopIconLayout(raw desktopIconLayout) (desktopIconLayout, error) {
	rowGap := raw.RowGap
	if rowGap < minDesktopIconGap || rowGap > maxDesktopIconGap {
		return desktopIconLayout{}, fmt.Errorf("desktop icon row gap must be between %d and %d", minDesktopIconGap, maxDesktopIconGap)
	}
	columnGap := raw.ColumnGap
	if columnGap < minDesktopIconGap || columnGap > maxDesktopIconGap {
		return desktopIconLayout{}, fmt.Errorf("desktop icon column gap must be between %d and %d", minDesktopIconGap, maxDesktopIconGap)
	}
	iconScale := raw.IconScale
	if iconScale < minDesktopIconScale || iconScale > maxDesktopIconScale {
		return desktopIconLayout{}, fmt.Errorf("desktop icon scale must be between %.2f and %.2f", minDesktopIconScale, maxDesktopIconScale)
	}
	return desktopIconLayout{RowGap: rowGap, ColumnGap: columnGap, IconScale: float64(int(iconScale*100+0.5)) / 100}, nil
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

func validateGridLayout(raw folderGridLayout) (folderGridLayout, error) {
	if raw.X < 0 || raw.X > maxLayoutCoord {
		return folderGridLayout{}, fmt.Errorf("layout x must be between 0 and %d", maxLayoutCoord)
	}
	if raw.Y < 0 || raw.Y > maxLayoutCoord {
		return folderGridLayout{}, fmt.Errorf("layout y must be between 0 and %d", maxLayoutCoord)
	}
	return raw, nil
}

func layoutPtr(layout folderGridLayout) *folderGridLayout {
	copy := layout
	return &copy
}

func hasGroup(groups []folderGroup, id string) bool {
	for _, group := range groups {
		if group.ID == id {
			return true
		}
	}
	return false
}

func normalizeGroupID(raw string, groups []folderGroup) (string, error) {
	id := safeID(raw, 32)
	if id == "" || !hasGroup(groups, id) {
		return "", errors.New("valid group id is required")
	}
	return id, nil
}

func nextPageOrder(doc foldersDoc, groupID string) int64 {
	maxOrder := int64(-1)
	for _, item := range doc.Items {
		if item.GroupID == groupID && item.PageOrder > maxOrder {
			maxOrder = item.PageOrder
		}
	}
	for _, container := range doc.Containers {
		if container.GroupID == groupID && container.PageOrder > maxOrder {
			maxOrder = container.PageOrder
		}
	}
	return maxOrder + 1
}

func renumberPageOrder(doc *foldersDoc, groupID string) {
	type entryRef struct {
		kind  string
		index int
		order int64
	}
	entries := []entryRef{}
	for i, item := range doc.Items {
		if item.GroupID == groupID && item.ContainerID == "" {
			entries = append(entries, entryRef{kind: "folder", index: i, order: item.PageOrder})
		}
	}
	for i, container := range doc.Containers {
		if container.GroupID == groupID {
			entries = append(entries, entryRef{kind: "container", index: i, order: container.PageOrder})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].order < entries[j].order
	})
	for order, entry := range entries {
		if entry.kind == "folder" {
			doc.Items[entry.index].PageOrder = int64(order)
		} else {
			doc.Containers[entry.index].PageOrder = int64(order)
		}
	}
}

func uniqueFolderID(items []folderItem, seed int64) string {
	for offset := int64(0); ; offset++ {
		id := fmt.Sprintf("%d-copy-%d", seed, offset)
		if !hasFolder(items, id) {
			return id
		}
	}
}

func hasFolder(items []folderItem, id string) bool {
	for _, item := range items {
		if item.ID == id {
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

func findContainer(containers []desktopContainer, id string) (desktopContainer, bool) {
	for _, container := range containers {
		if container.ID == id {
			return container, true
		}
	}
	return desktopContainer{}, false
}

func uniqueContainerID(containers []desktopContainer, seed int64) string {
	for offset := int64(0); ; offset++ {
		id := fmt.Sprintf("container-%d", seed+offset)
		if !hasContainer(containers, id) {
			return id
		}
	}
}

func nextContainerName(containers []desktopContainer) string {
	existing := make(map[string]bool, len(containers))
	for _, container := range containers {
		existing[strings.TrimSpace(container.Name)] = true
	}
	for index := 1; ; index++ {
		name := fmt.Sprintf("新建收纳夹（%d）", index)
		if !existing[name] {
			return name
		}
	}
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
