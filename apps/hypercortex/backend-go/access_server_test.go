package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// freePort 返回一个当前空闲的本机端口（仅测试用）。
func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("freePort listen failed: %v", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func postAccessRPC(t *testing.T, port int, key string, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/rpc", port), strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request failed: %v", err)
	}
	if key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	return response
}

func decodeAccessResponse(t *testing.T, response *http.Response) (bool, string, json.RawMessage) {
	t.Helper()
	defer response.Body.Close()
	var envelope struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Error  map[string]any  `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	message := ""
	if envelope.Error != nil {
		message = strings.TrimSpace(asString(envelope.Error["message"]))
	}
	return envelope.OK, message, envelope.Result
}

func TestAccessServerRejectsMissingOrInvalidKey(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	if _, err := svc.createExternalAccessKey(testRepoID(t, svc), "测试密钥"); err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}

	for _, key := range []string{"", "wrong-key"} {
		response := postAccessRPC(t, port, key, `{"method":"hypercortex.repos.list","params":{}}`)
		if response.StatusCode != http.StatusUnauthorized {
			response.Body.Close()
			t.Fatalf("key %q status = %d, want 401", key, response.StatusCode)
		}
		response.Body.Close()
	}
}

func TestAccessServerBindsKeyToItsRepo(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	firstRepo := testRepoID(t, svc)
	secondRepo, err := svc.createRepo("第二仓库")
	if err != nil {
		t.Fatalf("createRepo failed: %v", err)
	}
	if _, err := svc.createNote(firstRepo, json.RawMessage(`{"title":"第一仓库笔记"}`)); err != nil {
		t.Fatalf("createNote failed: %v", err)
	}
	if _, err := svc.createNote(secondRepo.ID, json.RawMessage(`{"title":"第二仓库笔记"}`)); err != nil {
		t.Fatalf("createNote failed: %v", err)
	}
	created, err := svc.createExternalAccessKey(secondRepo.ID, "第二仓库密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	key := created.Keys[0].Key

	loadNoteTitles := func(params string) []string {
		t.Helper()
		body := `{"method":"hypercortex.notes.loadIndex","params":` + params + `}`
		response := postAccessRPC(t, port, key, body)
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			t.Fatalf("status = %d, want 200", response.StatusCode)
		}
		ok, message, result := decodeAccessResponse(t, response)
		if !ok {
			t.Fatalf("response not ok: %s", message)
		}
		var index struct {
			Version int                 `json:"version"`
			Notes   map[string]noteMeta `json:"notes"`
		}
		if err := json.Unmarshal(result, &index); err != nil {
			t.Fatalf("decode index failed: %v", err)
		}
		titles := []string{}
		for _, meta := range index.Notes {
			titles = append(titles, meta.Title)
		}
		sort.Strings(titles)
		return titles
	}

	// 未指定作用域：按密钥绑定的仓库（第二仓库）访问。
	if titles := loadNoteTitles(`{}`); len(titles) != 1 || titles[0] != "第二仓库笔记" {
		t.Fatalf("default routing titles = %v, want [第二仓库笔记]", titles)
	}
	// 空白作用域同样视为未指定。
	if titles := loadNoteTitles(`{"scope":""}`); len(titles) != 1 || titles[0] != "第二仓库笔记" {
		t.Fatalf("blank scope titles = %v, want [第二仓库笔记]", titles)
	}
	// 显式指定绑定仓库本身：允许，仍按该仓库访问。
	if titles := loadNoteTitles(fmt.Sprintf(`{"scope":%q}`, secondRepo.ID)); len(titles) != 1 || titles[0] != "第二仓库笔记" {
		t.Fatalf("same scope titles = %v, want [第二仓库笔记]", titles)
	}
	// 显式指定其他仓库：快速失败，密钥不允许跨仓。
	body := fmt.Sprintf(`{"method":"hypercortex.notes.loadIndex","params":{"scope":%q}}`, firstRepo)
	response := postAccessRPC(t, port, key, body)
	if response.StatusCode != http.StatusForbidden {
		response.Body.Close()
		t.Fatalf("cross-repo status = %d, want 403", response.StatusCode)
	}
	ok, message, _ := decodeAccessResponse(t, response)
	if ok || !strings.Contains(message, "只能访问") {
		t.Fatalf("cross-repo response = ok:%v message:%q", ok, message)
	}
}

func TestAccessServerForbidsAccessManagement(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	created, err := svc.createExternalAccessKey(testRepoID(t, svc), "测试密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	response := postAccessRPC(t, port, created.Keys[0].Key, `{"method":"hypercortex.access.load","params":{}}`)
	if response.StatusCode != http.StatusForbidden {
		response.Body.Close()
		t.Fatalf("status = %d, want 403", response.StatusCode)
	}
	response.Body.Close()
}

// 外部出口的错误一律收敛为接口语言：不出现磁盘路径、目录名与内部编号。
func TestAccessServerConvergesFilesystemErrors(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	created, err := svc.createExternalAccessKey(testRepoID(t, svc), "测试密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	body := `{"method":"hypercortex.notes.loadManifest","params":{"packageDir":"Notes/2099-01/missing"}}`
	response := postAccessRPC(t, port, created.Keys[0].Key, body)
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	ok, message, _ := decodeAccessResponse(t, response)
	if ok {
		t.Fatalf("missing note must fail, message = %q", message)
	}
	if message != "笔记不存在" {
		t.Fatalf("message = %q, want 笔记不存在", message)
	}
}

// 外部出口的版本不存在与笔记不存在必须分开：笔记存在、版本不存在时报「版本不存在」+ VERSION_NOT_FOUND。
func TestAccessServerDistinguishesMissingVersionFromMissingNote(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	created, err := svc.saveNoteFaces(testRepoID(t, svc), mustJSONRaw(t, map[string]any{
		"id":    "20260930000000001",
		"title": "版本区分",
		"faces": []map[string]any{{"faceId": "text", "kind": "markdown", "content": "正文"}},
	}), 0)
	if err != nil {
		t.Fatalf("save note failed: %v", err)
	}
	dir := created.(map[string]any)["meta"].(noteMeta).Dir
	key, err := svc.createExternalAccessKey(testRepoID(t, svc), "测试密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}

	// 笔记存在 + 版本不存在：错误必须是版本不存在，码为 VERSION_NOT_FOUND。
	body := `{"method":"hypercortex.notes.versions.load","params":{"packageDir":"` + dir + `","versionId":"v_20260101_000000_00000000"}}`
	response := postAccessRPC(t, port, key.Keys[0].Key, body)
	ok, message, _ := decodeAccessResponse(t, response)
	if ok {
		t.Fatalf("missing version must fail, message = %q", message)
	}
	if message != "版本不存在：v_20260101_000000_00000000" {
		t.Fatalf("message = %q, want 版本不存在", message)
	}
	// 笔记不存在时仍是 NOTE_NOT_FOUND。
	body = `{"method":"hypercortex.notes.versions.load","params":{"packageDir":"Notes/2099-01/missing","versionId":"v_20260101_000000_00000000"}}`
	response = postAccessRPC(t, port, key.Keys[0].Key, body)
	ok, message, _ = decodeAccessResponse(t, response)
	if ok || message != "笔记不存在" {
		t.Fatalf("missing note message = %q", message)
	}
}

// 搜索 total 经外部访问出口的 JSON 序列化必须保真：正文有结果时 total 不得为 0。
func TestAccessServerSearchReportsTotal(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	scope := testRepoID(t, svc)
	for index := 0; index < 3; index++ {
		if _, err := svc.createNote(scope, mustJSONRaw(t, map[string]any{"title": fmt.Sprintf("总数笔记%d", index)})); err != nil {
			t.Fatalf("createNote failed: %v", err)
		}
	}
	key, err := svc.createExternalAccessKey(scope, "测试密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}

	body := `{"method":"hypercortex.search.query","params":{"limit":1}}`
	response := postAccessRPC(t, port, key.Keys[0].Key, body)
	ok, message, result := decodeAccessResponse(t, response)
	if !ok {
		t.Fatalf("search failed: %s", message)
	}
	var payload struct {
		Total int               `json:"total"`
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		t.Fatalf("decode search result failed: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("items = %d, want 1 (limit)", len(payload.Items))
	}
	if payload.Total != 3 {
		t.Fatalf("total = %d, want 3", payload.Total)
	}
}

// 空补丁经外部访问出口不推进版本：零副作用的读取通道在真实链路上成立。
func TestAccessServerFaceSettingsNoOpKeepsVersion(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	scope := testRepoID(t, svc)
	created, err := svc.saveNoteFaces(scope, mustJSONRaw(t, map[string]any{
		"id":    "20260930000000002",
		"title": "空操作出口",
		"faces": []map[string]any{{"faceId": "html", "kind": "html", "content": "<div>x</div>"}},
	}), 0)
	if err != nil {
		t.Fatalf("save note failed: %v", err)
	}
	dir := created.(map[string]any)["meta"].(noteMeta).Dir
	before, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}
	key, err := svc.createExternalAccessKey(scope, "测试密钥")
	if err != nil {
		t.Fatalf("createExternalAccessKey failed: %v", err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}

	body := `{"method":"hypercortex.notes.saveFaceSettings","params":{"packageDir":"` + dir + `","faceId":"html","settings":{}}}`
	response := postAccessRPC(t, port, key.Keys[0].Key, body)
	ok, message, result := decodeAccessResponse(t, response)
	if !ok {
		t.Fatalf("empty patch failed: %s", message)
	}
	var payload struct {
		Version float64 `json:"version"`
		Changed bool    `json:"changed"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		t.Fatalf("decode result failed: %v", err)
	}
	if payload.Changed {
		t.Fatalf("empty patch changed = true")
	}
	if payload.Version != before.UpdatedAtMs {
		t.Fatalf("reported version = %v, want %v", payload.Version, before.UpdatedAtMs)
	}
	after, err := svc.loadNoteManifest(scope, dir)
	if err != nil {
		t.Fatal(err)
	}
	if after.UpdatedAtMs != before.UpdatedAtMs {
		t.Fatalf("version advanced by no-op: %v -> %v", before.UpdatedAtMs, after.UpdatedAtMs)
	}
}

