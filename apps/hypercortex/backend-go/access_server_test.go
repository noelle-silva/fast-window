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
