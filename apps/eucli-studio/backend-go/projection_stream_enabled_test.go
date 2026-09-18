package main

import (
	"testing"
)

func TestStreamEnabledProjectsToOneWayView(t *testing.T) {
	nonStreaming := map[string]any{
		"id":        "session-1",
		"roleId":    "developer",
		"title":     "Chat",
		"metadata":  map[string]any{"streamEnabled": "false"},
		"createdAt": "2026-08-27T10:00:00Z",
		"updatedAt": "2026-08-27T10:00:00Z",
		"messages":  []any{},
	}
	chat := toUIChat(nonStreaming)
	if chat["streamEnabled"] != false {
		t.Fatalf("downward chat streamEnabled = %#v", chat["streamEnabled"])
	}

	defaultSession := map[string]any{
		"id":        "session-2",
		"roleId":    "developer",
		"title":     "Chat",
		"createdAt": "2026-08-27T10:00:00Z",
		"updatedAt": "2026-08-27T10:00:00Z",
		"messages":  []any{},
	}
	defaultChat := toUIChat(defaultSession)
	if value, exists := defaultChat["streamEnabled"]; exists {
		t.Fatalf("default chat must stay implicit (streaming), got %#v", value)
	}
}
