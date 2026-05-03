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
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const defaultGroupID = "default"

type bookmarkGroup struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
}

type bookmarkItem struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	URL          string `json:"url"`
	IconURL      string `json:"iconUrl,omitempty"`
	GroupID      string `json:"groupId"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	LastOpenedAt *int64 `json:"lastOpenedAt"`
}

type bookmarkData struct {
	SchemaVersion int             `json:"schemaVersion"`
	Groups        []bookmarkGroup `json:"groups"`
	Items         []bookmarkItem  `json:"items"`
}

type rawBookmarkItem struct {
	ID           any `json:"id"`
	Title        any `json:"title"`
	URL          any `json:"url"`
	IconURL      any `json:"iconUrl"`
	IconDataURL  any `json:"iconDataUrl"`
	GroupID      any `json:"groupId"`
	CreatedAt    any `json:"createdAt"`
	UpdatedAt    any `json:"updatedAt"`
	LastOpenedAt any `json:"lastOpenedAt"`
}

type rawBookmarkGroup struct {
	ID        any `json:"id"`
	Name      any `json:"name"`
	CreatedAt any `json:"createdAt"`
}

type rawBookmarkData struct {
	Groups []rawBookmarkGroup `json:"groups"`
	Items  []rawBookmarkItem  `json:"items"`
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

type service struct {
	dataFile string
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
		return errors.New("bookmarks-backend missing FW_APP_SESSION_TOKEN")
	}

	svc := &service{dataFile: resolveDataFilePath()}
	if _, err := svc.load(); err != nil {
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

func resolveDataFilePath() string {
	dataDir := strings.TrimSpace(os.Getenv("FW_APP_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(mustGetwd(), "data")
	}
	return filepath.Join(dataDir, "data.json")
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
	case "bookmarks.list":
		return svc.load()
	case "bookmarks.inferIcon":
		payload := map[string]any{}
		_ = json.Unmarshal(params, &payload)
		return map[string]string{"iconUrl": inferIconURL(payload["url"])}, nil
	case "bookmarks.add":
		return svc.addBookmark(params)
	case "bookmarks.update":
		return svc.updateBookmark(params)
	case "bookmarks.delete":
		return svc.deleteBookmark(params)
	case "bookmarks.open":
		return svc.openBookmark(params)
	case "bookmarks.refreshIcon":
		return svc.refreshIcon(params)
	case "bookmarks.addGroup":
		return svc.addGroup(params)
	case "bookmarks.renameGroup":
		return svc.renameGroup(params)
	case "bookmarks.deleteGroup":
		return svc.deleteGroup(params)
	default:
		return nil, fmt.Errorf("未知请求：%s", method)
	}
}

func (svc *service) load() (bookmarkData, error) {
	if err := os.MkdirAll(filepath.Dir(svc.dataFile), 0o755); err != nil {
		return bookmarkData{}, err
	}
	rawBytes, err := os.ReadFile(svc.dataFile)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return bookmarkData{}, err
	}
	if errors.Is(err, os.ErrNotExist) || strings.TrimSpace(string(rawBytes)) == "" {
		data := normalizeData(nil)
		return data, svc.save(data)
	}

	var raw rawBookmarkData
	if err := json.Unmarshal(rawBytes, &raw); err != nil {
		return bookmarkData{}, err
	}
	return normalizeData(&raw), nil
}

func (svc *service) save(data bookmarkData) error {
	if err := os.MkdirAll(filepath.Dir(svc.dataFile), 0o755); err != nil {
		return err
	}
	normalized := normalizeDataFromData(data)
	payload, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return os.WriteFile(svc.dataFile, payload, 0o644)
}

func normalizeData(raw *rawBookmarkData) bookmarkData {
	now := nowMs()
	base := bookmarkData{
		SchemaVersion: 1,
		Groups:        []bookmarkGroup{{ID: defaultGroupID, Name: "默认", CreatedAt: now}},
		Items:         []bookmarkItem{},
	}
	if raw == nil {
		return base
	}

	groups := make([]bookmarkGroup, 0, len(raw.Groups)+1)
	seenDefault := false
	for _, group := range raw.Groups {
		id := strings.TrimSpace(asString(group.ID))
		name := strings.TrimSpace(asString(group.Name))
		if id == "" || name == "" {
			continue
		}
		if id == defaultGroupID {
			seenDefault = true
		}
		groups = append(groups, bookmarkGroup{ID: id, Name: name, CreatedAt: asInt64Or(group.CreatedAt, now)})
	}
	if !seenDefault {
		groups = append([]bookmarkGroup{{ID: defaultGroupID, Name: "默认", CreatedAt: now}}, groups...)
	}

	groupIDs := map[string]bool{}
	for _, group := range groups {
		groupIDs[group.ID] = true
	}

	items := make([]bookmarkItem, 0, len(raw.Items))
	for _, item := range raw.Items {
		itemURL := normalizeURL(item.URL)
		id := strings.TrimSpace(asString(item.ID))
		if id == "" || itemURL == "" {
			continue
		}
		groupID := asString(item.GroupID)
		if !groupIDs[groupID] {
			groupID = defaultGroupID
		}
		iconURL := strings.TrimSpace(asString(item.IconURL))
		if iconURL == "" {
			iconURL = strings.TrimSpace(asString(item.IconDataURL))
		}
		lastOpened := asNullableInt64(item.LastOpenedAt)
		items = append(items, bookmarkItem{
			ID:           id,
			Title:        strings.TrimSpace(asString(item.Title)),
			URL:          itemURL,
			IconURL:      iconURL,
			GroupID:      groupID,
			CreatedAt:    asInt64Or(item.CreatedAt, now),
			UpdatedAt:    asInt64Or(item.UpdatedAt, now),
			LastOpenedAt: lastOpened,
		})
	}
	sortItems(items)

	return bookmarkData{SchemaVersion: 1, Groups: groups, Items: items}
}

func normalizeDataFromData(data bookmarkData) bookmarkData {
	raw := rawBookmarkData{Groups: make([]rawBookmarkGroup, 0, len(data.Groups)), Items: make([]rawBookmarkItem, 0, len(data.Items))}
	for _, group := range data.Groups {
		raw.Groups = append(raw.Groups, rawBookmarkGroup{ID: group.ID, Name: group.Name, CreatedAt: group.CreatedAt})
	}
	for _, item := range data.Items {
		raw.Items = append(raw.Items, rawBookmarkItem{ID: item.ID, Title: item.Title, URL: item.URL, IconURL: item.IconURL, GroupID: item.GroupID, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt, LastOpenedAt: item.LastOpenedAt})
	}
	return normalizeData(&raw)
}

func sortItems(items []bookmarkItem) {
	sort.SliceStable(items, func(i, j int) bool {
		return sortTime(items[i]) > sortTime(items[j])
	})
}

func sortTime(item bookmarkItem) int64 {
	if item.LastOpenedAt != nil {
		return *item.LastOpenedAt
	}
	if item.UpdatedAt != 0 {
		return item.UpdatedAt
	}
	return item.CreatedAt
}

func (svc *service) addBookmark(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	itemURL := normalizeURL(payload["url"])
	if itemURL == "" {
		return data, errors.New("URL 只支持 http(s)://，可省略协议")
	}
	groupID, err := ensureGroup(data, payload["groupId"])
	if err != nil {
		return data, err
	}
	t := nowMs()
	iconURL := strings.TrimSpace(asString(payload["iconUrl"]))
	if iconURL == "" {
		iconURL = inferIconURL(itemURL)
	}
	title := strings.TrimSpace(asString(payload["title"]))
	if title == "" {
		title = itemURL
	}
	data.Items = append([]bookmarkItem{{ID: uid(), Title: title, URL: itemURL, IconURL: iconURL, GroupID: groupID, CreatedAt: t, UpdatedAt: t}}, data.Items...)
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) updateBookmark(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	id := strings.TrimSpace(asString(payload["id"]))
	idx := findItem(data.Items, id)
	if idx < 0 {
		return data, errors.New("条目不存在")
	}
	itemURL := normalizeURL(payload["url"])
	if itemURL == "" {
		return data, errors.New("URL 只支持 http(s)://，可省略协议")
	}
	groupID, err := ensureGroup(data, payload["groupId"])
	if err != nil {
		return data, err
	}
	iconURL := strings.TrimSpace(asString(payload["iconUrl"]))
	if iconURL == "" {
		iconURL = inferIconURL(itemURL)
	}
	title := strings.TrimSpace(asString(payload["title"]))
	if title == "" {
		title = itemURL
	}
	data.Items[idx].Title = title
	data.Items[idx].URL = itemURL
	data.Items[idx].GroupID = groupID
	data.Items[idx].IconURL = iconURL
	data.Items[idx].UpdatedAt = nowMs()
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) deleteBookmark(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	id := strings.TrimSpace(asString(payload["id"]))
	items := data.Items[:0]
	for _, item := range data.Items {
		if item.ID != id {
			items = append(items, item)
		}
	}
	data.Items = items
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) openBookmark(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	id := strings.TrimSpace(asString(payload["id"]))
	idx := findItem(data.Items, id)
	if idx < 0 {
		return data, errors.New("条目不存在")
	}
	itemURL := normalizeURL(data.Items[idx].URL)
	if itemURL == "" {
		return data, errors.New("URL 不合法")
	}
	if err := openURL(itemURL); err != nil {
		return data, err
	}
	t := nowMs()
	data.Items[idx].URL = itemURL
	data.Items[idx].UpdatedAt = t
	data.Items[idx].LastOpenedAt = &t
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) refreshIcon(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	id := strings.TrimSpace(asString(payload["id"]))
	idx := findItem(data.Items, id)
	if idx < 0 {
		return data, errors.New("条目不存在")
	}
	data.Items[idx].IconURL = inferIconURL(data.Items[idx].URL)
	data.Items[idx].UpdatedAt = nowMs()
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) addGroup(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	name := strings.TrimSpace(asString(payload["name"]))
	if err := ensureUniqueGroupName(data, name, ""); err != nil {
		return data, err
	}
	data.Groups = append(data.Groups, bookmarkGroup{ID: uid(), Name: name, CreatedAt: nowMs()})
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) renameGroup(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	groupID := strings.TrimSpace(asString(payload["groupId"]))
	if groupID == defaultGroupID {
		return data, errors.New("默认分组不可重命名")
	}
	idx := findGroup(data.Groups, groupID)
	if idx < 0 {
		return data, errors.New("分组不存在")
	}
	name := strings.TrimSpace(asString(payload["name"]))
	if err := ensureUniqueGroupName(data, name, groupID); err != nil {
		return data, err
	}
	data.Groups[idx].Name = name
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func (svc *service) deleteGroup(params json.RawMessage) (bookmarkData, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(params, &payload)
	data, err := svc.load()
	if err != nil {
		return data, err
	}
	groupID := strings.TrimSpace(asString(payload["groupId"]))
	if groupID == defaultGroupID {
		return data, errors.New("默认分组不可删除")
	}
	groups := data.Groups[:0]
	for _, group := range data.Groups {
		if group.ID != groupID {
			groups = append(groups, group)
		}
	}
	data.Groups = groups
	for idx := range data.Items {
		if data.Items[idx].GroupID == groupID {
			data.Items[idx].GroupID = defaultGroupID
		}
	}
	if err := svc.save(data); err != nil {
		return data, err
	}
	return svc.load()
}

func ensureGroup(data bookmarkData, groupIDRaw any) (string, error) {
	groupID := strings.TrimSpace(asString(groupIDRaw))
	if groupID == "" {
		groupID = defaultGroupID
	}
	if findGroup(data.Groups, groupID) < 0 {
		return "", errors.New("分组不存在")
	}
	return groupID, nil
}

func ensureUniqueGroupName(data bookmarkData, name string, exceptID string) error {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return errors.New("分组名不能为空")
	}
	for _, group := range data.Groups {
		if group.ID != exceptID && strings.ToLower(strings.TrimSpace(group.Name)) == lower {
			return errors.New("分组名已存在")
		}
	}
	return nil
}

func findItem(items []bookmarkItem, id string) int {
	for idx, item := range items {
		if item.ID == id {
			return idx
		}
	}
	return -1
}

func findGroup(groups []bookmarkGroup, id string) int {
	for idx, group := range groups {
		if group.ID == id {
			return idx
		}
	}
	return -1
}

func normalizeURL(raw any) string {
	input := strings.TrimSpace(asString(raw))
	if input == "" {
		return ""
	}
	candidate := strings.ReplaceAll(input, "\\", "/")
	if strings.HasPrefix(candidate, "//") {
		candidate = "https:" + candidate
	} else if !hasScheme(candidate) {
		candidate = "https://" + candidate
	}
	parsed, err := url.Parse(candidate)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	return parsed.String()
}

func inferIconURL(raw any) string {
	normalized := normalizeURL(raw)
	if normalized == "" {
		return ""
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host + "/favicon.ico"
}

func hasScheme(value string) bool {
	for idx, ch := range value {
		if ch == ':' {
			return idx > 0
		}
		if !(ch >= 'a' && ch <= 'z') && !(ch >= 'A' && ch <= 'Z') && !(idx > 0 && ch >= '0' && ch <= '9') && ch != '+' && ch != '-' && ch != '.' {
			return false
		}
	}
	return false
}

func openURL(target string) error {
	if !strings.HasPrefix(strings.ToLower(target), "http://") && !strings.HasPrefix(strings.ToLower(target), "https://") {
		return errors.New("URL 不合法")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", target)
	case "darwin":
		cmd = exec.Command("open", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	return cmd.Start()
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

func uid() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", nowMs())
	}
	return fmt.Sprintf("%d_%s", nowMs(), hex.EncodeToString(buf))
}

func asString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case json.Number:
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(v, 10)
	case *int64:
		if v == nil {
			return ""
		}
		return strconv.FormatInt(*v, 10)
	default:
		return fmt.Sprint(v)
	}
}

func asInt64Or(value any, fallback int64) int64 {
	if parsed, ok := asInt64(value); ok {
		return parsed
	}
	return fallback
}

func asNullableInt64(value any) *int64 {
	if parsed, ok := asInt64(value); ok {
		return &parsed
	}
	return nil
}

func asInt64(value any) (int64, bool) {
	switch v := value.(type) {
	case nil:
		return 0, false
	case int64:
		return v, true
	case float64:
		if v == v {
			return int64(v), true
		}
	case json.Number:
		if parsed, err := v.Int64(); err == nil {
			return parsed, true
		}
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
			return parsed, true
		}
	case *int64:
		if v != nil {
			return *v, true
		}
	}
	return 0, false
}
