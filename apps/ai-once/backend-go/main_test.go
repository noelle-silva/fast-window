package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestServiceCreatesAiOnceDataFiles(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil { t.Fatal(err) }
	if err := svc.ensureReady(); err != nil { t.Fatal(err) }
	for _, name := range []string{dataFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil { t.Fatalf("expected %s to exist: %v", name, err) }
	}
	data, err := svc.readData()
	if err != nil { t.Fatal(err) }
	if data.Version != 2 || len(data.Settings.Providers) != 1 || len(data.Spaces) != 1 { t.Fatalf("unexpected data: %#v", data) }
}

func TestLegacySettingsMigratesToDataJSON(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FW_APP_DATA_DIR", dir)
	legacy := legacySettings{ProviderName: "Local", BaseURL: "http://127.0.0.1:8080/v1/", APIKey: "key", Model: "model-a", SystemPrompt: "sys"}
	b, _ := json.Marshal(legacy)
	if err := os.WriteFile(filepath.Join(dir, settingsFile), b, 0o600); err != nil { t.Fatal(err) }
	svc, err := newService(); if err != nil { t.Fatal(err) }
	if err := svc.ensureReady(); err != nil { t.Fatal(err) }
	data, err := svc.readData(); if err != nil { t.Fatal(err) }
	p := data.Settings.Providers[0]
	if p.Name != "Local" || p.BaseURL != "http://127.0.0.1:8080/v1" || p.APIKey != "key" { t.Fatalf("bad provider: %#v", p) }
	if got := data.Spaces[0].DefaultModelByProvider[p.ID]; got != "model-a" { t.Fatalf("bad model: %q", got) }
	if data.Spaces[0].Templates[0].SystemPrompt != "sys" { t.Fatalf("bad template: %#v", data.Spaces[0].Templates[0]) }
}

func TestParseModelsSupportsDataAndModels(t *testing.T) {
	ids, err := parseModels([]byte(`{"data":[{"id":"b"},{"id":"a"}]}`))
	if err != nil { t.Fatal(err) }
	if ids[0] != "a" || ids[1] != "b" { t.Fatalf("bad data ids: %#v", ids) }
	ids, err = parseModels([]byte(`{"models":[{"id":"x"}]}`))
	if err != nil { t.Fatal(err) }
	if len(ids) != 1 || ids[0] != "x" { t.Fatalf("bad models ids: %#v", ids) }
}

func TestAskBuildsImagePayload(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FW_APP_DATA_DIR", dir)
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			if err := json.NewDecoder(r.Body).Decode(&got); err != nil { t.Fatal(err) }
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc, err := newService(); if err != nil { t.Fatal(err) }
	if err := svc.ensureReady(); err != nil { t.Fatal(err) }
	data, _ := svc.readData()
	data.Settings.Providers[0].BaseURL = server.URL + "/v1"
	data.Settings.Providers[0].APIKey = "key"
	data.Spaces[0].DefaultModelByProvider[data.Settings.Providers[0].ID] = "m"
	if _, err := svc.saveData(data); err != nil { t.Fatal(err) }
	entry, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "hello", Images: []DraftImage{{Name: "a.png", Type: "image/png", Size: 3, DataURL: "data:image/png;base64,YWJj"}}})
	if err != nil { t.Fatal(err) }
	if entry.Output != "ok" || len(entry.Images) != 1 { t.Fatalf("bad entry: %#v", entry) }
	messages := got["messages"].([]any)
	user := messages[len(messages)-1].(map[string]any)
	parts := user["content"].([]any)
	if len(parts) != 2 || parts[1].(map[string]any)["type"] != "image_url" { t.Fatalf("bad payload: %#v", got) }
}

func TestAskRequiresProviderConfiguration(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService(); if err != nil { t.Fatal(err) }
	if err := svc.ensureReady(); err != nil { t.Fatal(err) }
	data, _ := svc.readData()
	_, err = svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "hello", Model: "m"})
	if err == nil { t.Fatal("expected missing provider configuration error") }
}
