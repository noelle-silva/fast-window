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

	"github.com/gorilla/websocket"
)

type service struct {
	dataDir     string
	stateDir    string
	libraryDir  string
	mu          sync.Mutex
	uploadTasks *assetUploadTaskStore
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
		return errors.New("hypercortex-backend missing FW_APP_SESSION_TOKEN")
	}

	svc, err := newService()
	if err != nil {
		return err
	}
	if err := svc.ensureRoots(); err != nil {
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
		dataDir = filepath.Join(mustGetwd(), "data")
	}
	dataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("解析数据目录失败: %w", err)
	}

	stateDir := filepath.Join(dataDir, stateDirName)
	libraryDir := filepath.Join(dataDir, libraryDirName)
	libraryDir, err = filepath.Abs(libraryDir)
	if err != nil {
		return nil, fmt.Errorf("解析知识库目录失败: %w", err)
	}
	stateDir, err = filepath.Abs(stateDir)
	if err != nil {
		return nil, fmt.Errorf("解析状态目录失败: %w", err)
	}

	return &service{dataDir: dataDir, stateDir: stateDir, libraryDir: libraryDir, uploadTasks: newAssetUploadTaskStore()}, nil
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
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
			err = fmt.Errorf("请求处理异常：%v", recovered)
		}
	}()
	return svc.dispatch(method, params)
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

