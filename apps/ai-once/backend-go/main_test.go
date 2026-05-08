package main

import (
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

	for _, name := range []string{settingsFile, historyFile, metaFile, migrationsFile} {
		if _, err := os.Stat(filepath.Join(svc.dataDir, name)); err != nil {
			t.Fatalf("expected %s to exist: %v", name, err)
		}
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	saved, err := svc.saveSettings(appSettings{ProviderName: "Local", BaseURL: "http://127.0.0.1:8080/v1/", APIKey: "key", Model: "model-a"})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.readSettings()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ProviderName != saved.ProviderName || loaded.BaseURL != "http://127.0.0.1:8080/v1" || loaded.Model != "model-a" {
		t.Fatalf("unexpected settings: %#v", loaded)
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
	_, err = svc.ask("hello", "", "")
	if err == nil {
		t.Fatal("expected missing provider configuration error")
	}
}
