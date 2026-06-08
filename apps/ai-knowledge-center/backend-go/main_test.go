package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceCreatesClientDataFiles(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{settingsFile, secretsFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
	connection, err := svc.readConnection()
	if err != nil {
		t.Fatal(err)
	}
	if connection.ServerBaseURL != defaultServerBaseURL {
		t.Fatalf("serverBaseUrl = %q, want %q", connection.ServerBaseURL, defaultServerBaseURL)
	}
	if connection.HasServerKey {
		t.Fatal("default connection should not have a server key")
	}
}

func TestConnectionSaveMasksServerKey(t *testing.T) {
	svc := newReadyTestService(t)
	key := "secret-key"
	saved, err := svc.saveConnection(saveConnectionInput{ServerBaseURL: "http://127.0.0.1:17321/", ServerKey: &key})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ServerBaseURL != defaultServerBaseURL || !saved.HasServerKey {
		t.Fatalf("saved connection = %+v", saved)
	}
	encoded, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), key) {
		t.Fatal("connection response leaked the server key")
	}
	var secrets appSecrets
	if err := readJSON(svc.secretsPath(), &secrets); err != nil {
		t.Fatal(err)
	}
	if secrets.ServerKey != key {
		t.Fatalf("stored key = %q, want %q", secrets.ServerKey, key)
	}
}

func TestServerRequestUsesBearerAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("path = %s, want /health", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret-key" {
			t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer server.Close()

	svc := newReadyTestService(t)
	key := "secret-key"
	if _, err := svc.saveConnection(saveConnectionInput{ServerBaseURL: server.URL, ServerKey: &key}); err != nil {
		t.Fatal(err)
	}
	result, err := svc.serverRequest(http.MethodGet, "/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	status := result.(map[string]any)["status"]
	if status != "ok" {
		t.Fatalf("status = %v, want ok", status)
	}
}

func TestDocumentListBuildsFilters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/documents" {
			t.Fatalf("path = %s, want /v1/documents", r.URL.Path)
		}
		query := r.URL.Query()
		if query.Get("status") != "active" || query.Get("q") != "Go" || query.Get("tag") != "server" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"documents": []any{}})
	}))
	defer server.Close()

	svc := newReadyTestService(t)
	key := "secret-key"
	if _, err := svc.saveConnection(saveConnectionInput{ServerBaseURL: server.URL, ServerKey: &key}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.dispatch("knowledge.documents.list", json.RawMessage(`{"status":"active","query":"Go","tag":"server"}`))
	if err != nil {
		t.Fatal(err)
	}
}

func TestHealthRequiresConfiguredKey(t *testing.T) {
	svc := newReadyTestService(t)
	_, err := svc.serverRequest(http.MethodGet, "/health", nil)
	if err == nil || err.Error() != "访问钥匙未配置" {
		t.Fatalf("err = %v, want access key error", err)
	}
}

func newReadyTestService(t *testing.T) *service {
	t.Helper()
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	return svc
}
