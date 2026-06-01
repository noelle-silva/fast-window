package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

func nowMs() float64 {
	return float64(time.Now().UnixMilli())
}

func scopeRoot(svc *service, scope string) (string, error) {
	switch scope {
	case "library":
		return svc.libraryDir, nil
	case "data":
		return svc.stateDir, nil
	default:
		return "", fmt.Errorf("非法 scope：%s", scope)
	}
}

func cleanRelPath(input string) (string, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return "", nil
	}
	if strings.ContainsRune(raw, 0) {
		return "", errors.New("路径包含非法空字节")
	}
	raw = strings.ReplaceAll(raw, "\\", "/")
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return "", errors.New("不允许绝对路径")
	}
	if len(raw) >= 2 && raw[1] == ':' {
		return "", errors.New("不允许 Windows 盘符路径")
	}
	parts := []string{}
	for _, part := range strings.Split(raw, "/") {
		part = strings.TrimSpace(part)
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", errors.New("不允许路径越界")
		}
		parts = append(parts, part)
	}
	if len(parts) == 0 {
		return "", nil
	}
	return filepath.Join(parts...), nil
}

func (svc *service) resolvePath(scope string, rel string) (string, error) {
	root, err := scopeRoot(svc, scope)
	if err != nil {
		return "", err
	}
	clean, err := cleanRelPath(rel)
	if err != nil {
		return "", err
	}
	target := root
	if clean != "" {
		target = filepath.Join(root, clean)
	}
	if !isInside(root, target) {
		return "", errors.New("路径越界")
	}
	return target, nil
}

func isInside(parent string, child string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	if err != nil {
		return false
	}
	return rel == "." || (rel != "" && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func ensureParent(path string) error {
	return os.MkdirAll(filepath.Dir(path), 0o755)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readJSONFile(path string, out any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		return os.ErrNotExist
	}
	return json.Unmarshal(raw, out)
}

func writeJSONFile(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return writeFileAtomic(path, payload)
}

func writeRawJSONFile(path string, raw json.RawMessage) error {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" {
		return errors.New("JSON 内容为空")
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	return writeJSONFile(path, value)
}

func writeFileAtomic(path string, data []byte) error {
	if err := ensureParent(path); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (svc *service) tryLoadJSON(scope string, rel string) (any, error) {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return nil, err
	}
	var value any
	if err := readJSONFile(target, &value); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, nil
	}
	return value, nil
}

func (svc *service) ensureJSON(scope string, rel string, fallback any) (any, error) {
	existing, err := svc.tryLoadJSON(scope, rel)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return nil, err
	}
	if err := writeJSONFile(target, fallback); err != nil {
		return nil, err
	}
	return fallback, nil
}

func (svc *service) writeRawJSON(scope string, rel string, raw json.RawMessage) error {
	target, err := svc.resolvePath(scope, rel)
	if err != nil {
		return err
	}
	return writeRawJSONFile(target, raw)
}

func requireScope(raw json.RawMessage) string {
	scope := strings.TrimSpace(stringField(raw, "scope"))
	if scope != "library" && scope != "data" {
		panicSafe(fmt.Errorf("非法 scope：%s", scope))
	}
	return scope
}

func rawField(raw json.RawMessage, key string) json.RawMessage {
	payload := map[string]json.RawMessage{}
	_ = json.Unmarshal(raw, &payload)
	return payload[key]
}

func stringField(raw json.RawMessage, key string) string {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	return strings.TrimSpace(asString(payload[key]))
}

func optionalStringField(raw json.RawMessage, key string) string {
	return stringField(raw, key)
}

func numberField(raw json.RawMessage, key string) float64 {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	return asFloat(payload[key])
}

func intField(raw json.RawMessage, key string) int {
	value := numberField(raw, key)
	if value <= 0 {
		return 0
	}
	return int(value)
}

func asString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return fmt.Sprintf("%.0f", v)
	case json.Number:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func asFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		return 0
	}
}

func panicSafe(err error) {
	panic(err)
}

func normalizeTags(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range list {
		tag := strings.TrimSpace(asString(item))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

func normalizeResources(value any) []resourceRef {
	list, ok := value.([]any)
	if !ok {
		return []resourceRef{}
	}
	seen := map[string]bool{}
	out := []resourceRef{}
	for _, item := range list {
		rec, ok := item.(map[string]any)
		if !ok {
			continue
		}
		assetID := strings.TrimSpace(asString(rec["assetId"]))
		if assetID == "" || seen[assetID] {
			continue
		}
		seen[assetID] = true
		out = append(out, resourceRef{AssetID: assetID, Mime: strings.TrimSpace(asString(rec["mime"])), Ext: strings.TrimSpace(asString(rec["ext"])), Kind: strings.TrimSpace(asString(rec["kind"])), Name: strings.TrimSpace(asString(rec["name"]))})
	}
	return out
}

func listDir(path string) ([]fileEntry, error) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]fileEntry, 0, len(entries))
	for _, entry := range entries {
		info, _ := entry.Info()
		var size int64
		var modified float64
		if info != nil {
			size = info.Size()
			modified = float64(info.ModTime().UnixMilli())
		}
		out = append(out, fileEntry{Name: entry.Name(), IsDirectory: entry.IsDir(), IsFile: !entry.IsDir(), Size: size, ModifiedMs: modified})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func noteID() string {
	return time.Now().Format("20060102150405") + fmt.Sprintf("%03d", time.Now().Nanosecond()/1e6)
}

func renderMarkdownLite(body string) string {
	text := strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\r", "\n")
	if strings.TrimSpace(text) == "" {
		return ""
	}
	parts := strings.Split(text, "\n\n")
	out := []string{}
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		out = append(out, "<p>"+strings.ReplaceAll(htmlEscape(p), "\n", "<br />")+"</p>")
	}
	return strings.Join(out, "\n")
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&#34;", "'", "&#39;")
	return replacer.Replace(value)
}

func mimeFromExt(ext string) string {
	return assetFileMimeFromExt(ext)
}

func kindFromMime(m string) string {
	m = normalizeAssetMime(m)
	if kind := assetFileKindFromMime(m); kind != "" {
		return kind
	}
	if strings.HasPrefix(m, "image/") {
		return "image"
	}
	if strings.HasPrefix(m, "video/") {
		return "video"
	}
	if strings.HasPrefix(m, "audio/") {
		return "audio"
	}
	return "document"
}

func categoryFromKind(kind string) string {
	switch kind {
	case "image":
		return "images"
	case "video", "audio":
		return "videos"
	default:
		return "docs"
	}
}

func parseAssetFileName(name string) (string, string) {
	s := strings.TrimSpace(name)
	dot := strings.LastIndex(s, ".")
	if dot <= 0 {
		return s, ""
	}
	return s[:dot], strings.ToLower(s[dot+1:])
}

func assetKey(assetID string, ext string) string {
	assetID = strings.TrimSpace(assetID)
	ext = strings.Trim(strings.ToLower(strings.TrimSpace(ext)), ".")
	if ext == "" {
		return assetID
	}
	return assetID + "." + ext
}

func openSystemDir(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

func copyToClipboard(text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "clip")
	case "darwin":
		cmd = exec.Command("pbcopy")
	default:
		cmd = exec.Command("xclip", "-selection", "clipboard")
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	_, writeErr := stdin.Write([]byte(text))
	closeErr := stdin.Close()
	waitErr := cmd.Wait()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return waitErr
}
