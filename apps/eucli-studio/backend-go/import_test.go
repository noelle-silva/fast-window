package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestImportArtifactUploadsRawArchive 安装包按分类直传到对应导入接口：
// 内容原样、内容类型为 zip、携带长期 Key，返回业务端数据。
func TestImportArtifactUploadsRawArchive(t *testing.T) {
	type captured struct {
		path          string
		contentType   string
		authorization string
		body          []byte
	}
	requests := make(chan captured, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- captured{path: r.URL.Path, contentType: r.Header.Get("Content-Type"), authorization: r.Header.Get("Authorization"), body: body}
		_, _ = w.Write([]byte(`{"data":{"artifact":{"kind":"tool","id":"local-demo"},"status":"preparing"}}`))
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(server.URL, "long-term-key", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	svc.setConnectionState(runtimeBootstrap{EucliBoxReachable: true})

	archivePath := filepath.Join(t.TempDir(), "local-demo.zip")
	payload := []byte("PK\x03\x04 raw archive bytes")
	if err := os.WriteFile(archivePath, payload, 0o644); err != nil {
		t.Fatalf("write archive: %v", err)
	}

	params, _ := json.Marshal(map[string]any{"kind": "tool", "filePath": archivePath})
	raw, err := svc.dispatch(context.Background(), "artifacts.import", params)
	if err != nil {
		t.Fatalf("dispatch() error = %v", err)
	}
	select {
	case got := <-requests:
		if got.path != "/api/tools/import" {
			t.Fatalf("path = %s", got.path)
		}
		if got.contentType != "application/zip" {
			t.Fatalf("content type = %s", got.contentType)
		}
		if got.authorization != "Bearer long-term-key" {
			t.Fatalf("authorization = %s", got.authorization)
		}
		if !bytes.Equal(got.body, payload) {
			t.Fatalf("body = %q", got.body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload request was not received")
	}
	result := objectMap(raw)
	if result["status"] != "preparing" {
		t.Fatalf("result = %#v", result)
	}
}

// TestImportArtifactRoutesPluginKind 插件分类直传到插件导入接口。
func TestImportArtifactRoutesPluginKind(t *testing.T) {
	requests := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.Path
		_, _ = w.Write([]byte(`{"data":{"artifact":{"kind":"plugin","id":"demo"},"status":"preparing"}}`))
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(server.URL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	svc.setConnectionState(runtimeBootstrap{EucliBoxReachable: true})
	archivePath := filepath.Join(t.TempDir(), "demo.zip")
	if err := os.WriteFile(archivePath, []byte("PK"), 0o644); err != nil {
		t.Fatalf("write archive: %v", err)
	}
	params, _ := json.Marshal(map[string]any{"kind": "plugin", "filePath": archivePath})
	if _, err := svc.dispatch(context.Background(), "artifacts.import", params); err != nil {
		t.Fatalf("dispatch() error = %v", err)
	}
	select {
	case path := <-requests:
		if path != "/api/system-plugins/import" {
			t.Fatalf("path = %s", path)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload request was not received")
	}
}

// TestImportArtifactPacksDirectoryArchive 选择目录时先在本地打包成标准 zip 再直传：
// 包内包含定义文件与二进制、跳过 .git 目录。
func TestImportArtifactPacksDirectoryArchive(t *testing.T) {
	requests := make(chan []byte, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- body
		_, _ = w.Write([]byte(`{"data":{"artifact":{"kind":"tool","id":"local-demo"},"status":"preparing"}}`))
	}))
	defer server.Close()

	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(server.URL, "long-term-key", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	svc.setConnectionState(runtimeBootstrap{EucliBoxReachable: true})

	sourceDir := t.TempDir()
	writeTestFile(t, filepath.Join(sourceDir, "definition.json"), `{"id":"local-demo","version":"0.1.0"}`)
	writeTestFile(t, filepath.Join(sourceDir, "binary", "windows-amd64", "local-demo.exe"), "tool-binary")
	writeTestFile(t, filepath.Join(sourceDir, "sub", "notes.txt"), "notes")
	writeTestFile(t, filepath.Join(sourceDir, ".git", "config"), "git-config")

	params, _ := json.Marshal(map[string]any{"kind": "tool", "filePath": sourceDir})
	if _, err := svc.dispatch(context.Background(), "artifacts.import", params); err != nil {
		t.Fatalf("dispatch() error = %v", err)
	}
	select {
	case body := <-requests:
		reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
		if err != nil {
			t.Fatalf("zip.NewReader() error = %v", err)
		}
		names := map[string]bool{}
		for _, entry := range reader.File {
			names[entry.Name] = true
		}
		if !names["definition.json"] || !names["binary/windows-amd64/local-demo.exe"] || !names["sub/notes.txt"] {
			t.Fatalf("zip entries = %#v", names)
		}
		if names[".git/config"] {
			t.Fatalf(".git leaked into archive: %#v", names)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload request was not received")
	}
}

func writeTestFile(t *testing.T, path string, payload string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(payload), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// TestImportArtifactRejectsUnknownKind 未知分类同步拒绝。
func TestImportArtifactRejectsUnknownKind(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)
	params, _ := json.Marshal(map[string]any{"kind": "theme", "filePath": "x.zip"})
	if _, err := svc.dispatch(context.Background(), "artifacts.import", params); err == nil {
		t.Fatal("dispatch() error = nil")
	}
}
