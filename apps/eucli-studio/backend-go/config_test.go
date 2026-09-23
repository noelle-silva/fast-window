package main

import "testing"

func TestSaveConnectionKeepsProjection(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}

	if _, err := store.updateProjection(func(projection *projectionConfig) {
		projection.UI = map[string]any{"activeRoleId": "r1"}
		projection.Settings = map[string]any{"wallpaper": map[string]any{"enabled": true, "activeId": "w1"}}
		projection.ActiveChatByRole = map[string]string{"r1": "c1"}
	}); err != nil {
		t.Fatalf("updateProjection() error = %v", err)
	}

	cfg, err := store.saveConnection("http://127.0.0.1:8765/", " key-1 ")
	if err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	if cfg.EucliBoxURL != "http://127.0.0.1:8765" || cfg.EucliBoxKey != "key-1" {
		t.Fatalf("saved connection = %#v", cfg)
	}

	reloaded, err := store.load()
	if err != nil {
		t.Fatalf("load() error = %v", err)
	}
	wallpaper := objectMap(reloaded.Projection.Settings["wallpaper"])
	if !boolField(wallpaper, "enabled", false) || stringField(wallpaper, "activeId") != "w1" {
		t.Fatalf("wallpaper setting lost after saveConnection: %#v", reloaded.Projection.Settings)
	}
	if got := reloaded.Projection.ActiveChatByRole["r1"]; got != "c1" {
		t.Fatalf("activeChatByRole lost after saveConnection: %#v", reloaded.Projection.ActiveChatByRole)
	}
	if got := stringField(reloaded.Projection.UI, "activeRoleId"); got != "r1" {
		t.Fatalf("ui lost after saveConnection: %#v", reloaded.Projection.UI)
	}
}
