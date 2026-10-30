package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// P0 量化基线：Go 侧 benchmark。
//
// 目标不是「跑得快」，而是「有数可依」：
//   - 四个 index key 的耗时（证明不再走 meta 全站装配）
//   - 单 scope 会话索引装配耗时
//   - 读模型命中 vs 冷启动的差距
//
// 运行：go test -bench . -benchmem -run '^$'

type benchBox struct {
	server   *httptest.Server
	sessions map[string][]map[string]any
}

func newBenchBox(b *testing.B, roles, chatsPerRole int) *benchBox {
	b.Helper()
	box := &benchBox{sessions: map[string][]map[string]any{}}
	for roleIndex := 0; roleIndex < roles; roleIndex++ {
		roleID := fmt.Sprintf("role-%04d", roleIndex)
		sessions := make([]map[string]any, 0, chatsPerRole)
		for chatIndex := 0; chatIndex < chatsPerRole; chatIndex++ {
			sessions = append(sessions, map[string]any{
				"id":                 fmt.Sprintf("%s-c%04d", roleID, chatIndex),
				"title":              fmt.Sprintf("会话 %d", chatIndex),
				"lastMessagePreview": "预览",
				"createdAt":          "2026-06-03T10:00:00Z",
				"updatedAt":          "2026-06-03T10:00:00Z",
				"lastActive":         "2026-06-03T10:00:00Z",
			})
		}
		box.sessions["/api/roles/"+roleID+"/sessions"] = sessions
	}

	box.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles":
			items := make([]any, 0, roles)
			for roleIndex := 0; roleIndex < roles; roleIndex++ {
				items = append(items, map[string]any{"id": fmt.Sprintf("role-%04d", roleIndex)})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": items})
		case r.Method == http.MethodGet && len(r.URL.Path) > len("/api/roles/"):
			// 角色详情
			if _, ok := box.sessions[r.URL.Path+"/sessions"]; ok {
				id := r.URL.Path[len("/api/roles/"):]
				_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id, "name": "角色 " + id}})
				return
			}
			if sessions, ok := box.sessions[r.URL.Path]; ok {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": sessions})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
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
	b.Cleanup(box.server.Close)
	return box
}

func newBenchProjection(b *testing.B, box *benchBox) *projectionService {
	b.Helper()
	store, err := newConfigStore(b.TempDir())
	if err != nil {
		b.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(box.server.URL, "", false); err != nil {
		b.Fatalf("saveConnection() error = %v", err)
	}
	return newProjectionService(store, newEBClient(store, testClientRelease()))
}

// BenchmarkChatsIndexCold 冷启动读 chats/index：只应拉一次 /api/roles + 角色详情，
// 绝不触碰会话索引。
func BenchmarkChatsIndexCold(b *testing.B) {
	box := newBenchBox(b, 32, 6)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		projection := newBenchProjection(b, box)
		if _, err := projection.chatsIndex(context.Background()); err != nil {
			b.Fatalf("chatsIndex() error = %v", err)
		}
	}
}

// BenchmarkChatsIndexWarm 命中读模型：零 I/O。
func BenchmarkChatsIndexWarm(b *testing.B) {
	box := newBenchBox(b, 32, 6)
	projection := newBenchProjection(b, box)
	if _, err := projection.chatsIndex(context.Background()); err != nil {
		b.Fatalf("chatsIndex() error = %v", err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := projection.chatsIndex(context.Background()); err != nil {
			b.Fatalf("chatsIndex() error = %v", err)
		}
	}
}

// BenchmarkSessionIndexAssemble 单 scope 会话索引装配（不含网络）。
func BenchmarkSessionIndexAssemble(b *testing.B) {
	sessions := make([]map[string]any, 0, 200)
	for i := 0; i < 200; i++ {
		sessions = append(sessions, map[string]any{
			"id":                 fmt.Sprintf("chat-%04d", i),
			"title":              fmt.Sprintf("会话 %d", i),
			"lastMessagePreview": "预览",
			"createdAt":          "2026-06-03T10:00:00Z",
			"updatedAt":          "2026-06-03T10:00:00Z",
			"lastActive":         "2026-06-03T10:00:00Z",
		})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		index := buildSessionIndex(sessions, "新聊天", 1)
		if len(stringSlice(index["chatIds"])) != 200 {
			b.Fatalf("chatIds = %d", len(stringSlice(index["chatIds"])))
		}
	}
}

// BenchmarkMetaAssembly meta() 纯组装（读模型全热）。
func BenchmarkMetaAssembly(b *testing.B) {
	box := newBenchBox(b, 32, 6)
	projection := newBenchProjection(b, box)
	ctx := context.Background()
	if err := projection.ensureMetaInputs(ctx); err != nil {
		b.Fatalf("ensureMetaInputs() error = %v", err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := projection.meta(); err != nil {
			b.Fatalf("meta() error = %v", err)
		}
	}
}

// BenchmarkSessionIndexRevision 索引 revision 计算（内容指纹）。
func BenchmarkSessionIndexRevision(b *testing.B) {
	index := map[string]any{
		"chatIds":       []string{"a", "b", "c"},
		"chatUpdatedAt": map[string]any{"a": 1, "b": 2, "c": 3},
		"chatMetas":     []any{map[string]any{"id": "a", "title": "t", "lastMessagePreview": "p"}},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if sessionIndexRevision(index) == 0 {
			b.Fatalf("revision 不应为 0")
		}
	}
}
