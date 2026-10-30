package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fixture 驱动的行为契约（design-1 §八）：
//   orphan-index   索引里指向不存在的会话 → 不能产生幽灵会话
//   stale-active   activeChatId 指向已删除会话 → 回落而不是报错
//   same-timestamp 同一 createdAt → (createdAt,id) 稳定排序

func newFixtureBox(t *testing.T, sessions []map[string]any) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "role-1"}}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles/role-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "role-1", "name": "角色一"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles/role-1/sessions":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": sessions})
		case r.Method == http.MethodGet && r.URL.Path == "/api/providers":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/model-groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func newFixtureService(t *testing.T, boxURL string) *service {
	t.Helper()
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(boxURL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	return newBusinessReadyTestService(store, nil)
}

// 索引只承载「业务端实际返回的会话」：业务端没返回的 id 不会凭空出现在索引里。
// 这是「幽灵会话」的结构性防线——索引不自己造会话。
func TestSessionIndexNeverInventsSessions(t *testing.T) {
	sessions := []map[string]any{
		{"id": "chat-1", "title": "真实会话", "createdAt": "2026-06-03T10:00:00Z", "updatedAt": "2026-06-03T10:00:00Z", "lastActive": "2026-06-03T10:00:00Z"},
	}
	box := newFixtureBox(t, sessions)
	svc := newFixtureService(t, box.URL)

	payload, _ := json.Marshal(map[string]any{
		"scopes": []any{map[string]any{"kind": "role", "targetId": "role-1"}},
	})
	result, err := svc.dispatch(context.Background(), "aiChat.sessionIndex.get", payload)
	if err != nil {
		t.Fatalf("sessionIndex.get error = %v", err)
	}
	indexes := objectList(objectMap(result)["indexes"])
	if len(indexes) != 1 {
		t.Fatalf("indexes = %#v", indexes)
	}
	ids := stringSlice(indexes[0]["chatIds"])
	if len(ids) != 1 || ids[0] != "chat-1" {
		t.Fatalf("chatIds = %#v（不得包含业务端没返回的 id）", ids)
	}
	for _, id := range ids {
		if id == "ghost-1" || id == "ghost-2" {
			t.Fatalf("索引里出现了幽灵会话：%#v", ids)
		}
	}
}

// activeChatId 指向已删除会话时必须回落，不能报错、不能返回不存在的 id。
func TestStaleActiveChatIdFallsBack(t *testing.T) {
	sessions := []map[string]any{
		{"id": "chat-1", "title": "一", "createdAt": "2026-06-03T10:00:00Z", "updatedAt": "2026-06-03T10:00:00Z", "lastActive": "2026-06-03T10:00:00Z"},
		{"id": "chat-2", "title": "二", "createdAt": "2026-06-03T11:00:00Z", "updatedAt": "2026-06-03T11:00:00Z", "lastActive": "2026-06-03T11:00:00Z"},
	}
	box := newFixtureBox(t, sessions)
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(box.URL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	// 偏好指向一个已删除的会话。
	if _, err := store.updateProjection(func(projection *projectionConfig) {
		projection.ActiveChatByRole["role-1"] = "deleted-chat"
	}); err != nil {
		t.Fatalf("updateProjection() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)

	payload, _ := json.Marshal(map[string]any{
		"scopes": []any{map[string]any{"kind": "role", "targetId": "role-1"}},
	})
	result, err := svc.dispatch(context.Background(), "aiChat.sessionIndex.get", payload)
	if err != nil {
		t.Fatalf("stale activeChatId 不应报错：%v", err)
	}
	index := objectList(objectMap(result)["indexes"])[0]
	active := stringField(index, "activeChatId")
	if active == "deleted-chat" {
		t.Fatalf("不得把已删除会话当作 active：%#v", active)
	}
	// 必须回落到一个真实存在的会话。
	ids := stringSlice(index["chatIds"])
	found := false
	for _, id := range ids {
		if id == active {
			found = true
			break
		}
	}
	if active != "" && !found {
		t.Fatalf("activeChatId %q 不在 chatIds %#v 中", active, ids)
	}
}

// 同一 createdAt 的会话：排序必须稳定（id 升序兜底），且不受输入顺序影响。
func TestSameTimestampSessionsSortStably(t *testing.T) {
	base := "2026-06-03T10:00:00Z"
	sessions := []map[string]any{
		{"id": "chat-c", "title": "c", "createdAt": base, "updatedAt": base, "lastActive": base},
		{"id": "chat-a", "title": "a", "createdAt": base, "updatedAt": base, "lastActive": base},
		{"id": "chat-b", "title": "b", "createdAt": base, "updatedAt": base, "lastActive": base},
	}
	box := newFixtureBox(t, sessions)
	svc := newFixtureService(t, box.URL)

	payload, _ := json.Marshal(map[string]any{
		"scope": map[string]any{"kind": "role", "targetId": "role-1"},
		"limit": 10,
	})
	result, err := svc.dispatch(context.Background(), "aiChat.sessionSummary.list", payload)
	if err != nil {
		t.Fatalf("sessionSummary.list error = %v", err)
	}
	items := objectList(objectMap(result)["items"])
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, stringField(item, "id"))
	}
	// updatedAt 全相同 → id 升序。
	want := []string{"chat-a", "chat-b", "chat-c"}
	if len(ids) != len(want) {
		t.Fatalf("items = %#v", ids)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("排序 = %#v, want %#v", ids, want)
		}
	}
}
