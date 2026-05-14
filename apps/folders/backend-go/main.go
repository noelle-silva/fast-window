package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
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
	"net/url"
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
	dataSchemaVersion     = 1
	dataVersion           = 5
	dataFile              = "data.json"
	metaFile              = "_meta.json"
	assetsDir             = "assets"
	iconAssetsDir         = "icons"
	wallpaperAssetsDir    = "wallpapers"
	defaultGroupID        = "default"
	defaultCategoryID     = "folder"
	maxLayoutCoord        = 2000
	maxIconAssetBytes     = 12 * 1024 * 1024
	maxDataURLAssetBytes  = maxIconAssetBytes
	defaultDesktopIconGap = 0
	minDesktopIconGap     = 0
	maxDesktopIconGap     = 64
	minDesktopIconScale   = 0.75
	maxDesktopIconScale   = 1.35
)

const defaultDesktopIconScale = minDesktopIconScale

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

type collectionGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type collectionTarget struct {
	Kind string `json:"kind"`
	Path string `json:"path,omitempty"`
	URL  string `json:"url,omitempty"`
}

type collectionItem struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Target          collectionTarget  `json:"target"`
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

type collectionItemInput struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Target          collectionTarget  `json:"target"`
	GroupID         string            `json:"groupId"`
	PageOrder       int64             `json:"pageOrder"`
	ContainerID     string            `json:"containerId,omitempty"`
	CreatedAt       string            `json:"createdAt"`
	UpdatedAt       string            `json:"updatedAt"`
	CreatedAtMS     int64             `json:"createdAtMs"`
	UpdatedAtMS     int64             `json:"updatedAtMs"`
	Layout          *folderGridLayout `json:"layout,omitempty"`
	ContainerLayout *folderGridLayout `json:"containerLayout,omitempty"`
	Icon            *desktopIcon      `json:"icon"`
	IconSet         bool              `json:"-"`
}

func (input *collectionItemInput) UnmarshalJSON(payload []byte) error {
	type alias collectionItemInput
	var raw alias
	if err := json.Unmarshal(payload, &raw); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return err
	}
	raw.IconSet = false
	for key := range fields {
		if key == "icon" {
			raw.IconSet = true
			break
		}
	}
	*input = collectionItemInput(raw)
	return nil
}

func (input collectionItemInput) collectionItem() collectionItem {
	return collectionItem{
		ID:              input.ID,
		Name:            input.Name,
		Target:          input.Target,
		GroupID:         input.GroupID,
		PageOrder:       input.PageOrder,
		ContainerID:     input.ContainerID,
		CreatedAt:       input.CreatedAt,
		UpdatedAt:       input.UpdatedAt,
		CreatedAtMS:     input.CreatedAtMS,
		UpdatedAtMS:     input.UpdatedAtMS,
		Layout:          input.Layout,
		ContainerLayout: input.ContainerLayout,
		Icon:            input.Icon,
	}
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
	ActiveID string                   `json:"activeId"`
	Presets  []desktopWallpaperPreset `json:"presets"`
}

type desktopWallpaperPreset struct {
	ID      string               `json:"id"`
	Name    string               `json:"name"`
	AssetID string               `json:"assetId"`
	View    desktopWallpaperView `json:"view"`
}

type desktopWallpaperView struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Scale float64 `json:"scale"`
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

type categoryWorkspace struct {
	ID         string             `json:"id"`
	Groups     []collectionGroup  `json:"groups"`
	Items      []collectionItem   `json:"items"`
	Containers []desktopContainer `json:"containers"`
	Desktop    desktopState       `json:"desktop"`
}

type categoryWorkspaceInput struct {
	ID         *string             `json:"id"`
	Groups     *[]collectionGroup  `json:"groups"`
	Items      *[]collectionItem   `json:"items"`
	Containers *[]desktopContainer `json:"containers"`
	Desktop    *desktopStateInput  `json:"desktop"`
}

type collectionsDoc struct {
	SchemaVersion    int                 `json:"schemaVersion"`
	DataVersion      int                 `json:"dataVersion"`
	ActiveCategoryID string              `json:"activeCategoryId"`
	Categories       []categoryWorkspace `json:"categories"`
	UpdatedAt        string              `json:"updatedAt"`

	Groups     []collectionGroup  `json:"-"`
	Items      []collectionItem   `json:"-"`
	Containers []desktopContainer `json:"-"`
	Desktop    desktopState       `json:"-"`
}

type collectionsDocInput struct {
	SchemaVersion    *int                      `json:"schemaVersion"`
	DataVersion      *int                      `json:"dataVersion"`
	ActiveCategoryID *string                   `json:"activeCategoryId"`
	Categories       *[]categoryWorkspaceInput `json:"categories"`
	UpdatedAt        *string                   `json:"updatedAt"`
}

type categoryWorkspaceView struct {
	SchemaVersion int                `json:"schemaVersion"`
	DataVersion   int                `json:"dataVersion"`
	ID            string             `json:"id"`
	Groups        []collectionGroup  `json:"groups"`
	Items         []collectionItem   `json:"items"`
	Containers    []desktopContainer `json:"containers"`
	Desktop       desktopState       `json:"desktop"`
}

type categoryDesktopWallpaper struct {
	CategoryID string            `json:"categoryId"`
	Wallpaper  *desktopWallpaper `json:"wallpaper,omitempty"`
}

type desktopWallpaperDeck struct {
	SchemaVersion int                        `json:"schemaVersion"`
	DataVersion   int                        `json:"dataVersion"`
	Categories    []categoryDesktopWallpaper `json:"categories"`
}

type categoryPayload struct {
	CategoryID string `json:"categoryId"`
}

type itemPayload struct {
	CategoryID string              `json:"categoryId"`
	Item       collectionItemInput `json:"item"`
}

type itemIconPayload struct {
	CategoryID string       `json:"categoryId"`
	ID         string       `json:"id"`
	Icon       *desktopIcon `json:"icon"`
}

type containerPayload struct {
	CategoryID string           `json:"categoryId"`
	Container  desktopContainer `json:"container"`
}

type removePayload struct {
	CategoryID string `json:"categoryId"`
	ID         string `json:"id"`
}

type groupPayload struct {
	CategoryID string          `json:"categoryId"`
	Group      collectionGroup `json:"group"`
}

type groupRemovePayload struct {
	CategoryID string `json:"categoryId"`
	ID         string `json:"id"`
}

type itemGroupTransferPayload struct {
	CategoryID string `json:"categoryId"`
	ID         string `json:"id"`
	GroupID    string `json:"groupId"`
}

type categoryDesktopLayoutSavePayload struct {
	CategoryID string               `json:"categoryId"`
	GroupID    string               `json:"groupId"`
	Items      []desktopLayoutPatch `json:"items"`
}

type categoryWallpaperPayload struct {
	CategoryID string            `json:"categoryId"`
	Wallpaper  *desktopWallpaper `json:"wallpaper"`
}

type categoryIconLayoutPayload struct {
	CategoryID string            `json:"categoryId"`
	IconLayout desktopIconLayout `json:"iconLayout"`
}

type categoryContainerItemsPlacement struct {
	CategoryID  string                 `json:"categoryId"`
	ContainerID string                 `json:"containerId"`
	MovedID     string                 `json:"movedId,omitempty"`
	Items       []containerLayoutPatch `json:"items"`
}

type categoryCreateContainerFromItemsPayload struct {
	CategoryID   string           `json:"categoryId"`
	SourceItemID string           `json:"sourceItemId"`
	TargetItemID string           `json:"targetItemId"`
	Layout       folderGridLayout `json:"layout"`
}

type categoryExtractContainerItemToDesktopPayload struct {
	CategoryID  string               `json:"categoryId"`
	ContainerID string               `json:"containerId"`
	ItemID      string               `json:"itemId"`
	Items       []desktopLayoutPatch `json:"items"`
}

type collectionsDataHealth struct {
	OK            bool   `json:"ok"`
	Error         string `json:"error,omitempty"`
	SchemaVersion int    `json:"schemaVersion,omitempty"`
	DataVersion   int    `json:"dataVersion,omitempty"`
}

type collectionsHealth struct {
	OK      bool                  `json:"ok"`
	DataDir string                `json:"dataDir"`
	Time    string                `json:"time"`
	Data    collectionsDataHealth `json:"data"`
}

type desktopAsset struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

