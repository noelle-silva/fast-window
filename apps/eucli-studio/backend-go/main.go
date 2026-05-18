package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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
	SchemaVersion int            `json:"schemaVersion"`
	State         map[string]any `json:"state"`
	Conversations []conversation `json:"conversations"`
	Providers     []provider     `json:"providers"`
	UpdatedAt     int64          `json:"updatedAt"`
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
	dataDir string
	ai      *aiRunQueue
}

type storedImage struct {
	RelPath string `json:"relPath"`
	Path    string `json:"path"`
	MIME    string `json:"mime"`
	Size    int    `json:"size"`
}

var imageDataURLPattern = regexp.MustCompile(`^data:(image/[a-zA-Z0-9.+-]+);base64,`)

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

	svc := newService(resolveDataDir())
	if err := svc.runMigrations(); err != nil {
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

func resolveDataDir() string {
	dataDir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(mustGetwd(), "data")
	}
	return dataDir
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
		return svc.storageGetByKey("studio/state")
	case "studio.state.save":
		return svc.saveStateCompat(params)
	case "studio.conversation.list":
		return []any{}, nil
	case "studio.conversation.create":
		return nil, errors.New("studio.conversation.create is superseded by aiChat split storage")
	case "studio.conversation.update":
		return nil, errors.New("studio.conversation.update is superseded by aiChat split storage")
	case "studio.conversation.delete":
		return nil, errors.New("studio.conversation.delete is superseded by aiChat split storage")
	case "studio.provider.list":
		return svc.bootstrapProviderList()
	case "studio.provider.save":
		return nil, errors.New("studio.provider.save is superseded by aiChat split storage")
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
	case "aiChat.imageRead":
		return svc.imageRead(params)
	case "aiChat.imageWrite":
		return svc.imageWrite(params)
	case "aiChat.imageDelete":
		return svc.imageDelete(params)
	case "aiChat.imagePick":
		return nil, errors.New("NOT_IMPLEMENTED: imagePick must be handled by UI host capability")
	case "aiChat.netRequest":
		return svc.netRequest(params)
	case "aiChat.submitChatCompletion":
		return svc.submitChatCompletion(params)
	case "aiChat.submitManyChatCompletions":
		return svc.submitManyChatCompletions(params)
	case "aiChat.submitRawServiceRequest":
		return svc.submitRawServiceRequest(params)
	case "aiChat.waitServiceFinal":
		return svc.waitServiceFinal(params)
	case "aiChat.cancelAssistant":
		return svc.cancelAssistant(params)
	case "aiChat.readAssistantStream":
		return svc.readAssistantStream(params)
	case "aiChat.consumeAssistantFinal":
		return svc.consumeAssistantFinal(params)
	case "aiChat.resetAssistantRuntime":
		return svc.resetAssistantRuntime(params)
	default:
		return nil, fmt.Errorf("未知请求：%s", method)
	}
}

func (svc *service) bootstrap() (map[string]any, error) {
	metaValue, err := svc.storageGetByKey("meta/index")
	if err != nil {
		return nil, err
	}
	meta, _ := metaValue.(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	providers, err := svc.loadProviders()
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"schemaVersion": aiStudioDataVersion,
		"state":         map[string]any{},
		"conversations": []any{},
		"providers":     providers,
		"dataFile":      svc.dataDir,
		"storageDir":    svc.dataDir,
		"updatedAt":     asInt64(meta["updatedAt"], 0),
	}, nil
}

func (svc *service) bootstrapProviderList() ([]any, error) {
	return svc.loadProviders()
}

func (svc *service) saveStateCompat(params json.RawMessage) (map[string]bool, error) {
	var payload map[string]any
	if err := json.Unmarshal(params, &payload); err != nil {
		return nil, err
	}
	state, ok := payload["state"]
	if !ok {
		state = payload
	}
	data, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	return svc.storageSet(json.RawMessage(fmt.Sprintf(`{"key":"studio/state","value":%s}`, string(data))))
}

func (svc *service) load() (studioData, error) {
	legacyFile := svc.legacyStudioFilePath()
	if err := os.MkdirAll(filepath.Dir(legacyFile), 0o755); err != nil {
		return studioData{}, err
	}
	rawBytes, err := os.ReadFile(legacyFile)
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
	legacyFile := svc.legacyStudioFilePath()
	if err := os.MkdirAll(filepath.Dir(legacyFile), 0o755); err != nil {
		return err
	}
	normalized := normalizeData(data)
	normalized.UpdatedAt = nowMs()
	payload, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return atomicWriteFile(legacyFile, payload, 0o644)
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
	key := requestKey(params)
	return svc.storageGetByKey(key)
}

