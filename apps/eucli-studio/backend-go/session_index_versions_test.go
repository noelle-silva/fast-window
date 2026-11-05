package main

import "testing"

func TestBuildSessionIndexCarriesSessionVersions(t *testing.T) {
	sessions := []map[string]any{
		{
			"id":         "chat-1",
			"title":      "会话一",
			"version":    float64(3),
			"createdAt":  "2026-06-03T10:00:00Z",
			"updatedAt":  "2026-06-03T10:00:00Z",
			"lastActive": "2026-06-03T10:00:00Z",
		},
	}
	index := buildSessionIndex(sessions, "新聊天", 1)
	versions := objectMap(index["chatVersions"])
	if got := versions["chat-1"]; got != uint64(3) {
		t.Fatalf("chatVersions[chat-1] = %#v, want 3", got)
	}

	// 版本变化必须改变索引 revision：列表内容没变也不能让版本门漏掉。
	first := sessionIndexRevision(index)
	sessions[0]["version"] = float64(4)
	next := buildSessionIndex(sessions, "新聊天", 1)
	if second := sessionIndexRevision(next); first == second {
		t.Fatal("会话版本变化后索引 revision 必须变化")
	}
}

func TestSessionIndexViewCarriesSessionVersions(t *testing.T) {
	index := map[string]any{
		"chatIds":       []any{"chat-1"},
		"chatUpdatedAt": map[string]any{"chat-1": int64(10)},
		"chatVersions":  map[string]any{"chat-1": uint64(5)},
		"chatMetas":     []any{},
		"updatedAt":     int64(10),
	}
	view := (&projectionService{}).sessionIndexView(roleScope("role-1"), &sessionIndexSnapshot{index: index}, "")
	versions := objectMap(view["chatVersions"])
	if got := versions["chat-1"]; got != uint64(5) {
		t.Fatalf("view chatVersions[chat-1] = %#v, want 5", got)
	}

	empty := (&projectionService{}).sessionIndexView(roleScope("role-1"), nil, "")
	if _, ok := empty["chatVersions"]; !ok {
		t.Fatal("空索引也必须携带 chatVersions 字段")
	}
}