type assetImportSource struct {
	Name  string
	Ext   string
	Bytes []byte
	Size  int64
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
	if method == "collections.web-icons.discover" {
		var payload webIconDiscoveryPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid web icon discovery payload: %w", err)
		}
		return discoverWebIcons(payload.URL)
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()

	switch method {
	case "collections.health":
		return svc.health(), nil
	case "collections.category.get":
		var payload categoryPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid category payload: %w", err)
		}
		return svc.readWorkspaceView(payload.CategoryID)
	case "collections.desktop.wallpaper.deck":
		return svc.readDesktopWallpaperDeck()
	case "collections.assets.import":
		var payload struct {
			Kind       string `json:"kind"`
			SourcePath string `json:"sourcePath"`
			DataURL    string `json:"dataUrl"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid asset import payload: %w", err)
		}
		return svc.importAsset(payload.Kind, payload.SourcePath, payload.DataURL)
	case "collections.items.add":
		var payload itemPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid item payload: %w", err)
		}
		return svc.addItemInput(payload.CategoryID, payload.Item)
	case "collections.items.update":
		var payload itemPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid item payload: %w", err)
		}
		return svc.updateItemInput(payload.CategoryID, payload.Item)
	case "collections.items.remove":
		var payload removePayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid remove item payload: %w", err)
		}
		return svc.removeItem(payload.CategoryID, payload.ID)
	case "collections.items.open":
		var payload removePayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid open item payload: %w", err)
		}
		return svc.openItem(payload.CategoryID, payload.ID)
	case "collections.items.move-to-group":
		var payload itemGroupTransferPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid item group move payload: %w", err)
		}
		return svc.moveItemToGroup(payload)
	case "collections.items.copy-to-group":
		var payload itemGroupTransferPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid item group copy payload: %w", err)
		}
		return svc.copyItemToGroup(payload)
	case "collections.items.container.save":
		var payload struct {
			CategoryID  string   `json:"categoryId"`
			IDs         []string `json:"ids"`
			ContainerID string   `json:"containerId"`
		}
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid item container payload: %w", err)
		}
		return svc.saveCollectionItemContainer(payload.CategoryID, payload.IDs, payload.ContainerID)
	case "collections.containers.add":
		var payload containerPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container payload: %w", err)
		}
		return svc.addCollectionContainer(payload.CategoryID, payload.Container)
	case "collections.containers.update":
		var payload containerPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container payload: %w", err)
		}
		return svc.updateCollectionContainer(payload.CategoryID, payload.Container)
	case "collections.containers.remove":
		var payload removePayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid remove container payload: %w", err)
		}
		return svc.removeCollectionContainer(payload.CategoryID, payload.ID)
	case "collections.containers.create-from-items":
		var payload categoryCreateContainerFromItemsPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid create container payload: %w", err)
		}
		return svc.createCollectionContainerFromItems(payload)
	case "collections.container.items.place":
		var payload categoryContainerItemsPlacement
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container placement payload: %w", err)
		}
		return svc.placeCollectionContainerItems(payload)
	case "collections.container.item.extract-to-desktop":
		var payload categoryExtractContainerItemToDesktopPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid container extraction payload: %w", err)
		}
		return svc.extractCollectionContainerItemToDesktop(payload)
	case "collections.icon.save":
		var payload itemIconPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid icon payload: %w", err)
		}
		return svc.saveCollectionItemIcon(payload.CategoryID, payload.ID, payload.Icon)
	case "collections.desktop.layout.save":
		var payload categoryDesktopLayoutSavePayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid desktop layout payload: %w", err)
		}
		return svc.saveCollectionDesktopLayouts(payload)
	case "collections.desktop.wallpaper.save":
		var payload categoryWallpaperPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid wallpaper payload: %w", err)
		}
		return svc.saveCollectionDesktopWallpaper(payload.CategoryID, payload.Wallpaper)
	case "collections.desktop.icon-layout.save":
		var payload categoryIconLayoutPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid desktop icon layout payload: %w", err)
		}
		return svc.saveCollectionDesktopIconLayout(payload.CategoryID, payload.IconLayout)
	case "collections.groups.add":
		var payload groupPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid group payload: %w", err)
		}
		return svc.addCollectionGroup(payload.CategoryID, payload.Group)
	case "collections.groups.update":
		var payload groupPayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid group payload: %w", err)
		}
		return svc.updateCollectionGroup(payload.CategoryID, payload.Group)
	case "collections.groups.remove":
		var payload groupRemovePayload
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, fmt.Errorf("invalid remove group payload: %w", err)
		}
		return svc.removeCollectionGroup(payload.CategoryID, payload.ID)
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
		return svc.writeCollections(defaultCollectionsDoc())
	} else if err != nil {
		return err
	}
	return nil
}

func (svc *service) writeMeta() error {
	return writeJSON(filepath.Join(svc.dataDir, metaFile), metaDoc{SchemaVersion: dataSchemaVersion, DataVersion: dataVersion, UpdatedAt: nowText()})
}

func (svc *service) readCollections() (collectionsDoc, error) {
	bytes, err := os.ReadFile(filepath.Join(svc.dataDir, dataFile))
	if err != nil {
		return collectionsDoc{}, err
	}
	return decodeCurrentCollectionsDoc(bytes)
}

func (svc *service) writeCollections(doc collectionsDoc) error {
	normalized, err := normalizeCollectionsDoc(doc)
	if err != nil {
		return err
	}
	doc = normalized
	doc.UpdatedAt = nowText()
	return writeJSON(filepath.Join(svc.dataDir, dataFile), doc)
}

func (svc *service) health() collectionsHealth {
	health := collectionsHealth{OK: true, DataDir: svc.dataDir, Time: nowText(), Data: collectionsDataHealth{OK: true}}
	doc, err := svc.readCollections()
	if err != nil {
		health.Data.OK = false
		health.Data.Error = err.Error()
		return health
	}
	health.Data.SchemaVersion = doc.SchemaVersion
	health.Data.DataVersion = doc.DataVersion
	return health
}

func (svc *service) readWorkspaceView(categoryID string) (categoryWorkspaceView, error) {
	doc, err := svc.readCollections()
	if err != nil {
		return categoryWorkspaceView{}, err
	}
	workspace, _, err := workspaceByID(doc, categoryID)
	if err != nil {
		return categoryWorkspaceView{}, err
	}
	return workspaceView(doc, workspace), nil
}

func (svc *service) readDesktopWallpaperDeck() (desktopWallpaperDeck, error) {
	doc, err := svc.readCollections()
	if err != nil {
		return desktopWallpaperDeck{}, err
	}
	categories := make([]categoryDesktopWallpaper, 0, len(doc.Categories))
	for _, workspace := range doc.Categories {
		categories = append(categories, categoryDesktopWallpaper{CategoryID: workspace.ID, Wallpaper: workspace.Desktop.Wallpaper})
	}
	return desktopWallpaperDeck{SchemaVersion: doc.SchemaVersion, DataVersion: doc.DataVersion, Categories: categories}, nil
}

func (svc *service) updateWorkspace(categoryID string, mutate func(workspace *categoryWorkspace) error) (categoryWorkspaceView, error) {
	doc, err := svc.readCollections()
	if err != nil {
		return categoryWorkspaceView{}, err
	}
	workspace, index, err := workspaceByID(doc, categoryID)
	if err != nil {
		return categoryWorkspaceView{}, err
	}
	if err := mutate(&workspace); err != nil {
		return categoryWorkspaceView{}, err
	}
	doc.Categories[index] = workspace
	doc.ActiveCategoryID = workspace.ID
	if err := svc.writeCollections(doc); err != nil {
		return categoryWorkspaceView{}, err
	}
	return svc.readWorkspaceView(workspace.ID)
}

func workspaceView(doc collectionsDoc, workspace categoryWorkspace) categoryWorkspaceView {
	return categoryWorkspaceView{SchemaVersion: doc.SchemaVersion, DataVersion: doc.DataVersion, ID: workspace.ID, Groups: workspace.Groups, Items: workspace.Items, Containers: workspace.Containers, Desktop: workspace.Desktop}
}

func workspaceByID(doc collectionsDoc, categoryID string) (categoryWorkspace, int, error) {
	categoryID = normalizeCategoryID(categoryID)
	for i, workspace := range doc.Categories {
		if workspace.ID == categoryID {
			return workspace, i, nil
		}
	}
	return categoryWorkspace{}, -1, fmt.Errorf("category not found: %s", categoryID)
}

func normalizeCategoryID(categoryID string) string {
	switch strings.TrimSpace(categoryID) {
	case "folder", "url", "file":
		return strings.TrimSpace(categoryID)
	default:
		return ""
	}
}

func categoryOrder(categoryID string) int {
	switch categoryID {
	case "folder":
		return 0
	case "url":
		return 1
	case "file":
		return 2
	default:
		return 99
	}
}

func (svc *service) addItem(categoryID string, payload collectionItem) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		item, err := normalizeWorkspaceItem(payload, *workspace, true)
		if err != nil {
			return err
		}
		doc := workspaceDoc(*workspace)
		item.PageOrder = nextPageOrder(doc, item.GroupID)
		workspace.Items = append(workspace.Items, item)
		return nil
	})
}

func (svc *service) addItemInput(categoryID string, payload collectionItemInput) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		item, _, err := normalizeWorkspaceItemInput(payload, *workspace, true)
		if err != nil {
			return err
		}
		doc := workspaceDoc(*workspace)
		item.PageOrder = nextPageOrder(doc, item.GroupID)
		workspace.Items = append(workspace.Items, item)
		return nil
	})
}

func (svc *service) updateItem(categoryID string, payload collectionItem) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		item, err := normalizeWorkspaceItem(payload, *workspace, false)
		if err != nil {
			return err
		}
		doc := workspaceDoc(*workspace)
		for i := range workspace.Items {
			if workspace.Items[i].ID != item.ID {
				continue
			}
			item.CreatedAtMS = workspace.Items[i].CreatedAtMS
			item.CreatedAt = workspace.Items[i].CreatedAt
			if item.GroupID == workspace.Items[i].GroupID {
				item.PageOrder = workspace.Items[i].PageOrder
				item.ContainerID = workspace.Items[i].ContainerID
				if item.Layout == nil {
					item.Layout = workspace.Items[i].Layout
				}
				if item.ContainerLayout == nil {
					item.ContainerLayout = workspace.Items[i].ContainerLayout
				}
			} else {
				item.PageOrder = nextPageOrder(doc, item.GroupID)
			}
			if item.Icon == nil {
				item.Icon = workspace.Items[i].Icon
			}
			workspace.Items[i] = item
			return nil
		}
		return fmt.Errorf("item not found: %s", item.ID)
	})
}

func (svc *service) updateItemInput(categoryID string, payload collectionItemInput) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		item, iconSet, err := normalizeWorkspaceItemInput(payload, *workspace, false)
		if err != nil {
			return err
		}
		doc := workspaceDoc(*workspace)
		for i := range workspace.Items {
			if workspace.Items[i].ID != item.ID {
				continue
			}
			item.CreatedAtMS = workspace.Items[i].CreatedAtMS
			item.CreatedAt = workspace.Items[i].CreatedAt
			if item.GroupID == workspace.Items[i].GroupID {
				item.PageOrder = workspace.Items[i].PageOrder
				item.ContainerID = workspace.Items[i].ContainerID
				if item.Layout == nil {
					item.Layout = workspace.Items[i].Layout
				}
				if item.ContainerLayout == nil {
					item.ContainerLayout = workspace.Items[i].ContainerLayout
				}
			} else {
				item.PageOrder = nextPageOrder(doc, item.GroupID)
			}
			if !iconSet {
				item.Icon = workspace.Items[i].Icon
			}
			workspace.Items[i] = item
			return nil
		}
		return fmt.Errorf("item not found: %s", item.ID)
	})
}

func (svc *service) removeItem(categoryID string, id string) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		id = strings.TrimSpace(id)
		if id == "" {
			return errors.New("item id is required")
		}
		next := workspace.Items[:0]
		removed := false
		for _, item := range workspace.Items {
			if item.ID == id {
				removed = true
				continue
			}
			next = append(next, item)
		}
		if !removed {
			return fmt.Errorf("item not found: %s", id)
		}
		workspace.Items = next
		return nil
	})
}

func (svc *service) openItem(categoryID string, id string) (map[string]any, error) {
	workspaceView, err := svc.readWorkspaceView(categoryID)
	if err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	for _, item := range workspaceView.Items {
		if item.ID != id {
			continue
		}
		if err := openCollectionTarget(item.Target); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "target": item.Target}, nil
	}
	return nil, fmt.Errorf("item not found: %s", id)
}

func (svc *service) moveItemToGroup(payload itemGroupTransferPayload) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(payload.CategoryID, func(workspace *categoryWorkspace) error {
		id := strings.TrimSpace(payload.ID)
		if id == "" {
			return errors.New("item id is required")
		}
		targetGroupID, err := normalizeGroupID(payload.GroupID, workspace.Groups)
		if err != nil {
			return err
		}
		doc := workspaceDoc(*workspace)
		for i := range workspace.Items {
			if workspace.Items[i].ID != id {
				continue
			}
			if workspace.Items[i].GroupID == targetGroupID {
				return nil
			}
			now := time.Now().UnixMilli()
			nowString := nowText()
			workspace.Items[i].GroupID = targetGroupID
			workspace.Items[i].PageOrder = nextPageOrder(doc, targetGroupID)
			workspace.Items[i].ContainerID = ""
			workspace.Items[i].ContainerLayout = nil
			workspace.Items[i].Layout = nil
			workspace.Items[i].UpdatedAtMS = now
			workspace.Items[i].UpdatedAt = nowString
			return nil
		}
		return fmt.Errorf("item not found: %s", id)
	})
}

func (svc *service) copyItemToGroup(payload itemGroupTransferPayload) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(payload.CategoryID, func(workspace *categoryWorkspace) error {
		id := strings.TrimSpace(payload.ID)
		if id == "" {
			return errors.New("item id is required")
		}
		targetGroupID, err := normalizeGroupID(payload.GroupID, workspace.Groups)
		if err != nil {
			return err
		}
		doc := workspaceDoc(*workspace)
		for _, item := range workspace.Items {
			if item.ID != id {
				continue
			}
			if item.GroupID == targetGroupID {
				return errors.New("target group must be different")
			}
			now := time.Now().UnixMilli()
			nowString := nowText()
			copy := item
			copy.ID = uniqueCollectionItemID(workspace.Items, now)
			copy.GroupID = targetGroupID
			copy.PageOrder = nextPageOrder(doc, targetGroupID)
			copy.ContainerID = ""
			copy.ContainerLayout = nil
			copy.Layout = nil
			copy.CreatedAtMS = now
			copy.UpdatedAtMS = now
			copy.CreatedAt = nowString
			copy.UpdatedAt = nowString
			workspace.Items = append(workspace.Items, copy)
			return nil
		}
		return fmt.Errorf("item not found: %s", id)
	})
}

func workspaceDoc(workspace categoryWorkspace) collectionsDoc {
	return collectionsDoc{Groups: workspace.Groups, Items: workspace.Items, Containers: workspace.Containers, Desktop: workspace.Desktop}
}

func applyWorkspaceDoc(workspace *categoryWorkspace, doc collectionsDoc) {
	workspace.Groups = doc.Groups
	workspace.Items = doc.Items
	workspace.Containers = doc.Containers
	workspace.Desktop = doc.Desktop
}

func normalizeWorkspaceItem(payload collectionItem, workspace categoryWorkspace, allowNewID bool) (collectionItem, error) {
	item, err := normalizeCollectionItem(payload, workspace.Groups, allowNewID)
	if err != nil {
		return collectionItem{}, err
	}
	if item.Target.Kind != workspace.ID {
		return collectionItem{}, fmt.Errorf("item target kind must match category %s", workspace.ID)
	}
	return item, nil
}

func normalizeWorkspaceItemInput(payload collectionItemInput, workspace categoryWorkspace, allowNewID bool) (collectionItem, bool, error) {
	item, err := normalizeCollectionItem(payload.collectionItem(), workspace.Groups, allowNewID)
	if err != nil {
		return collectionItem{}, false, err
	}
	if item.Target.Kind != workspace.ID {
		return collectionItem{}, false, fmt.Errorf("item target kind must match category %s", workspace.ID)
	}
	return item, payload.IconSet, nil
}

func (svc *service) saveCollectionDesktopLayouts(payload categoryDesktopLayoutSavePayload) (categoryWorkspaceView, error) {
	if len(payload.Items) == 0 {
		return svc.readWorkspaceView(payload.CategoryID)
	}
	return svc.updateWorkspace(payload.CategoryID, func(workspace *categoryWorkspace) error {
		doc := workspaceDoc(*workspace)
		view, err := applyDesktopLayouts(doc, desktopLayoutSavePayload{GroupID: payload.GroupID, Items: payload.Items})
		if err != nil {
			return err
		}
		applyWorkspaceDoc(workspace, view)
		return nil
	})
}

func applyDesktopLayouts(doc collectionsDoc, payload desktopLayoutSavePayload) (collectionsDoc, error) {
	if len(payload.Items) == 0 {
		return doc, nil
	}
	groupID, err := normalizeGroupID(payload.GroupID, doc.Groups)
	if err != nil {
		return collectionsDoc{}, err
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
			return collectionsDoc{}, errors.New("desktop layout kind and id are required")
		}
		updates = append(updates, layoutUpdate{kind: kind, id: id, layout: normalizeGridLayout(patch.Layout)})
	}
	found := make(map[string]bool, len(updates))
	now := time.Now().UnixMilli()
	nowString := nowText()
	for _, update := range updates {
		key := update.kind + ":" + update.id
		switch update.kind {
		case "item":
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
			return collectionsDoc{}, fmt.Errorf("desktop entry not found: %s", key)
		}
	}
	renumberPageOrder(&doc, groupID)
	return doc, nil
}

func (svc *service) addCollectionContainer(categoryID string, payload desktopContainer) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		container, err := normalizeDesktopContainer(payload, workspace.Groups, true)
		if err != nil {
			return err
		}
		for _, current := range workspace.Containers {
			if current.ID == container.ID {
				return fmt.Errorf("container already exists: %s", container.ID)
			}
		}
		container.PageOrder = nextPageOrder(workspaceDoc(*workspace), container.GroupID)
		workspace.Containers = append(workspace.Containers, container)
		return nil
	})
}

func (svc *service) updateCollectionContainer(categoryID string, payload desktopContainer) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		container, err := normalizeDesktopContainer(payload, workspace.Groups, false)
		if err != nil {
			return err
		}
		for i := range workspace.Containers {
			if workspace.Containers[i].ID != container.ID {
				continue
			}
			container.CreatedAt = workspace.Containers[i].CreatedAt
			container.CreatedAtMS = workspace.Containers[i].CreatedAtMS
			container.GroupID = workspace.Containers[i].GroupID
			container.PageOrder = workspace.Containers[i].PageOrder
			if container.Layout == nil {
				container.Layout = workspace.Containers[i].Layout
			}
			workspace.Containers[i] = container
			return nil
		}
		return fmt.Errorf("container not found: %s", container.ID)
	})
}

func (svc *service) removeCollectionContainer(categoryID string, id string) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		id = strings.TrimSpace(id)
		if id == "" {
			return errors.New("container id is required")
		}
		nextContainers := workspace.Containers[:0]
		removed := false
		for _, container := range workspace.Containers {
			if container.ID == id {
				removed = true
				continue
			}
			nextContainers = append(nextContainers, container)
		}
		if !removed {
			return fmt.Errorf("container not found: %s", id)
		}
		now := time.Now().UnixMilli()
		nowString := nowText()
		for i := range workspace.Items {
			if workspace.Items[i].ContainerID == id {
				workspace.Items[i].ContainerID = ""
				workspace.Items[i].ContainerLayout = nil
				workspace.Items[i].UpdatedAtMS = now
				workspace.Items[i].UpdatedAt = nowString
			}
		}
		workspace.Containers = nextContainers
		return nil
	})
}

func (svc *service) createCollectionContainerFromItems(payload categoryCreateContainerFromItemsPayload) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(payload.CategoryID, func(workspace *categoryWorkspace) error {
		doc := workspaceDoc(*workspace)
		view, err := createContainerFromItemsInDoc(doc, createContainerFromItemsPayload{SourceItemID: payload.SourceItemID, TargetItemID: payload.TargetItemID, Layout: payload.Layout})
		if err != nil {
			return err
		}
		applyWorkspaceDoc(workspace, view)
		return nil
	})
}

func createContainerFromItemsInDoc(doc collectionsDoc, payload createContainerFromItemsPayload) (collectionsDoc, error) {
	sourceItemID := strings.TrimSpace(payload.SourceItemID)
	targetItemID := strings.TrimSpace(payload.TargetItemID)
	if sourceItemID == "" || targetItemID == "" {
		return collectionsDoc{}, errors.New("source and target item ids are required")
	}
	if sourceItemID == targetItemID {
		return collectionsDoc{}, errors.New("source and target item ids must be different")
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
		return collectionsDoc{}, fmt.Errorf("item not found: %s", sourceItemID)
	}
	if targetIndex < 0 {
		return collectionsDoc{}, fmt.Errorf("item not found: %s", targetItemID)
	}
	if doc.Items[targetIndex].ContainerID != "" {
		return collectionsDoc{}, errors.New("target item must be on desktop")
	}
	if doc.Items[sourceIndex].GroupID != doc.Items[targetIndex].GroupID {
		return collectionsDoc{}, errors.New("source and target items must be in the same group")
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
	return doc, nil
}

func (svc *service) saveCollectionItemContainer(categoryID string, ids []string, containerID string) (categoryWorkspaceView, error) {
	if len(ids) == 0 {
		return svc.readWorkspaceView(categoryID)
	}
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		doc := workspaceDoc(*workspace)
		view, err := saveItemContainerInDoc(doc, ids, containerID)
		if err != nil {
			return err
		}
		applyWorkspaceDoc(workspace, view)
		return nil
	})
}

func saveItemContainerInDoc(doc collectionsDoc, ids []string, containerID string) (collectionsDoc, error) {
	containerID = strings.TrimSpace(containerID)
	targetGroupID := ""
	if containerID != "" {
		container, ok := findContainer(doc.Containers, containerID)
		if !ok {
			return collectionsDoc{}, fmt.Errorf("container not found: %s", containerID)
		}
		targetGroupID = container.GroupID
	}
	updates := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return collectionsDoc{}, errors.New("item id is required")
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
			return collectionsDoc{}, fmt.Errorf("item group mismatch for container %s: %s", containerID, doc.Items[i].ID)
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
			return collectionsDoc{}, fmt.Errorf("item not found: %s", id)
		}
	}
	return doc, nil
}

func (svc *service) placeCollectionContainerItems(payload categoryContainerItemsPlacement) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(payload.CategoryID, func(workspace *categoryWorkspace) error {
		doc := workspaceDoc(*workspace)
		view, err := placeContainerItemsInDoc(doc, containerItemsPlacement{ContainerID: payload.ContainerID, MovedID: payload.MovedID, Items: payload.Items})
		if err != nil {
			return err
		}
		applyWorkspaceDoc(workspace, view)
		return nil
	})
}

func placeContainerItemsInDoc(doc collectionsDoc, payload containerItemsPlacement) (collectionsDoc, error) {
	containerID := strings.TrimSpace(payload.ContainerID)
	movedID := strings.TrimSpace(payload.MovedID)
	if containerID == "" {
		return collectionsDoc{}, errors.New("container id is required")
	}
	if len(payload.Items) == 0 {
		if movedID == "" {
			return doc, nil
		}
		return collectionsDoc{}, errors.New("moved item layout is required")
	}
	container, ok := findContainer(doc.Containers, containerID)
	if !ok {
		return collectionsDoc{}, fmt.Errorf("container not found: %s", containerID)
	}
	placements := make(map[string]folderGridLayout, len(payload.Items))
	for _, item := range payload.Items {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			return collectionsDoc{}, errors.New("item id is required")
		}
		if _, exists := placements[id]; exists {
			return collectionsDoc{}, fmt.Errorf("duplicate item placement: %s", id)
		}
		placements[id] = normalizeGridLayout(item.Layout)
	}
	if movedID != "" {
		if _, exists := placements[movedID]; !exists {
			return collectionsDoc{}, errors.New("moved item layout is required")
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
				return collectionsDoc{}, fmt.Errorf("item group mismatch for container %s: %s", containerID, id)
			}
			doc.Items[i].ContainerID = containerID
			movedFound = true
		}
		layout, shouldPlace := placements[id]
		if !shouldPlace {
			continue
		}
		if doc.Items[i].ContainerID != containerID {
			return collectionsDoc{}, fmt.Errorf("item is not in container %s: %s", containerID, id)
		}
		if doc.Items[i].GroupID != container.GroupID {
			return collectionsDoc{}, fmt.Errorf("item group mismatch for container %s: %s", containerID, id)
		}
		layoutCopy := layout
		doc.Items[i].ContainerLayout = &layoutCopy
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		found[id] = true
	}
	if !movedFound {
		return collectionsDoc{}, fmt.Errorf("item not found: %s", movedID)
	}
	for id := range placements {
		if !found[id] {
			return collectionsDoc{}, fmt.Errorf("item not found: %s", id)
		}
	}
	return doc, nil
}

func (svc *service) extractCollectionContainerItemToDesktop(payload categoryExtractContainerItemToDesktopPayload) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(payload.CategoryID, func(workspace *categoryWorkspace) error {
		doc := workspaceDoc(*workspace)
		view, err := extractContainerItemToDesktopInDoc(doc, extractContainerItemToDesktopPayload{ContainerID: payload.ContainerID, ItemID: payload.ItemID, Items: payload.Items})
		if err != nil {
			return err
		}
		applyWorkspaceDoc(workspace, view)
		return nil
	})
}

func extractContainerItemToDesktopInDoc(doc collectionsDoc, payload extractContainerItemToDesktopPayload) (collectionsDoc, error) {
	containerID := strings.TrimSpace(payload.ContainerID)
	itemID := strings.TrimSpace(payload.ItemID)
	if containerID == "" {
		return collectionsDoc{}, errors.New("container id is required")
	}
	if itemID == "" {
		return collectionsDoc{}, errors.New("item id is required")
	}
	if len(payload.Items) == 0 {
		return collectionsDoc{}, errors.New("desktop layout patches are required")
	}
	container, ok := findContainer(doc.Containers, containerID)
	if !ok {
		return collectionsDoc{}, fmt.Errorf("container not found: %s", containerID)
	}
	updates := make(map[string]desktopLayoutPatch, len(payload.Items))
	for _, patch := range payload.Items {
		kind := normalizeDesktopEntryKind(patch.Kind)
		id := strings.TrimSpace(patch.ID)
		if kind == "" || id == "" {
			return collectionsDoc{}, errors.New("desktop layout kind and id are required")
		}
		key := kind + ":" + id
		if _, exists := updates[key]; exists {
			return collectionsDoc{}, fmt.Errorf("duplicate desktop layout patch: %s", key)
		}
		updates[key] = desktopLayoutPatch{Kind: kind, ID: id, Layout: normalizeGridLayout(patch.Layout)}
	}
	itemPatch, ok := updates["item:"+itemID]
	if !ok {
		return collectionsDoc{}, errors.New("moved item desktop layout is required")
	}
	found := map[string]bool{}
	movedFound := false
	now := time.Now().UnixMilli()
	nowString := nowText()
	for i := range doc.Items {
		key := "item:" + doc.Items[i].ID
		patch, shouldUpdate := updates[key]
		if doc.Items[i].ID == itemID {
			if doc.Items[i].ContainerID != containerID {
				return collectionsDoc{}, fmt.Errorf("item is not in container %s: %s", containerID, itemID)
			}
			if doc.Items[i].GroupID != container.GroupID {
				return collectionsDoc{}, fmt.Errorf("item group mismatch for container %s: %s", containerID, itemID)
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
			return collectionsDoc{}, fmt.Errorf("item is not on desktop: %s", doc.Items[i].ID)
		}
		doc.Items[i].Layout = layoutPtr(patch.Layout)
		doc.Items[i].UpdatedAtMS = now
		doc.Items[i].UpdatedAt = nowString
		found[key] = true
	}
	if !movedFound {
		return collectionsDoc{}, fmt.Errorf("item not found: %s", itemID)
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
			return collectionsDoc{}, fmt.Errorf("desktop entry not found: %s", key)
		}
	}
	return doc, nil
}

func (svc *service) saveCollectionItemIcon(categoryID string, id string, icon *desktopIcon) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		id = strings.TrimSpace(id)
		if id == "" {
			return errors.New("item id is required")
		}
		normalizedIcon, err := validateDesktopIcon(icon)
		if err != nil {
			return err
		}
		now := time.Now().UnixMilli()
		nowString := nowText()
		for i := range workspace.Items {
			if workspace.Items[i].ID != id {
				continue
			}
			workspace.Items[i].Icon = normalizedIcon
			workspace.Items[i].UpdatedAtMS = now
			workspace.Items[i].UpdatedAt = nowString
			return nil
		}
		return fmt.Errorf("item not found: %s", id)
	})
}

func (svc *service) saveCollectionDesktopWallpaper(categoryID string, wallpaper *desktopWallpaper) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		normalized, err := validateDesktopWallpaper(wallpaper)
		if err != nil {
			return err
		}
		workspace.Desktop.Wallpaper = normalized
		return nil
	})
}

func (svc *service) saveCollectionDesktopIconLayout(categoryID string, iconLayout desktopIconLayout) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		normalized, err := normalizeDesktopIconLayout(iconLayout)
		if err != nil {
			return err
		}
		workspace.Desktop.IconLayout = normalized
		return nil
	})
}

func (svc *service) addCollectionGroup(categoryID string, payload collectionGroup) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		group, err := normalizeGroup(payload, true)
		if err != nil {
			return err
		}
		if hasGroup(workspace.Groups, group.ID) {
			return fmt.Errorf("group already exists: %s", group.ID)
		}
		workspace.Groups = append(workspace.Groups, group)
		return nil
	})
}

func (svc *service) updateCollectionGroup(categoryID string, payload collectionGroup) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		group, err := normalizeGroup(payload, false)
		if err != nil {
			return err
		}
		for i := range workspace.Groups {
			if workspace.Groups[i].ID == group.ID {
				workspace.Groups[i].Name = group.Name
				return nil
			}
		}
		return fmt.Errorf("group not found: %s", group.ID)
	})
}

func (svc *service) removeCollectionGroup(categoryID string, id string) (categoryWorkspaceView, error) {
	return svc.updateWorkspace(categoryID, func(workspace *categoryWorkspace) error {
		id = safeID(id, 32)
		if id == "" {
			return errors.New("group id is required")
		}
		if id == defaultGroupID {
			return errors.New("default group cannot be removed")
		}
		nextGroups := workspace.Groups[:0]
		removed := false
		for _, group := range workspace.Groups {
			if group.ID == id {
				removed = true
				continue
			}
			nextGroups = append(nextGroups, group)
		}
		if !removed {
			return fmt.Errorf("group not found: %s", id)
		}
		doc := workspaceDoc(*workspace)
		nextOrder := nextPageOrder(doc, defaultGroupID)
		now := time.Now().UnixMilli()
		nowString := nowText()
		for i := range workspace.Items {
			if workspace.Items[i].GroupID == id {
				workspace.Items[i].GroupID = defaultGroupID
				workspace.Items[i].PageOrder = nextOrder
				workspace.Items[i].ContainerID = ""
				workspace.Items[i].ContainerLayout = nil
				workspace.Items[i].Layout = nil
				workspace.Items[i].UpdatedAtMS = now
				workspace.Items[i].UpdatedAt = nowString
				nextOrder++
			}
		}
		for i := range workspace.Containers {
			if workspace.Containers[i].GroupID == id {
				workspace.Containers[i].GroupID = defaultGroupID
				workspace.Containers[i].PageOrder = nextOrder
				workspace.Containers[i].Layout = nil
				workspace.Containers[i].UpdatedAtMS = now
				workspace.Containers[i].UpdatedAt = nowString
				nextOrder++
			}
		}
		workspace.Groups = nextGroups
		nextDoc := workspaceDoc(*workspace)
		renumberPageOrder(&nextDoc, defaultGroupID)
		applyWorkspaceDoc(workspace, nextDoc)
		return nil
	})
}

func (svc *service) importAsset(kind string, sourcePath string, dataURL string) (desktopAsset, error) {
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

	source, err := loadAssetImportSource(strings.TrimSpace(sourcePath), strings.TrimSpace(dataURL))
	if err != nil {
		return desktopAsset{}, err
	}
	if source.Size <= 0 {
		return desktopAsset{}, errors.New("asset file is empty")
	}
	if maxAssetBytes > 0 && source.Size > maxAssetBytes {
		return desktopAsset{}, fmt.Errorf("%s asset file is too large: max %d bytes", kind, maxAssetBytes)
	}
	if err := validateAssetImageContent(source.Bytes, source.Ext); err != nil {
		return desktopAsset{}, err
	}

	hasher := sha1.New()
	if _, err := io.Copy(hasher, bytes.NewReader(source.Bytes)); err != nil {
		return desktopAsset{}, fmt.Errorf("hash asset source failed: %w", err)
	}
	assetName := hex.EncodeToString(hasher.Sum(nil)) + source.Ext
	assetID := filepath.ToSlash(filepath.Join(assetSubdir, assetName))
	targetPath := filepath.Join(svc.dataDir, assetsDir, assetSubdir, assetName)
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return desktopAsset{}, err
	}
	if _, err := os.Stat(targetPath); errors.Is(err, os.ErrNotExist) {
		out, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return desktopAsset{}, fmt.Errorf("create asset target failed: %w", err)
		}
		_, copyErr := io.Copy(out, bytes.NewReader(source.Bytes))
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

func loadAssetImportSource(sourcePath string, dataURL string) (assetImportSource, error) {
	if sourcePath == "" && dataURL == "" {
		return assetImportSource{}, errors.New("asset source path or data URL is required")
	}
	if sourcePath != "" && dataURL != "" {
		return assetImportSource{}, errors.New("asset import accepts exactly one source")
	}
	if dataURL != "" {
		return dataURLAssetImportSource(dataURL)
	}
	return fileAssetImportSource(sourcePath)
}

func fileAssetImportSource(sourcePath string) (assetImportSource, error) {
	ext := strings.ToLower(filepath.Ext(sourcePath))
	if !isSupportedImageExt(ext) {
		return assetImportSource{}, errors.New("asset must be a png, jpg, jpeg, webp, gif, ico, or svg image")
	}
	payload, err := os.ReadFile(sourcePath)
	if err != nil {
		return assetImportSource{}, fmt.Errorf("read asset source failed: %w", err)
	}
	return newAssetImportSource(filepath.Base(sourcePath), ext, payload)
}

func dataURLAssetImportSource(dataURL string) (assetImportSource, error) {
	mediaType, payload, ok := strings.Cut(dataURL, ",")
	if !ok || !strings.HasPrefix(strings.ToLower(mediaType), "data:image/") || !strings.HasSuffix(strings.ToLower(mediaType), ";base64") {
		return assetImportSource{}, errors.New("asset data URL must be a base64 image")
	}
	ext, err := imageExtFromDataURLMediaType(mediaType)
	if err != nil {
		return assetImportSource{}, err
	}
	if int64(len(payload)) > maxDataURLAssetBytes*2 {
		return assetImportSource{}, fmt.Errorf("asset data URL is too large: max %d bytes", maxDataURLAssetBytes)
	}
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return assetImportSource{}, fmt.Errorf("decode asset data URL failed: %w", err)
	}
	return newAssetImportSource("data-url"+ext, ext, decoded)
}

func newAssetImportSource(name string, ext string, payload []byte) (assetImportSource, error) {
	ext = strings.ToLower(ext)
	if !isSupportedImageExt(ext) {
		return assetImportSource{}, errors.New("asset must be a png, jpg, jpeg, webp, gif, ico, or svg image")
	}
	bytes := append([]byte(nil), payload...)
	return assetImportSource{Name: name, Ext: ext, Bytes: bytes, Size: int64(len(bytes))}, nil
}

func (svc *service) serveAsset(w http.ResponseWriter, r *http.Request) {
	assetID := strings.TrimPrefix(r.URL.Path, "/assets/")
	path, err := svc.assetPath(assetID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}

func (svc *service) assetPath(assetID string) (string, error) {
	assetID = strings.TrimSpace(filepath.ToSlash(assetID))
	if !isSafeAssetID(assetID) {
		return "", errors.New("invalid asset id")
	}
	return filepath.Join(svc.dataDir, assetsDir, filepath.FromSlash(assetID)), nil
}

func defaultCollectionsDoc() collectionsDoc {
	categories := []categoryWorkspace{defaultCategoryWorkspace("folder"), defaultCategoryWorkspace("url"), defaultCategoryWorkspace("file")}
	active := categories[0]
	return collectionsDoc{
		SchemaVersion:    dataSchemaVersion,
		DataVersion:      dataVersion,
		ActiveCategoryID: defaultCategoryID,
		Categories:       categories,
		UpdatedAt:        nowText(),
		Groups:           active.Groups,
		Items:            active.Items,
		Containers:       active.Containers,
		Desktop:          active.Desktop,
	}
}

func defaultCategoryWorkspace(id string) categoryWorkspace {
	return categoryWorkspace{ID: id, Groups: []collectionGroup{{ID: defaultGroupID, Name: "默认"}}, Items: []collectionItem{}, Containers: []desktopContainer{}, Desktop: desktopState{IconLayout: defaultDesktopIconLayout()}}
}

func decodeCurrentCollectionsDoc(payload []byte) (collectionsDoc, error) {
	if len(bytes.TrimSpace(payload)) == 0 {
		return collectionsDoc{}, errors.New("collections data file is empty")
	}
	var input collectionsDocInput
	if err := json.Unmarshal(payload, &input); err != nil {
		return collectionsDoc{}, fmt.Errorf("parse collections data failed: %w", err)
	}
	if input.SchemaVersion == nil {
		return collectionsDoc{}, errors.New("collections data schemaVersion is required")
	}
	if *input.SchemaVersion != dataSchemaVersion {
		return collectionsDoc{}, fmt.Errorf("collections data schemaVersion %d is not supported; expected %d", *input.SchemaVersion, dataSchemaVersion)
	}
	if input.DataVersion == nil {
		return collectionsDoc{}, errors.New("collections data dataVersion is required")
	}
	if *input.DataVersion != dataVersion {
		return collectionsDoc{}, fmt.Errorf("collections dataVersion %d is not supported; expected %d after migrations", *input.DataVersion, dataVersion)
	}
	if input.ActiveCategoryID == nil {
		return collectionsDoc{}, errors.New("collections data activeCategoryId is required")
	}
	if input.Categories == nil {
		return collectionsDoc{}, errors.New("collections data categories is required")
	}
	categories := make([]categoryWorkspace, 0, len(*input.Categories))
	for index, raw := range *input.Categories {
		workspace, err := decodeCategoryWorkspace(raw)
		if err != nil {
			return collectionsDoc{}, fmt.Errorf("categories[%d]: %w", index, err)
		}
		categories = append(categories, workspace)
	}
	updatedAt := ""
	if input.UpdatedAt != nil {
		updatedAt = *input.UpdatedAt
	}
	doc := collectionsDoc{
		SchemaVersion:    *input.SchemaVersion,
		DataVersion:      *input.DataVersion,
		ActiveCategoryID: *input.ActiveCategoryID,
		Categories:       categories,
		UpdatedAt:        updatedAt,
	}
	return normalizeCollectionsDoc(doc)
}

func decodeCategoryWorkspace(input categoryWorkspaceInput) (categoryWorkspace, error) {
	if input.ID == nil {
		return categoryWorkspace{}, errors.New("category id is required")
	}
	if input.Groups == nil {
		return categoryWorkspace{}, errors.New("groups is required")
	}
	if input.Items == nil {
		return categoryWorkspace{}, errors.New("items is required")
	}
	if input.Containers == nil {
		return categoryWorkspace{}, errors.New("containers is required")
	}
	if input.Desktop == nil {
		return categoryWorkspace{}, errors.New("desktop is required")
	}
	if input.Desktop.IconLayout == nil {
		return categoryWorkspace{}, errors.New("desktop.iconLayout is required")
	}
	iconLayout, err := decodeDesktopIconLayout(*input.Desktop.IconLayout)
	if err != nil {
		return categoryWorkspace{}, err
	}
	return categoryWorkspace{ID: *input.ID, Groups: *input.Groups, Items: *input.Items, Containers: *input.Containers, Desktop: desktopState{Wallpaper: input.Desktop.Wallpaper, IconLayout: iconLayout}}, nil
}

func decodeDesktopIconLayout(input desktopIconLayoutInput) (desktopIconLayout, error) {
	if input.RowGap == nil {
		return desktopIconLayout{}, errors.New("collections data desktop.iconLayout.rowGap is required")
	}
	if input.ColumnGap == nil {
		return desktopIconLayout{}, errors.New("collections data desktop.iconLayout.columnGap is required")
	}
	if input.IconScale == nil {
		return desktopIconLayout{}, errors.New("collections data desktop.iconLayout.iconScale is required")
	}
	return normalizeDesktopIconLayout(desktopIconLayout{RowGap: *input.RowGap, ColumnGap: *input.ColumnGap, IconScale: *input.IconScale})
}

func normalizeCollectionsDoc(doc collectionsDoc) (collectionsDoc, error) {
	activeCategoryID := normalizeCategoryID(doc.ActiveCategoryID)
	if activeCategoryID == "" {
		return collectionsDoc{}, errors.New("valid activeCategoryId is required")
	}
	if len(doc.Categories) != 3 {
		return collectionsDoc{}, errors.New("folder, url, and file collection categories are required")
	}
	categories := make([]categoryWorkspace, 0, len(doc.Categories))
	seenCategories := map[string]bool{}
	for i, raw := range doc.Categories {
		workspace, err := normalizeCategoryWorkspace(raw)
		if err != nil {
			return collectionsDoc{}, fmt.Errorf("categories[%d]: %w", i, err)
		}
		if seenCategories[workspace.ID] {
			return collectionsDoc{}, fmt.Errorf("duplicate category id: %s", workspace.ID)
		}
		seenCategories[workspace.ID] = true
		categories = append(categories, workspace)
	}
	for _, required := range []string{"folder", "url", "file"} {
		if !seenCategories[required] {
			return collectionsDoc{}, fmt.Errorf("category is required: %s", required)
		}
	}
	sort.SliceStable(categories, func(i, j int) bool { return categoryOrder(categories[i].ID) < categoryOrder(categories[j].ID) })
	active, _, err := workspaceByID(collectionsDoc{Categories: categories}, activeCategoryID)
	if err != nil {
		return collectionsDoc{}, err
	}
	return collectionsDoc{
		SchemaVersion:    dataSchemaVersion,
		DataVersion:      dataVersion,
		ActiveCategoryID: activeCategoryID,
		Categories:       categories,
		UpdatedAt:        firstNonEmpty(doc.UpdatedAt, nowText()),
		Groups:           active.Groups,
		Items:            active.Items,
		Containers:       active.Containers,
		Desktop:          active.Desktop,
	}, nil
}

func normalizeCategoryWorkspace(raw categoryWorkspace) (categoryWorkspace, error) {
	categoryID := normalizeCategoryID(raw.ID)
	if categoryID == "" {
		return categoryWorkspace{}, errors.New("valid category id is required")
	}
	if len(raw.Groups) == 0 {
		return categoryWorkspace{}, errors.New("default group is required")
	}
	groups := make([]collectionGroup, 0, len(raw.Groups))
	seen := map[string]bool{}
	for i, group := range raw.Groups {
		normalized, err := normalizeGroup(group, false)
		if err != nil {
			return categoryWorkspace{}, fmt.Errorf("groups[%d]: %w", i, err)
		}
		if i == 0 && normalized.ID != defaultGroupID {
			return categoryWorkspace{}, errors.New("default group must be first")
		}
		if seen[normalized.ID] {
			return categoryWorkspace{}, fmt.Errorf("duplicate group id: %s", normalized.ID)
		}
		groups = append(groups, normalized)
		seen[normalized.ID] = true
	}

	containers := make([]desktopContainer, 0, len(raw.Containers))
	containerIDs := map[string]bool{}
	containerGroupByID := map[string]string{}
	for i, containerRaw := range raw.Containers {
		container, err := normalizeDesktopContainer(containerRaw, groups, false)
		if err != nil {
			return categoryWorkspace{}, fmt.Errorf("containers[%d]: %w", i, err)
		}
		if containerIDs[container.ID] {
			return categoryWorkspace{}, fmt.Errorf("duplicate container id: %s", container.ID)
		}
		containers = append(containers, container)
		containerIDs[container.ID] = true
		containerGroupByID[container.ID] = container.GroupID
	}

	items := make([]collectionItem, 0, len(raw.Items))
	itemIDs := map[string]bool{}
	for i, itemRaw := range raw.Items {
		item, err := normalizeCollectionItem(itemRaw, groups, false)
		if err != nil {
			return categoryWorkspace{}, fmt.Errorf("items[%d]: %w", i, err)
		}
		if item.Target.Kind != categoryID {
			return categoryWorkspace{}, fmt.Errorf("items[%d]: target kind must match category %s", i, categoryID)
		}
		if itemIDs[item.ID] {
			return categoryWorkspace{}, fmt.Errorf("duplicate item id: %s", item.ID)
		}
		if item.ContainerID != "" && !containerIDs[item.ContainerID] {
			return categoryWorkspace{}, fmt.Errorf("items[%d]: container not found: %s", i, item.ContainerID)
		}
		if item.ContainerID != "" && containerGroupByID[item.ContainerID] != item.GroupID {
			return categoryWorkspace{}, fmt.Errorf("items[%d]: container group mismatch: %s", i, item.ContainerID)
		}
		if item.ContainerID == "" && item.ContainerLayout != nil {
			return categoryWorkspace{}, fmt.Errorf("items[%d]: containerLayout requires containerId", i)
		}
		items = append(items, item)
		itemIDs[item.ID] = true
	}
	desktop, err := normalizeDesktopState(raw.Desktop)
	if err != nil {
		return categoryWorkspace{}, err
	}
	return categoryWorkspace{ID: categoryID, Groups: groups, Items: items, Containers: containers, Desktop: desktop}, nil
}

func normalizeGroup(raw collectionGroup, allowGeneratedID bool) (collectionGroup, error) {
	name := trimMax(raw.Name, 40)
	id := safeID(raw.ID, 32)
	if id == "" && allowGeneratedID {
		id = generatedSafeID("group", 32)
	}
	if id == "" {
		return collectionGroup{}, errors.New("group id is required")
	}
	if name == "" {
		return collectionGroup{}, errors.New("group name is required")
	}
	return collectionGroup{ID: id, Name: name}, nil
}

func normalizeCollectionItem(raw collectionItem, groups []collectionGroup, allowNewID bool) (collectionItem, error) {
	now := time.Now().UnixMilli()
	nowString := nowText()
	id := strings.TrimSpace(raw.ID)
	if id == "" && allowNewID {
		id = fmt.Sprintf("%d", now)
	}
	if id == "" {
		return collectionItem{}, errors.New("item id is required")
	}
	target, err := normalizeCollectionTarget(raw.Target)
	if err != nil {
		return collectionItem{}, err
	}
	name := trimMax(raw.Name, 80)
	if name == "" {
		name = trimMax(defaultItemName(target), 80)
		if name == "" || name == "." {
			return collectionItem{}, errors.New("item name is required")
		}
	}
	groupID, err := normalizeGroupID(raw.GroupID, groups)
	if err != nil {
		return collectionItem{}, err
	}
	pageOrder := raw.PageOrder
	if pageOrder < 0 {
		return collectionItem{}, errors.New("item pageOrder must be non-negative")
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
			return collectionItem{}, err
		}
		itemLayout = &normalizedLayout
	}
	var containerLayout *folderGridLayout
	if raw.ContainerLayout != nil {
		normalizedLayout, err := validateGridLayout(*raw.ContainerLayout)
		if err != nil {
			return collectionItem{}, err
		}
		containerLayout = &normalizedLayout
	}
	icon, err := validateDesktopIcon(raw.Icon)
	if err != nil {
		return collectionItem{}, err
	}
	return collectionItem{ID: id, Name: name, Target: target, GroupID: groupID, PageOrder: pageOrder, ContainerID: strings.TrimSpace(raw.ContainerID), CreatedAt: createdAtText, UpdatedAt: updatedAtText, CreatedAtMS: createdAt, UpdatedAtMS: updatedAt, Layout: itemLayout, ContainerLayout: containerLayout, Icon: icon}, nil
}

func normalizeCollectionTarget(raw collectionTarget) (collectionTarget, error) {
	switch strings.TrimSpace(raw.Kind) {
	case "folder":
		path := strings.TrimSpace(raw.Path)
		if path == "" {
			return collectionTarget{}, errors.New("folder path is required")
		}
		return collectionTarget{Kind: "folder", Path: path}, nil
	case "file":
		path := strings.TrimSpace(raw.Path)
		if path == "" {
			return collectionTarget{}, errors.New("file path is required")
		}
		return collectionTarget{Kind: "file", Path: path}, nil
	case "url":
		rawURL := strings.TrimSpace(raw.URL)
		parsed, err := url.ParseRequestURI(rawURL)
		if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return collectionTarget{}, errors.New("valid http or https url is required")
		}
		return collectionTarget{Kind: "url", URL: rawURL}, nil
	default:
		return collectionTarget{}, errors.New("target kind must be folder, url, or file")
	}
}

func defaultItemName(target collectionTarget) string {
	switch target.Kind {
	case "url":
		parsed, err := url.Parse(target.URL)
		if err == nil && parsed.Host != "" {
			return parsed.Host
		}
		return target.URL
	case "folder", "file":
		return filepath.Base(filepath.Clean(target.Path))
	default:
		return ""
	}
}

func normalizeDesktopContainer(raw desktopContainer, groups []collectionGroup, allowNewID bool) (desktopContainer, error) {
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
	return desktopIconLayout{RowGap: defaultDesktopIconGap, ColumnGap: defaultDesktopIconGap, IconScale: defaultDesktopIconScale}
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
	activeID := strings.TrimSpace(raw.ActiveID)
	if activeID == "" {
		return nil, errors.New("active wallpaper preset id is required")
	}
	if len(raw.Presets) == 0 {
		return nil, errors.New("wallpaper presets are required")
	}
	presets := make([]desktopWallpaperPreset, 0, len(raw.Presets))
	seen := map[string]bool{}
	hasActive := false
	for index, preset := range raw.Presets {
		normalized, err := validateDesktopWallpaperPreset(preset)
		if err != nil {
			return nil, fmt.Errorf("wallpaper presets[%d]: %w", index, err)
		}
		if seen[normalized.ID] {
			return nil, fmt.Errorf("duplicate wallpaper preset id: %s", normalized.ID)
		}
		if normalized.ID == activeID {
			hasActive = true
		}
		seen[normalized.ID] = true
		presets = append(presets, normalized)
	}
	if !hasActive {
		return nil, fmt.Errorf("active wallpaper preset not found: %s", activeID)
	}
	return &desktopWallpaper{ActiveID: activeID, Presets: presets}, nil
}

func validateDesktopWallpaperPreset(raw desktopWallpaperPreset) (desktopWallpaperPreset, error) {
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		return desktopWallpaperPreset{}, errors.New("wallpaper preset id is required")
	}
	name := trimMax(raw.Name, 80)
	if name == "" {
		return desktopWallpaperPreset{}, errors.New("wallpaper preset name is required")
	}
	assetID := strings.TrimSpace(filepath.ToSlash(raw.AssetID))
	if !isSafeAssetID(assetID) || !strings.HasPrefix(assetID, wallpaperAssetsDir+"/") {
		return desktopWallpaperPreset{}, errors.New("valid wallpaper asset id is required")
	}
	view, err := validateDesktopWallpaperView(raw.View)
	if err != nil {
		return desktopWallpaperPreset{}, err
	}
	return desktopWallpaperPreset{ID: id, Name: name, AssetID: assetID, View: view}, nil
}

func validateDesktopWallpaperView(raw desktopWallpaperView) (desktopWallpaperView, error) {
	if raw.X < 0 || raw.X > 100 {
		return desktopWallpaperView{}, errors.New("wallpaper view x must be between 0 and 100")
	}
	if raw.Y < 0 || raw.Y > 100 {
		return desktopWallpaperView{}, errors.New("wallpaper view y must be between 0 and 100")
	}
	if raw.Scale < 1 || raw.Scale > 4 {
		return desktopWallpaperView{}, errors.New("wallpaper view scale must be between 1 and 4")
	}
	return desktopWallpaperView{X: roundFloat(raw.X, 2), Y: roundFloat(raw.Y, 2), Scale: roundFloat(raw.Scale, 2)}, nil
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
	case "item":
		return "item"
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

func hasGroup(groups []collectionGroup, id string) bool {
	for _, group := range groups {
		if group.ID == id {
			return true
		}
	}
	return false
}

func normalizeGroupID(raw string, groups []collectionGroup) (string, error) {
	id := safeID(raw, 32)
	if id == "" || !hasGroup(groups, id) {
		return "", errors.New("valid group id is required")
	}
	return id, nil
}

func nextPageOrder(doc collectionsDoc, groupID string) int64 {
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

func renumberPageOrder(doc *collectionsDoc, groupID string) {
	type entryRef struct {
		kind  string
		index int
		order int64
	}
	entries := []entryRef{}
	for i, item := range doc.Items {
		if item.GroupID == groupID && item.ContainerID == "" {
			entries = append(entries, entryRef{kind: "item", index: i, order: item.PageOrder})
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
		if entry.kind == "item" {
			doc.Items[entry.index].PageOrder = int64(order)
		} else {
			doc.Containers[entry.index].PageOrder = int64(order)
		}
	}
}

func uniqueCollectionItemID(items []collectionItem, seed int64) string {
	for offset := int64(0); ; offset++ {
		id := fmt.Sprintf("%d-copy-%d", seed, offset)
		if !hasCollectionItem(items, id) {
			return id
		}
	}
}

func hasCollectionItem(items []collectionItem, id string) bool {
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
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg":
		return true
	default:
		return false
	}
}

func imageExtFromDataURLMediaType(mediaType string) (string, error) {
	mediaType = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(mediaType, "data:")))
	mediaType = strings.TrimSuffix(mediaType, ";base64")
	switch mediaType {
	case "image/png":
		return ".png", nil
	case "image/jpeg", "image/jpg":
		return ".jpg", nil
	case "image/webp":
		return ".webp", nil
	case "image/gif":
		return ".gif", nil
	case "image/x-icon", "image/vnd.microsoft.icon", "image/ico":
		return ".ico", nil
	case "image/svg+xml":
		return ".svg", nil
	default:
		return "", errors.New("asset data URL image type is not supported")
	}
}

func validateAssetImageContent(payload []byte, ext string) error {
	switch ext {
	case ".webp":
		if len(payload) < 12 || string(payload[:4]) != "RIFF" || string(payload[8:12]) != "WEBP" {
			return errors.New("asset content is not a supported image")
		}
		return nil
	case ".ico":
		return validateICOImageContent(payload)
	case ".svg":
		return validateSVGImageContent(payload)
	}
	if _, _, err := image.DecodeConfig(bytes.NewReader(payload)); err != nil {
		return errors.New("asset content is not a supported image")
	}
	return nil
}

func validateICOImageContent(payload []byte) error {
	if len(payload) < 22 || payload[0] != 0 || payload[1] != 0 || payload[2] != 1 || payload[3] != 0 {
		return errors.New("asset content is not a supported image")
	}
	count := int(payload[4]) | int(payload[5])<<8
	if count <= 0 || count > 64 || len(payload) < 6+count*16 {
		return errors.New("asset content is not a supported image")
	}
	for index := 0; index < count; index++ {
		entry := 6 + index*16
		size := int(payload[entry+8]) | int(payload[entry+9])<<8 | int(payload[entry+10])<<16 | int(payload[entry+11])<<24
		offset := int(payload[entry+12]) | int(payload[entry+13])<<8 | int(payload[entry+14])<<16 | int(payload[entry+15])<<24
		if size <= 0 || offset < 6+count*16 || offset > len(payload) || size > len(payload)-offset {
			return errors.New("asset content is not a supported image")
		}
		if !isValidICOImagePayload(payload[offset : offset+size]) {
			return errors.New("asset content is not a supported image")
		}
	}
	return nil
}

func isValidICOImagePayload(payload []byte) bool {
	if len(payload) >= 8 && bytes.Equal(payload[:8], []byte("\x89PNG\r\n\x1a\n")) {
		_, _, err := image.DecodeConfig(bytes.NewReader(payload))
		return err == nil
	}
	if len(payload) < 16 {
		return false
	}
	headerSize := int(payload[0]) | int(payload[1])<<8 | int(payload[2])<<16 | int(payload[3])<<24
	if headerSize != 40 && headerSize != 108 && headerSize != 124 {
		return false
	}
	if len(payload) < headerSize {
		return false
	}
	width := int(payload[4]) | int(payload[5])<<8 | int(payload[6])<<16 | int(payload[7])<<24
	height := int(payload[8]) | int(payload[9])<<8 | int(payload[10])<<16 | int(payload[11])<<24
	planes := int(payload[12]) | int(payload[13])<<8
	bitsPerPixel := int(payload[14]) | int(payload[15])<<8
	return width > 0 && height > 0 && planes == 1 && bitsPerPixel > 0
}

func validateSVGImageContent(payload []byte) error {
	if len(bytes.TrimSpace(payload)) == 0 {
		return errors.New("asset content is not a supported image")
	}
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	rootSeen := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return errors.New("asset content is not a supported image")
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		name := strings.ToLower(start.Name.Local)
		if !rootSeen {
			if name != "svg" {
				return errors.New("asset content is not a supported image")
			}
			rootSeen = true
		}
		if isUnsafeSVGElement(name) {
			return errors.New("asset svg contains unsupported active content")
		}
		for _, attr := range start.Attr {
			if isUnsafeSVGAttribute(attr) {
				return errors.New("asset svg contains unsupported external content")
			}
		}
	}
	if !rootSeen {
		return errors.New("asset content is not a supported image")
	}
	return nil
}

func isUnsafeSVGElement(name string) bool {
	switch name {
	case "script", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas":
		return true
	default:
		return false
	}
}

func isUnsafeSVGAttribute(attr xml.Attr) bool {
	name := strings.ToLower(attr.Name.Local)
	value := strings.ToLower(strings.TrimSpace(attr.Value))
	if strings.HasPrefix(name, "on") {
		return true
	}
	if strings.Contains(value, "javascript:") {
		return true
	}
	if strings.Contains(value, "url(") && !strings.Contains(value, "url(#") {
		return true
	}
	if name == "href" || name == "src" {
		return value != "" && !strings.HasPrefix(value, "#")
	}
	if name == "style" {
		return strings.Contains(value, "url(")
	}
	return false
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
	command, err := openCommandForPath(path, runtime.GOOS, false)
	if err != nil {
		return err
	}
	return command.start()
}

type systemOpenCommand struct {
	Name string
	Args []string
}

func (command systemOpenCommand) start() error {
	if strings.TrimSpace(command.Name) == "" {
		return errors.New("open command is required")
	}
	return exec.Command(command.Name, command.Args...).Start()
}

func openCollectionTarget(target collectionTarget) error {
	command, err := openCommandForCollectionTarget(target, runtime.GOOS)
	if err != nil {
		return err
	}
	return command.start()
}

func openCommandForCollectionTarget(target collectionTarget, goos string) (systemOpenCommand, error) {
	normalized, err := normalizeCollectionTarget(target)
	if err != nil {
		return systemOpenCommand{}, err
	}
	switch normalized.Kind {
	case "folder":
		return openCommandForPath(normalized.Path, goos, true)
	case "file":
		return openCommandForPath(normalized.Path, goos, false)
	case "url":
		return openCommandForURL(normalized.URL, goos)
	default:
		return systemOpenCommand{}, fmt.Errorf("unsupported target kind: %s", normalized.Kind)
	}
}

func openCommandForPath(path string, goos string, folder bool) (systemOpenCommand, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return systemOpenCommand{}, errors.New("path is required")
	}
	switch goos {
	case "windows":
		if folder {
			return systemOpenCommand{Name: "explorer", Args: []string{path}}, nil
		}
		return systemOpenCommand{Name: "rundll32", Args: []string{"url.dll,FileProtocolHandler", path}}, nil
	case "darwin":
		return systemOpenCommand{Name: "open", Args: []string{path}}, nil
	default:
		return systemOpenCommand{Name: "xdg-open", Args: []string{path}}, nil
	}
}

func openCommandForURL(rawURL string, goos string) (systemOpenCommand, error) {
	target, err := normalizeCollectionTarget(collectionTarget{Kind: "url", URL: rawURL})
	if err != nil {
		return systemOpenCommand{}, err
	}
	switch goos {
	case "windows":
		return systemOpenCommand{Name: "rundll32", Args: []string{"url.dll,FileProtocolHandler", target.URL}}, nil
	case "darwin":
		return systemOpenCommand{Name: "open", Args: []string{target.URL}}, nil
	default:
		return systemOpenCommand{Name: "xdg-open", Args: []string{target.URL}}, nil
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

func generatedSafeID(prefix string, max int) string {
	id := fmt.Sprintf("%s-%d", safeID(prefix, 16), time.Now().UnixNano())
	return trimMax(id, max)
}

func clampFloat(value float64, min float64, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func roundFloat(value float64, precision int) float64 {
	factor := 1.0
	for i := 0; i < precision; i++ {
		factor *= 10
	}
	return float64(int(value*factor+0.5)) / factor
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