func (svc *service) storageGetByKey(key string) (any, error) {
	path, err := svc.storagePathForKey(key)
	if err != nil {
		return nil, err
	}
	rawBytes, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var box map[string]json.RawMessage
	if err := json.Unmarshal(rawBytes, &box); err == nil {
		if rawValue, ok := box["value"]; ok {
			var value any
			if err := json.Unmarshal(rawValue, &value); err != nil {
				return nil, err
			}
			return value, nil
		}
	}
	var value any
	if err := json.Unmarshal(rawBytes, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func (svc *service) storageSet(params json.RawMessage) (map[string]bool, error) {
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	key := strings.TrimSpace(asString(payload["key"]))
	path, err := svc.storagePathForKey(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	value, err := svc.prepareStorageValueForSet(key, payload["value"])
	if err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	data = append(data, '\n')
	return map[string]bool{"ok": true}, atomicWriteFile(path, data, 0o644)
}

func (svc *service) storageRemove(params json.RawMessage) (map[string]bool, error) {
	key := requestKey(params)
	path, err := svc.storagePathForKey(key)
	if err != nil {
		return nil, err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
}

func (svc *service) imageRead(params json.RawMessage) (string, error) {
	path, _, err := svc.imagePathFromRequest(params)
	if err != nil {
		return "", err
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	mime := imageMimeFromExt(filepath.Ext(path))
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(payload), nil
}

func (svc *service) imageWrite(params json.RawMessage) (storedImage, error) {
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	dataURL := strings.TrimSpace(firstNonEmptyString(payload["dataUrlOrBase64"], payload["dataUrl"], payload["base64"]))
	if dataURL == "" {
		return storedImage{}, errors.New("dataUrl is required")
	}
	mime, raw, err := decodeImageDataURL(dataURL)
	if err != nil {
		return storedImage{}, err
	}
	relPath := strings.TrimSpace(firstNonEmptyString(payload["relPath"], payload["path"]))
	if relPath == "" {
		relPath = randomImageName(imageExtFromMime(mime))
	}
	path, safeRel, err := svc.imagePathForRel(relPath)
	if err != nil {
		return storedImage{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return storedImage{}, err
	}
	if !truthy(payload["overwrite"]) {
		if _, statErr := os.Stat(path); statErr == nil {
			return storedImage{}, errors.New("image already exists")
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return storedImage{}, statErr
		}
	}
	if err := atomicWriteFile(path, raw, 0o644); err != nil {
		return storedImage{}, err
	}
	return storedImage{RelPath: safeRel, Path: safeRel, MIME: mime, Size: len(raw)}, nil
}

func (svc *service) imageDelete(params json.RawMessage) (map[string]bool, error) {
	path, _, err := svc.imagePathFromRequest(params)
	if err != nil {
		return nil, err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
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

func (svc *service) legacyStudioFilePath() string {
	return filepath.Join(svc.dataDir, "studio.json")
}

func (svc *service) storageDir() string {
	return svc.dataDir
}

func (svc *service) runtimeStorageDir() string {
	return filepath.Join(svc.dataDir, "runtime")
}

func (svc *service) storagePathForKey(key string) (string, error) {
	cleanKey, runtime, err := cleanStorageKey(key)
	if err != nil {
		return "", err
	}
	baseDir := svc.storageDir()
	if runtime {
		baseDir = svc.runtimeStorageDir()
	}
	return safeJoin(baseDir, filepath.FromSlash(cleanKey)+".json")
}

func cleanStorageKey(raw string) (string, bool, error) {
	key := strings.TrimSpace(raw)
	if key == "" {
		return "", false, errors.New("key is required")
	}
	if len(key) > 600 {
		return "", false, errors.New("storage key is too long")
	}
	if strings.Contains(key, "\\") || strings.ContainsRune(key, 0) || strings.HasPrefix(key, "/") {
		return "", false, errors.New("storage key is invalid")
	}
	runtime := false
	if strings.HasPrefix(key, "runtime/") {
		runtime = true
		key = strings.TrimPrefix(key, "runtime/")
	}
	parts := strings.Split(key, "/")
	for _, part := range parts {
		segment := strings.TrimSpace(part)
		if segment == "" || segment == "." || segment == ".." {
			return "", false, errors.New("storage key has invalid path segment")
		}
	}
	return key, runtime, nil
}

func (svc *service) imagePathFromRequest(params json.RawMessage) (string, string, error) {
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	relPath := strings.TrimSpace(firstNonEmptyString(payload["path"], payload["relPath"]))
	if relPath == "" {
		return "", "", errors.New("path is required")
	}
	return svc.imagePathForRel(relPath)
}

func (svc *service) imagePathForRel(raw string) (string, string, error) {
	relPath, err := cleanImageRelPath(raw)
	if err != nil {
		return "", "", err
	}
	path, err := safeJoin(svc.storageDir(), filepath.FromSlash(relPath))
	return path, relPath, err
}

func cleanImageRelPath(raw string) (string, error) {
	relPath := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if relPath == "" {
		return "", errors.New("image path is required")
	}
	if len(relPath) > 600 || strings.HasPrefix(relPath, "/") || strings.ContainsRune(relPath, 0) {
		return "", errors.New("image path is invalid")
	}
	parts := strings.Split(relPath, "/")
	for _, part := range parts {
		segment := strings.TrimSpace(part)
		if segment == "" || segment == "." || segment == ".." {
			return "", errors.New("image path has invalid path segment")
		}
	}
	ext := strings.ToLower(filepath.Ext(relPath))
	if !isAllowedImageExt(ext) {
		return "", fmt.Errorf("unsupported image extension: %s", ext)
	}
	return relPath, nil
}

func safeJoin(baseDir string, relPath string) (string, error) {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	fullAbs, err := filepath.Abs(filepath.Join(baseAbs, relPath))
	if err != nil {
		return "", err
	}
	baseClean := filepath.Clean(baseAbs)
	fullClean := filepath.Clean(fullAbs)
	if fullClean != baseClean && !strings.HasPrefix(fullClean, baseClean+string(os.PathSeparator)) {
		return "", errors.New("path traversal detected")
	}
	return fullClean, nil
}

func atomicWriteFile(path string, payload []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d", path, nowMs())
	if err := os.WriteFile(tmp, payload, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			_ = os.Remove(tmp)
			return removeErr
		}
		if renameErr := os.Rename(tmp, path); renameErr != nil {
			_ = os.Remove(tmp)
			return renameErr
		}
	}
	return nil
}

func decodeImageDataURL(dataURL string) (string, []byte, error) {
	match := imageDataURLPattern.FindStringSubmatch(dataURL)
	if len(match) != 2 {
		return "", nil, errors.New("invalid image data URL")
	}
	mime := strings.ToLower(match[1])
	if !isAllowedImageMime(mime) {
		return "", nil, fmt.Errorf("unsupported image MIME: %s", mime)
	}
	encoded := strings.TrimSpace(strings.TrimPrefix(dataURL, match[0]))
	reader := base64.NewDecoder(base64.StdEncoding, strings.NewReader(encoded))
	payload, err := io.ReadAll(reader)
	if err != nil {
		return "", nil, err
	}
	if len(payload) == 0 {
		return "", nil, errors.New("image payload is empty")
	}
	return mime, payload, nil
}

func isAllowedImageExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp":
		return true
	default:
		return false
	}
}

func isAllowedImageMime(mime string) bool {
	switch strings.ToLower(mime) {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/bmp":
		return true
	default:
		return false
	}
}

func imageMimeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	default:
		return "application/octet-stream"
	}
}

func imageExtFromMime(mime string) string {
	switch strings.ToLower(mime) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	case "image/bmp":
		return ".bmp"
	default:
		return ".png"
	}
}

func randomImageName(ext string) string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("image-%d%s", nowMs(), ext)
	}
	return fmt.Sprintf("%x%s", buf, ext)
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

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(asString(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func truthy(raw any) bool {
	switch value := raw.(type) {
	case bool:
		return value
	case string:
		text := strings.TrimSpace(strings.ToLower(value))
		return text == "true" || text == "1" || text == "yes"
	case float64:
		return value != 0
	case int:
		return value != 0
	default:
		return false
	}
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
