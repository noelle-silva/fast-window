package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// startAccessForTest 起一个监听随机端口的外部访问服务，返回端口与一把可用钥匙。
func startAccessForTest(t *testing.T, svc *service) (int, string) {
	t.Helper()
	created, err := svc.createExternalAccessKey("测试密钥")
	if err != nil {
		t.Fatal(err)
	}
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.accessServer.stop)
	return port, created.Keys[0].Key
}

func postRPC(t *testing.T, port int, key string, body string) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/rpc", port), strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	result := map[string]any{}
	if len(bytes.TrimSpace(payload)) > 0 {
		_ = json.Unmarshal(payload, &result)
	}
	return response.StatusCode, result
}

func TestAccessServerRejectsMissingOrInvalidKey(t *testing.T) {
	svc := testService(t)
	port, _ := startAccessForTest(t, svc)

	for _, key := range []string{"", "wrong-key"} {
		status, body := postRPC(t, port, key, `{"method":"everything.search","params":{"query":"x"}}`)
		if status != http.StatusUnauthorized {
			t.Fatalf("key %q status = %d, body = %#v", key, status, body)
		}
	}
}

func TestAccessServerForbidsNonWhitelistedMethods(t *testing.T) {
	svc := testService(t)
	port, key := startAccessForTest(t, svc)

	for _, method := range []string{
		"everything.access.load",
		"everything.access.createKey",
		"everything.setup.get",
		"everything.runtime.restart",
		"everything.openPath",
	} {
		status, body := postRPC(t, port, key, fmt.Sprintf(`{"method":%q,"params":{}}`, method))
		if status != http.StatusForbidden {
			t.Fatalf("method %q status = %d, body = %#v", method, status, body)
		}
	}
}

func TestAccessServerRejectsNonRPCPath(t *testing.T) {
	svc := testService(t)
	port, key := startAccessForTest(t, svc)

	request, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/other", port), strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
}

func TestAccessServerSearchRejectsEmptyQueryViaDispatch(t *testing.T) {
	svc := testService(t)
	port, key := startAccessForTest(t, svc)

	// 空关键词：dispatch 的 searchLocked 直接返回空结果（不发运行时请求）。
	status, body := postRPC(t, port, key, `{"method":"everything.search","params":{"query":""}}`)
	if status != http.StatusOK {
		t.Fatalf("status = %d, body = %#v", status, body)
	}
	if ok, _ := body["ok"].(bool); !ok {
		t.Fatalf("body = %#v", body)
	}
}

func TestStartExternalAccessServerFromSavedConfig(t *testing.T) {
	svc := testService(t)
	port, err := svc.accessServer.listen(0)
	if err != nil {
		t.Fatal(err)
	}
	svc.accessServer.stop()
	doc := emptyExternalAccessDoc()
	doc.Port = port
	if err := svc.saveExternalAccess(doc); err != nil {
		t.Fatal(err)
	}
	if err := svc.startExternalAccessServer(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.accessServer.stop)

	status, _ := postRPC(t, port, "", `{"method":"everything.search","params":{"query":"x"}}`)
	if status != http.StatusUnauthorized {
		t.Fatalf("saved-port server status = %d, want 401", status)
	}
}

func TestStartExternalAccessServerSkipsWhenPortUnset(t *testing.T) {
	svc := testService(t)
	if err := svc.startExternalAccessServer(); err != nil {
		t.Fatal(err)
	}
	if svc.accessServer.port != 0 {
		t.Fatalf("port = %d, want 0 (no listener)", svc.accessServer.port)
	}
}
