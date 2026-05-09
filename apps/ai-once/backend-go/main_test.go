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
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{dataFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
	data, err := svc.readData()
	if err != nil {
		t.Fatal(err)
	}
	if data.Version != 3 || len(data.Settings.Providers) != 1 || len(data.Spaces) != 1 {
		t.Fatalf("unexpected data: %#v", data)
	}
	if !data.Settings.History.Enabled || data.Settings.History.Limit != defaultHistoryLimit {
		t.Fatalf("bad global history settings: %#v", data.Settings.History)
	}
}

func TestLegacySettingsMigratesToDataJSON(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FW_APP_DATA_DIR", dir)
	legacy := legacySettings{ProviderName: "Local", BaseURL: "http://127.0.0.1:8080/v1/", APIKey: "key", Model: "model-a", SystemPrompt: "sys"}
	b, _ := json.Marshal(legacy)
	if err := os.WriteFile(filepath.Join(dir, settingsFile), b, 0o600); err != nil {
		t.Fatal(err)
	}
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	data, err := svc.readData()
	if err != nil {
		t.Fatal(err)
	}
	p := data.Settings.Providers[0]
	if p.Name != "Local" || p.BaseURL != "http://127.0.0.1:8080/v1" || p.APIKey != "key" {
		t.Fatalf("bad provider: %#v", p)
	}
	if got := data.Spaces[0].DefaultModelByProvider[p.ID]; got != "model-a" {
		t.Fatalf("bad model: %q", got)
	}
	if data.Spaces[0].Templates[0].SystemPrompt != "sys" {
		t.Fatalf("bad template: %#v", data.Spaces[0].Templates[0])
	}
}

func TestParseModelsSupportsDataAndModels(t *testing.T) {
	ids, err := parseModels([]byte(`{"data":[{"id":"b"},{"id":"a"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if ids[0] != "a" || ids[1] != "b" {
		t.Fatalf("bad data ids: %#v", ids)
	}
	ids, err = parseModels([]byte(`{"models":[{"id":"x"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "x" {
		t.Fatalf("bad models ids: %#v", ids)
	}
}

func TestAskBuildsImagePayload(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FW_APP_DATA_DIR", dir)
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
				t.Fatal(err)
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	data, _ := svc.readData()
	data.Settings.Providers[0].BaseURL = server.URL + "/v1"
	data.Settings.Providers[0].APIKey = "key"
	data.Spaces[0].DefaultModelByProvider[data.Settings.Providers[0].ID] = "m"
	if _, err := svc.saveData(data); err != nil {
		t.Fatal(err)
	}
	entry, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "hello", Images: []DraftImage{{Name: "a.png", Type: "image/png", Size: 3, DataURL: "data:image/png;base64,YWJj"}}})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Output != "ok" || len(entry.Images) != 1 {
		t.Fatalf("bad entry: %#v", entry)
	}
	if entry.Images[0].FileName == "" {
		t.Fatalf("expected persisted history image: %#v", entry.Images[0])
	}
	messages := got["messages"].([]any)
	user := messages[len(messages)-1].(map[string]any)
	parts := user["content"].([]any)
	if len(parts) != 2 || parts[1].(map[string]any)["type"] != "image_url" {
		t.Fatalf("bad payload: %#v", got)
	}
}

func TestHistoryLimitPrunesRecordsAndImages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FW_APP_DATA_DIR", dir)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	data, err := svc.readData()
	if err != nil {
		t.Fatal(err)
	}
	data.Settings.Providers[0].BaseURL = server.URL + "/v1"
	data.Settings.Providers[0].APIKey = "key"
	data.Settings.History = HistorySettings{Enabled: true, Limit: 2}
	data.Spaces[0].DefaultModelByProvider[data.Settings.Providers[0].ID] = "m"
	if _, err := svc.saveData(data); err != nil {
		t.Fatal(err)
	}
	oldest, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "one", Images: []DraftImage{{Name: "one.png", Type: "image/png", Size: 3, DataURL: "data:image/png;base64,YWJj"}}})
	if err != nil {
		t.Fatal(err)
	}
	oldestFile := oldest.Images[0].FileName
	if _, err := os.Stat(filepath.Join(dir, historyImageDir, oldestFile)); err != nil {
		t.Fatalf("expected oldest image before prune: %v", err)
	}
	if _, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "two", Images: []DraftImage{{Name: "two.png", Type: "image/png", Size: 3, DataURL: "data:image/png;base64,ZGVm"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "three", Images: []DraftImage{{Name: "three.png", Type: "image/png", Size: 3, DataURL: "data:image/png;base64,Z2hp"}}}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.readHistoryRaw()
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 2 {
		t.Fatalf("expected 2 history records, got %d: %#v", len(doc.Items), doc.Items)
	}
	for _, entry := range doc.Items {
		if entry.Input == "one" {
			t.Fatalf("oldest record was not pruned: %#v", doc.Items)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, historyImageDir, oldestFile)); !os.IsNotExist(err) {
		t.Fatalf("expected pruned image to be deleted, got %v", err)
	}
	hydrated, err := svc.readHistoryEntry(doc.Items[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(hydrated.Images) != 1 || hydrated.Images[0].DataURL == "" {
		t.Fatalf("expected hydrated image data url: %#v", hydrated.Images)
	}
}

func TestDisabledHistoryDoesNotPersistRecordOrImages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FW_APP_DATA_DIR", dir)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	data, err := svc.readData()
	if err != nil {
		t.Fatal(err)
	}
	data.Settings.Providers[0].BaseURL = server.URL + "/v1"
	data.Settings.Providers[0].APIKey = "key"
	data.Settings.History = HistorySettings{Enabled: false, Limit: 2}
	data.Spaces[0].DefaultModelByProvider[data.Settings.Providers[0].ID] = "m"
	if _, err := svc.saveData(data); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "no record", Images: []DraftImage{{Name: "x.png", Type: "image/png", Size: 3, DataURL: "data:image/png;base64,YWJj"}}}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.readHistoryRaw()
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 0 {
		t.Fatalf("expected no history when disabled: %#v", doc.Items)
	}
	entries, err := os.ReadDir(filepath.Join(dir, historyImageDir))
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected no persisted images when history disabled: %#v", entries)
	}
}

func TestSpaceHistorySettingsOverrideGlobalLimit(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	data, err := svc.readData()
	if err != nil {
		t.Fatal(err)
	}
	data.Settings.Providers[0].BaseURL = server.URL + "/v1"
	data.Settings.Providers[0].APIKey = "key"
	data.Settings.History = HistorySettings{Enabled: true, Limit: 5}
	data.Spaces[0].History = SpaceHistorySettings{Override: true, Enabled: true, Limit: 1}
	data.Spaces[0].DefaultModelByProvider[data.Settings.Providers[0].ID] = "m"
	if _, err := svc.saveData(data); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "one"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "two"}); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.readHistoryRaw()
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Items) != 1 || doc.Items[0].Input != "two" {
		t.Fatalf("space override limit was not applied: %#v", doc.Items)
	}
}

func TestAskRequiresProviderConfiguration(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}
	data, _ := svc.readData()
	_, err = svc.ask(AskRequest{SpaceID: data.Spaces[0].ID, Input: "hello", Model: "m"})
	if err == nil {
		t.Fatal("expected missing provider configuration error")
	}
}