func TestStartExternalAccessServerFromSavedConfig(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	port := freePort(t)
	doc := emptyExternalAccessDoc()
	doc.Port = port
	if err := svc.saveExternalAccess(doc); err != nil {
		t.Fatalf("saveExternalAccess failed: %v", err)
	}
	if err := svc.startExternalAccessServer(); err != nil {
		t.Fatalf("startExternalAccessServer failed: %v", err)
	}
	response := postAccessRPC(t, port, "", `{"method":"hypercortex.repos.list","params":{}}`)
	if response.StatusCode != http.StatusUnauthorized {
		response.Body.Close()
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	response.Body.Close()
}

func TestStartExternalAccessServerSkipsWhenPortUnset(t *testing.T) {
	svc := newTestService(t)
	if err := svc.startExternalAccessServer(); err != nil {
		t.Fatalf("startExternalAccessServer failed: %v", err)
	}
	if svc.accessServer.port != 0 {
		t.Fatalf("server port = %d, want no listener", svc.accessServer.port)
	}
}

func TestSaveExternalAccessPortRejectsOccupiedPort(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	blocker, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("blocker listen failed: %v", err)
	}
	defer blocker.Close()
	occupied := blocker.Addr().(*net.TCPAddr).Port

	if _, err := svc.saveExternalAccessPort(float64(occupied)); err == nil {
		t.Fatal("occupied port must be rejected")
	}
	mustNotExist(t, filepath.Join(svc.stateDir, accessFile))
}

func TestSaveExternalAccessPortStartsListening(t *testing.T) {
	svc := newTestService(t)
	if err := svc.ensureRoots(); err != nil {
		t.Fatalf("ensureRoots failed: %v", err)
	}
	port := freePort(t)
	if _, err := svc.saveExternalAccessPort(float64(port)); err != nil {
		t.Fatalf("saveExternalAccessPort failed: %v", err)
	}
	// 端口已真实监听：未授权请求得到 401 而不是连接失败。
	response := postAccessRPC(t, port, "", `{"method":"hypercortex.repos.list","params":{}}`)
	if response.StatusCode != http.StatusUnauthorized {
		response.Body.Close()
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	response.Body.Close()
}