func (svc *service) ensureRoots() error {
	for _, dir := range []string{svc.dataDir, svc.stateDir, svc.libraryDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	if err := svc.runDataMigrations(); err != nil {
		return err
	}
	for _, dir := range []string{notesDir, assetsDir, trashDir, filepath.Join(assetsDir, "images"), filepath.Join(assetsDir, "videos"), filepath.Join(assetsDir, "docs")} {
		if err := os.MkdirAll(filepath.Join(svc.libraryDir, dir), 0o755); err != nil {
			return err
		}
	}
	return nil
}

func (svc *service) dispatch(method string, params json.RawMessage) (any, error) {
	if result, handled, err := svc.dispatchAssetUploadTask(method, params); handled {
		return result, err
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()

	switch method {
	case "hypercortex.metadata.tryLoad":
		return svc.tryLoadJSON("data", metadataFile)
	case "hypercortex.metadata.ensure":
		return svc.ensureJSON("data", metadataFile, map[string]any{"version": 1})
	case "hypercortex.metadata.save":
		payload := map[string]json.RawMessage{}
		_ = json.Unmarshal(params, &payload)
		return nil, svc.writeRawJSON("data", metadataFile, payload["meta"])

	case "hypercortex.favorites.tryLoad":
		return svc.tryLoadJSON("data", favoritesFile)
	case "hypercortex.favorites.ensure":
		return svc.ensureFavorites()
	case "hypercortex.favorites.save":
		payload := map[string]json.RawMessage{}
		_ = json.Unmarshal(params, &payload)
		return nil, svc.writeRawJSON("data", favoritesFile, payload["doc"])

	case "hypercortex.notes.loadIndex":
		return svc.loadNoteIndex(requireScope(params))
	case "hypercortex.notes.rebuildIndex":
		return svc.rebuildNoteIndex(requireScope(params))
	case "hypercortex.notes.create", "hypercortex.notes.savePackage":
		return svc.saveNotePackage(requireScope(params), rawField(params, "input"))
	case "hypercortex.notes.loadPackage":
		return svc.loadNotePackage(requireScope(params), stringField(params, "packageDir"))
	case "hypercortex.notes.loadManifest":
		return svc.loadNoteManifest(requireScope(params), stringField(params, "packageDir"))
	case "hypercortex.notes.tryReadManifest":
		manifest, err := svc.loadNoteManifest(requireScope(params), stringField(params, "packageDir"))
		if err != nil {
			return nil, nil
		}
		return manifest, nil
	case "hypercortex.notes.loadFace":
		return svc.loadNoteFace(requireScope(params), stringField(params, "packageDir"), stringField(params, "faceId"))
	case "hypercortex.notes.saveFace":
		return svc.saveNoteFace(requireScope(params), rawField(params, "input"))
	case "hypercortex.notes.deleteFace":
		return svc.deleteNoteFace(requireScope(params), stringField(params, "packageDir"), stringField(params, "faceId"))
	case "hypercortex.notes.loadHtmlFace":
		return svc.loadHTMLFace(requireScope(params), stringField(params, "packageDir"))
	case "hypercortex.notes.saveHtmlFace":
		return svc.saveHTMLFace(requireScope(params), rawField(params, "input"))
	case "hypercortex.notes.deleteHtmlFace":
		return svc.deleteHTMLFace(requireScope(params), stringField(params, "packageDir"))
	case "hypercortex.notes.saveHtmlFaceFixedScale":
		return nil, svc.saveHTMLFaceFixedScale(requireScope(params), stringField(params, "packageDir"), rawField(params, "fixedScale"))

	case "hypercortex.assets.ensureIndex":
		return svc.ensureAssetIndex(requireScope(params))
	case "hypercortex.assets.list":
		return svc.listAssets(requireScope(params))
	case "hypercortex.assets.readDataUrl":
		return svc.readAssetDataURL(requireScope(params), stringField(params, "assetId"), optionalStringField(params, "ext"))
	case "hypercortex.assets.delete":
		return nil, svc.deleteAsset(requireScope(params), stringField(params, "assetId"), optionalStringField(params, "ext"))
	case "hypercortex.assets.getThumbnail":
		return svc.getAssetThumbnail(requireScope(params), stringField(params, "assetId"), optionalStringField(params, "ext"), intField(params, "width"), intField(params, "height"), false)
	case "hypercortex.assets.rebuildThumbnail":
		return svc.rebuildAssetThumbnail(requireScope(params), stringField(params, "assetId"), optionalStringField(params, "ext"), intField(params, "width"), intField(params, "height"))
	case "hypercortex.assets.rebuildAllThumbnails":
		return svc.rebuildAllThumbnails(requireScope(params), intField(params, "width"), intField(params, "height"))
	case "hypercortex.assets.getVideoThumbnail":
		result, err := svc.getAssetThumbnailByRelPath(requireScope(params), stringField(params, "path"), intField(params, "width"), intField(params, "height"), false)
		if err != nil {
			return nil, err
		}
		return result.DataURL, nil

	case "hypercortex.refs.loadIndex":
		return svc.loadRefIndex(requireScope(params))
	case "hypercortex.refs.saveIndex":
		return nil, svc.writeRawJSON(requireScope(params), refsIndexFile, rawField(params, "idx"))
	case "hypercortex.refs.updateForNote":
		return nil, svc.updateRefsForNote(requireScope(params), stringField(params, "noteId"), stringField(params, "body"))
	case "hypercortex.refs.removeNote":
		return nil, svc.removeNoteRef(requireScope(params), stringField(params, "noteId"))

	case "hypercortex.trash.list":
		return svc.listTrash(requireScope(params))
	case "hypercortex.trash.moveNote":
		return svc.moveNoteToTrash(requireScope(params), rawField(params, "note"))
	case "hypercortex.trash.permanentlyDeleteNoteDir":
		return nil, svc.permanentlyDeleteNoteDir(requireScope(params), stringField(params, "noteId"), stringField(params, "dir"))
	case "hypercortex.trash.restore":
		return svc.restoreTrashItem(requireScope(params), rawField(params, "item"))
	case "hypercortex.trash.maybeAutoCleanup":
		return svc.maybeAutoCleanupTrash(requireScope(params), numberField(params, "days"))

	case "hypercortex.host.getLibraryDir":
		return svc.libraryDir, nil
	case "hypercortex.host.openDir":
		return nil, svc.openDir(stringField(params, "dir"))
	case "hypercortex.host.importLegacyData":
		return svc.importLegacyData(stringField(params, "dir"))
	default:
		return nil, fmt.Errorf("未知请求：%s", method)
	}
}
