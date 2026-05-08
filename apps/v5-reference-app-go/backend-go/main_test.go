package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServiceCreatesReferenceDataFiles(t *testing.T) {
	t.Setenv("FW_APP_DATA_DIR", t.TempDir())
	svc, err := newService()
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureReady(); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{settingsFile, metaFile, migrationsFile} {
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

	saved, err := svc.saveSettings("custom message")
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.readSettings()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Message != saved.Message || loaded.Message != "custom message" {
		t.Fatalf("message = %q, want custom message", loaded.Message)
	}
}
