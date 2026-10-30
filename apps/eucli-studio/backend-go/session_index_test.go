package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// requestLog 记录业务端收到的每个请求，用于断言「不再有隐藏的全量装配」。
type requestLog struct {
	mu    sync.Mutex
	items []string
}

func (l *requestLog) add(method string, path string) {
	l.mu.Lock()
	l.items = append(l.items, method+" "+path)
	l.mu.Unlock()
}

func (l *requestLog) count(method string, path string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	total := 0
	for _, item := range l.items {
		if item == method+" "+path {
			total++
		}
	}
	return total
}

func (l *requestLog) total() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.items)
}

func (l *requestLog) reset() {
	l.mu.Lock()
	l.items = nil
	l.mu.Unlock()
}

// fakeBox 是最小业务端：角色 2 个、群组 1 个、会话各 2 条。
type fakeBox struct {
	log      *requestLog
	server   *httptest.Server
	sessions map[string][]map[string]any
}

func newFakeBox(t *testing.T) *fakeBox {
	t.Helper()
	box := &fakeBox{
		log: &requestLog{},
		sessions: map[string][]map[string]any{
			"/api/roles/role-1/sessions": {
				{"id": "chat-1", "title": "会话一", "lastMessagePreview": "一", "createdAt": "2026-06-03T10:00:00Z", "updatedAt": "2026-06-03T10:00:00Z", "lastActive": "2026-06-03T10:00:00Z"},
				{"id": "chat-2", "title": "会话二", "lastMessagePreview": "二", "createdAt": "2026-06-03T11:00:00Z", "updatedAt": "2026-06-03T11:00:00Z", "lastActive": "2026-06-03T11:00:00Z"},
			},
			"/api/roles/role-2/sessions": {
				{"id": "chat-9", "title": "角色二会话", "createdAt": "2026-06-03T12:00:00Z", "updatedAt": "2026-06-03T12:00:00Z", "lastActive": "2026-06-03T12:00:00Z"},
			},
			"/api/groups/group-1/sessions": {
				{"id": "gchat-1", "title": "群聊一", "createdAt": "2026-06-03T09:00:00Z", "updatedAt": "2026-06-03T09:00:00Z", "lastActive": "2026-06-03T09:00:00Z"},
			},
		},
	}
	box.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		box.log.add(r.Method, r.URL.Path)
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{
				map[string]any{"id": "role-1"}, map[string]any{"id": "role-2"},
			}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles/role-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "role-1", "name": "角色一", "updatedAt": "2026-06-03T10:00:00Z"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/roles/role-2":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "role-2", "name": "角色二", "updatedAt": "2026-06-03T10:00:00Z"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/providers":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/model-groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/groups":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"id": "group-1"}}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/groups/group-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "group-1", "name": "群组一", "updatedAt": "2026-06-03T10:00:00Z"}})
		default:
			if sessions, ok := box.sessions[r.URL.Path]; ok && r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": sessions})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{}})
		}
	}))
	t.Cleanup(box.server.Close)
	return box
}

func (b *fakeBox) store(t *testing.T) *configStore {
	t.Helper()
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	if _, err := store.saveConnection(b.server.URL, "", false); err != nil {
		t.Fatalf("saveConnection() error = %v", err)
	}
	return store
}

// TestIndexKeysDoNotAssembleWholeMeta 钉住 P0-4：
// 四个 index key 只读自己那一小块，绝不再经过 meta()。
// meta() 会拉取 providers / model-groups / 群组 / 每个角色的会话索引 —— 这里全部必须为 0。
func TestIndexKeysDoNotAssembleWholeMeta(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	ctx := context.Background()

	chats, err := projection.chatsIndex(ctx)
	if err != nil {
		t.Fatalf("chatsIndex() error = %v", err)
	}
	if box.log.count(http.MethodGet, "/api/providers") != 0 {
		t.Fatalf("chats/index 不应拉取供应商：%#v", box.log.items)
	}
	if box.log.count(http.MethodGet, "/api/model-groups") != 0 {
		t.Fatalf("chats/index 不应拉取模型组：%#v", box.log.items)
	}
	if box.log.count(http.MethodGet, "/api/roles/role-1/sessions") != 0 {
		t.Fatalf("chats/index 不应拉取会话索引：%#v", box.log.items)
	}
	chatsMap := objectMap(chats)
	if got := stringSlice(chatsMap["roleOrder"]); len(got) != 2 || got[0] != "role-1" || got[1] != "role-2" {
		t.Fatalf("chats/index roleOrder = %#v", chatsMap["roleOrder"])
	}
	if got := stringMapValue(chatsMap["roleFolders"])["role-1"]; got != "角色一" {
		t.Fatalf("chats/index roleFolders = %#v", chatsMap["roleFolders"])
	}
	if _, exists := chatsMap["chatIndexByRole"]; exists {
		t.Fatalf("chats/index 形状不应包含 chatIndexByRole：%#v", chatsMap)
	}

	box.log.reset()
	providers, err := projection.providersIndex(ctx)
	if err != nil {
		t.Fatalf("providersIndex() error = %v", err)
	}
	if box.log.count(http.MethodGet, "/api/roles") != 0 || box.log.count(http.MethodGet, "/api/groups") != 0 {
		t.Fatalf("providers/index 不应拉取角色或群组：%#v", box.log.items)
	}
	if _, exists := objectMap(providers)["providerOrder"]; !exists {
		t.Fatalf("providers/index 形状不完整：%#v", providers)
	}

	box.log.reset()
	groups, err := projection.groupsIndex(ctx)
	if err != nil {
		t.Fatalf("groupsIndex() error = %v", err)
	}
	if box.log.count(http.MethodGet, "/api/roles") != 0 || box.log.count(http.MethodGet, "/api/providers") != 0 {
		t.Fatalf("groups/index 不应拉取角色或供应商：%#v", box.log.items)
	}
	if got := stringSlice(objectMap(groups)["groupOrder"]); len(got) != 1 || got[0] != "group-1" {
		t.Fatalf("groups/index groupOrder = %#v", objectMap(groups)["groupOrder"])
	}

	box.log.reset()
	modelGroups, err := projection.modelGroupsIndex(ctx)
	if err != nil {
		t.Fatalf("modelGroupsIndex() error = %v", err)
	}
	if box.log.count(http.MethodGet, "/api/roles") != 0 || box.log.count(http.MethodGet, "/api/groups") != 0 {
		t.Fatalf("model-groups/index 不应拉取角色或群组：%#v", box.log.items)
	}
	if _, exists := objectMap(modelGroups)["modelGroupOrder"]; !exists {
		t.Fatalf("model-groups/index 形状不完整：%#v", modelGroups)
	}
}

// TestMetaIsPureAssembly 钉住 P1：meta() 是纯组装，零 I/O。
// 预热之后把业务端彻底关掉，meta() 仍然必须成功且内容不变。
func TestMetaIsPureAssembly(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	ctx := context.Background()

	if err := projection.ensureMetaInputs(ctx); err != nil {
		t.Fatalf("ensureMetaInputs() error = %v", err)
	}
	// 会话索引的单位是 scope：meta 不会替任何 scope 做 I/O，
	// 需要出现在 meta 里的索引必须先被 sessionIndex.get 预热。
	if _, err := projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
		t.Fatalf("ensureSessionIndex() error = %v", err)
	}
	box.log.reset()
	first, err := projection.meta()
	if err != nil {
		t.Fatalf("meta() error = %v", err)
	}
	if box.log.total() != 0 {
		t.Fatalf("meta() 必须是纯组装，实际发生了 %d 次请求：%#v", box.log.total(), box.log.items)
	}

	box.server.Close()
	second, err := projection.meta()
	if err != nil {
		t.Fatalf("meta() 在业务端关闭后仍应成功：%v", err)
	}
	firstMap := objectMap(first)
	secondMap := objectMap(second)
	for _, key := range []string{"schemaVersion", "dataVersion", "roleOrder", "groupOrder", "providerOrder"} {
		left, _ := json.Marshal(firstMap[key])
		right, _ := json.Marshal(secondMap[key])
		if string(left) != string(right) {
			t.Fatalf("meta() 两次结果不一致：%s %s != %s", key, left, right)
		}
	}
	index := objectMap(objectMap(secondMap["chatIndexByRole"])["role-1"])
	if got := stringSlice(index["chatIds"]); len(got) != 2 {
		t.Fatalf("meta chatIndexByRole[role-1] chatIds = %#v", index["chatIds"])
	}
}

// TestMetaDoesNotForceLoadColdScopes 钉住「新接口不替别的 scope 做 I/O」：
// sessionIndex.get 只加载请求里的 scope，meta 的旧路径才需要全量预热。
func TestMetaDoesNotForceLoadColdScopes(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)
	ctx := context.Background()

	payload, _ := json.Marshal(map[string]any{
		"scopes": []any{map[string]any{"kind": "role", "targetId": "role-1"}},
	})
	if _, err := svc.dispatch(ctx, "aiChat.sessionIndex.get", payload); err != nil {
		t.Fatalf("sessionIndex.get error = %v", err)
	}
	if got := box.log.count(http.MethodGet, "/api/roles/role-2/sessions"); got != 0 {
		t.Fatalf("sessionIndex.get 不应预热未请求的 scope，实际 %d 次：%#v", got, box.log.items)
	}
	if got := box.log.count(http.MethodGet, "/api/groups/group-1/sessions"); got != 0 {
		t.Fatalf("sessionIndex.get 不应预热群组 scope，实际 %d 次：%#v", got, box.log.items)
	}

	// 未预热的 scope 在 meta 里是空索引（meta 不替它做 I/O）。
	meta := objectMap(mustMeta(t, svc.projection))
	index := objectMap(objectMap(meta["chatIndexByRole"])["role-2"])
	if got := stringSlice(index["chatIds"]); len(got) != 0 {
		t.Fatalf("冷 scope 在 meta 里应为空索引：%#v", index["chatIds"])
	}
}

// TestMetaCarriesLayeredVersions 钉住版本分层：
// updatedAt 只是展示字段，新鲜度靠 dataRevision / preferenceRevision / epoch。
func TestMetaCarriesLayeredVersions(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	ctx := context.Background()

	if _, err := projection.get(ctx, "meta/index"); err != nil {
		t.Fatalf("meta/index error = %v", err)
	}
	meta := objectMap(mustMeta(t, projection))
	if intField(meta, "dataRevision", 0) <= 0 {
		t.Fatalf("meta dataRevision 必须为正：%#v", meta["dataRevision"])
	}
	if intField(meta, "epoch", 0) <= 0 {
		t.Fatalf("meta epoch 必须为正：%#v", meta["epoch"])
	}

	// 偏好写入只推进 preferenceRevision，不改变 dataRevision。
	before := intField(meta, "dataRevision", 0)
	if err := projection.set(ctx, "chats/角色一/index", map[string]any{"activeChatId": "chat-2"}); err != nil {
		t.Fatalf("saveRoleChatIndex() error = %v", err)
	}
	after := objectMap(mustMeta(t, projection))
	if intField(after, "dataRevision", 0) != before {
		t.Fatalf("切换 activeChatId 不应改变 dataRevision：%d -> %d", before, intField(after, "dataRevision", 0))
	}
	if intField(after, "preferenceRevision", 0) <= 0 {
		t.Fatalf("preferenceRevision 必须为正：%#v", after["preferenceRevision"])
	}
	index := objectMap(objectMap(after["chatIndexByRole"])["role-1"])
	if got := stringField(index, "activeChatId"); got != "chat-2" {
		t.Fatalf("activeChatId = %q, want chat-2", got)
	}
}

func mustMeta(t *testing.T, projection *projectionService) any {
	t.Helper()
	value, err := projection.meta()
	if err != nil {
		t.Fatalf("meta() error = %v", err)
	}
	return value
}

// stringMapValue 读取 map[string]string 形状的投影字段（folder 映射就是这种形状）。
func stringMapValue(value any) map[string]string {
	if typed, ok := value.(map[string]string); ok {
		return typed
	}
	return map[string]string{}
}

// TestSessionIndexGetReturnsOnlyRequestedScopes 钉住 P2：
// 新接口按 scope 返回，不再默认返回全站 chatIndexByRole。
func TestSessionIndexGetReturnsOnlyRequestedScopes(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)

	payload, _ := json.Marshal(map[string]any{
		"scopes": []any{map[string]any{"kind": "role", "targetId": "role-1"}},
	})
	result, err := svc.dispatch(context.Background(), "aiChat.sessionIndex.get", payload)
	if err != nil {
		t.Fatalf("sessionIndex.get error = %v", err)
	}
	response := objectMap(result)
	indexes := objectList(response["indexes"])
	if len(indexes) != 1 {
		t.Fatalf("indexes = %#v", response["indexes"])
	}
	if got := stringField(indexes[0], "scope"); got != "role:role-1" {
		t.Fatalf("scope = %q", got)
	}
	if intField(response, "dataRevision", 0) <= 0 {
		t.Fatalf("sessionIndex.get dataRevision 必须为正：%#v", response["dataRevision"])
	}
	if got := stringSlice(indexes[0]["chatIds"]); len(got) != 2 {
		t.Fatalf("chatIds = %#v", indexes[0]["chatIds"])
	}
	// 未请求的 scope 不能被顺带加载。
	if box.log.count(http.MethodGet, "/api/roles/role-2/sessions") != 0 {
		t.Fatalf("sessionIndex.get 不应加载未请求的 scope：%#v", box.log.items)
	}
	if box.log.count(http.MethodGet, "/api/providers") != 0 {
		t.Fatalf("sessionIndex.get 不应装配全站 meta：%#v", box.log.items)
	}

	if _, err := svc.dispatch(context.Background(), "aiChat.sessionIndex.get", json.RawMessage(`{"scopes":[]}`)); err == nil {
		t.Fatalf("空 scopes 必须快速失败")
	}
	if _, err := svc.dispatch(context.Background(), "aiChat.sessionIndex.get", json.RawMessage(`{"scopes":[{"kind":"bogus","targetId":"x"}]}`)); err == nil {
		t.Fatalf("非法 scope 必须快速失败")
	}
}

// TestSessionSummaryListPagesWithinScope 钉住 P2 单 scope 分页。
func TestSessionSummaryListPagesWithinScope(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)

	payload, _ := json.Marshal(map[string]any{
		"scope": map[string]any{"kind": "role", "targetId": "role-1"},
		"limit": 1,
	})
	first, err := svc.dispatch(context.Background(), "aiChat.sessionSummary.list", payload)
	if err != nil {
		t.Fatalf("sessionSummary.list error = %v", err)
	}
	firstMap := objectMap(first)
	items := objectList(firstMap["items"])
	if len(items) != 1 {
		t.Fatalf("first page items = %#v", firstMap["items"])
	}
	// updatedAt 降序：chat-2（11:00）在 chat-1（10:00）之前。
	if got := stringField(items[0], "id"); got != "chat-2" {
		t.Fatalf("first item = %q, want chat-2", got)
	}
	cursor := stringField(firstMap, "nextCursor")
	if cursor != "chat-2" {
		t.Fatalf("nextCursor = %q", cursor)
	}

	nextPayload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"limit":  1,
		"cursor": cursor,
	})
	second, err := svc.dispatch(context.Background(), "aiChat.sessionSummary.list", nextPayload)
	if err != nil {
		t.Fatalf("sessionSummary.list(second) error = %v", err)
	}
	secondItems := objectList(objectMap(second)["items"])
	if len(secondItems) != 1 || stringField(secondItems[0], "id") != "chat-1" {
		t.Fatalf("second page items = %#v", objectMap(second)["items"])
	}
	if got := stringField(objectMap(second), "nextCursor"); got != "" {
		t.Fatalf("最后一页 nextCursor 应为空：%q", got)
	}
}

// TestSessionGetUsesScope 钉住 P2 详情层走 scope。
func TestSessionGetUsesScope(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", payload); err != nil {
		t.Fatalf("session.get error = %v", err)
	}
	if box.log.count(http.MethodGet, "/api/roles/role-1/sessions/chat-1") != 1 {
		t.Fatalf("session.get 应直读业务端会话：%#v", box.log.items)
	}
	if box.log.count(http.MethodGet, "/api/roles") != 0 {
		t.Fatalf("session.get 不应为了定位 folder 去列角色：%#v", box.log.items)
	}

	badPayload, _ := json.Marshal(map[string]any{"scope": map[string]any{"kind": "role", "targetId": "role-1"}})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", badPayload); err == nil {
		t.Fatalf("缺少 chatId 必须快速失败")
	}
}

// TestSetActiveChatIsIdempotentCommand 钉住决策 1：
// 只推进 preferenceRevision，幂等，不碰业务 revision。
func TestSetActiveChatIsIdempotentCommand(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)
	ctx := context.Background()

	payload, _ := json.Marshal(map[string]any{
		"scope":  map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId": "chat-2",
	})
	first, err := svc.dispatch(ctx, "aiChat.setActiveChat", payload)
	if err != nil {
		t.Fatalf("setActiveChat error = %v", err)
	}
	firstMap := objectMap(first)
	if firstMap["applied"] != true {
		t.Fatalf("setActiveChat applied = %#v", firstMap["applied"])
	}
	revision := intField(firstMap, "preferenceRevision", 0)
	if revision <= 0 {
		t.Fatalf("preferenceRevision = %d", revision)
	}

	second, err := svc.dispatch(ctx, "aiChat.setActiveChat", payload)
	if err != nil {
		t.Fatalf("setActiveChat(again) error = %v", err)
	}
	secondMap := objectMap(second)
	if secondMap["applied"] != true {
		t.Fatalf("幂等调用也应成功：%#v", secondMap)
	}
	if got := intField(secondMap, "preferenceRevision", 0); got != revision {
		t.Fatalf("幂等调用不应推进版本：%d != %d", got, revision)
	}

	stale, _ := json.Marshal(map[string]any{
		"scope":            map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":           "chat-1",
		"expectedRevision": 1,
	})
	staleResult, err := svc.dispatch(ctx, "aiChat.setActiveChat", stale)
	if err != nil {
		t.Fatalf("setActiveChat(stale) error = %v", err)
	}
	staleMap := objectMap(staleResult)
	if staleMap["applied"] != false || stringField(staleMap, "reason") != "revision_mismatch" {
		t.Fatalf("过期版本必须拒绝且说明原因：%#v", staleMap)
	}

	cfg, err := store.load()
	if err != nil {
		t.Fatalf("load config error = %v", err)
	}
	if got := cfg.Projection.ActiveChatByRole["role-1"]; got != "chat-2" {
		t.Fatalf("activeChatId = %q, want chat-2", got)
	}
}

// TestHealthCheckAdvertisesFeaturesWithoutBumpingProtocol 钉住 P3：
// 灰度靠 features，协议主版本保持不变（严格相等校验）。
//
// 这里只断言「本地能力」：依赖 box 端点的能力（session.get / session.window / ...）
// 必须由 box 的 release 资料逐项声明后才暴露，绝不无条件出现
// （见 capabilities_test.go 的灰度用例）。
func TestHealthCheckAdvertisesFeaturesWithoutBumpingProtocol(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	svc := newBusinessReadyTestService(store, nil)

	result, err := svc.dispatch(context.Background(), "aiChat.healthCheck", nil)
	if err != nil {
		t.Fatalf("healthCheck error = %v", err)
	}
	response := objectMap(result)
	if got := intField(response, "protocolVersion", 0); got != directProtocolVersion {
		t.Fatalf("protocolVersion = %d, want %d", got, directProtocolVersion)
	}
	features := stringSlice(response["features"])
	for _, expected := range localFeatureFlags() {
		found := false
		for _, feature := range features {
			if feature == expected {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("features 缺少本地能力 %q：%#v", expected, features)
		}
	}
	// box 未声明能力时，依赖 box 的 feature 必须缺席（灰度默认关闭）。
	for _, gated := range []string{featureSessionGet, featureSessionWindow, featureSessionViewPatch, featureSessionGraph} {
		for _, feature := range features {
			if feature == gated {
				t.Fatalf("box 未声明能力时不得暴露 %q：%#v", gated, features)
			}
		}
	}
}

// TestStorageGetManyIsMigrationShim 钉住 P3 迁移垫片：
// 一次往返拿多个旧 key，形状为 {values:{key:value}}。
func TestStorageGetManyIsMigrationShim(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)

	payload, _ := json.Marshal(map[string]any{
		"keys": []string{"chats/index", "providers/index", "model-groups/index", "groups/index"},
	})
	result, err := svc.dispatch(context.Background(), "aiChat.storageGetMany", payload)
	if err != nil {
		t.Fatalf("storageGetMany error = %v", err)
	}
	values := objectMap(objectMap(result)["values"])
	for _, key := range []string{"chats/index", "providers/index", "model-groups/index", "groups/index"} {
		if _, exists := values[key]; !exists {
			t.Fatalf("storageGetMany 缺少 %q：%#v", key, values)
		}
	}
	// 四个 key 走同一个投影服务，但彼此独立：只允许一次 /api/roles 与一次 /api/groups。
	if got := box.log.count(http.MethodGet, "/api/roles"); got != 1 {
		t.Fatalf("/api/roles 请求次数 = %d, want 1：%#v", got, box.log.items)
	}
	if got := box.log.count(http.MethodGet, "/api/groups"); got != 1 {
		t.Fatalf("/api/groups 请求次数 = %d, want 1：%#v", got, box.log.items)
	}

	if _, err := svc.dispatch(context.Background(), "aiChat.storageGetMany", json.RawMessage(`{"keys":[]}`)); err == nil {
		t.Fatalf("空 keys 必须快速失败")
	}
}

// TestSessionIndexSnapshotIsSingleFlight 钉住读模型并发合流：
// 同一 scope 的并发加载只打一次业务端。
func TestSessionIndexSnapshotIsSingleFlight(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	projection := newProjectionService(store, newEBClient(store, testClientRelease()))
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
				t.Errorf("ensureSessionIndex() error = %v", err)
			}
		}()
	}
	wg.Wait()
	if got := box.log.count(http.MethodGet, "/api/roles/role-1/sessions"); got != 1 {
		t.Fatalf("并发加载应单飞，实际 %d 次：%#v", got, box.log.items)
	}

	// 已缓存后再取，仍然零请求。
	box.log.reset()
	if _, err := projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
		t.Fatalf("ensureSessionIndex(cached) error = %v", err)
	}
	if box.log.total() != 0 {
		t.Fatalf("缓存命中不应再请求：%#v", box.log.items)
	}

	// 失效后必须重新读取。
	projection.model.sessions.invalidate(roleScope("role-1"))
	if _, err := projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
		t.Fatalf("ensureSessionIndex(after invalidate) error = %v", err)
	}
	if got := box.log.count(http.MethodGet, "/api/roles/role-1/sessions"); got != 1 {
		t.Fatalf("失效后应重读一次，实际 %d 次", got)
	}
}

// TestSessionIndexCacheSurvivesConnectionIdentity 钉住「bootstrap 反复调用不清缓存」：
// 只有连接身份变化才重置读模型，否则每次 bootstrap 都把缓存打空。
func TestSessionIndexCacheSurvivesConnectionIdentity(t *testing.T) {
	box := newFakeBox(t)
	store := box.store(t)
	svc := newBusinessReadyTestService(store, nil)
	ctx := context.Background()

	svc.setConnectionState(runtimeBootstrap{BusinessAvailable: true, EucliBoxURL: box.server.URL, EucliBoxVersion: "0.1.9"})
	if _, err := svc.projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
		t.Fatalf("ensureSessionIndex() error = %v", err)
	}
	box.log.reset()
	svc.setConnectionState(runtimeBootstrap{BusinessAvailable: true, EucliBoxURL: box.server.URL, EucliBoxVersion: "0.1.9"})
	if _, err := svc.projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
		t.Fatalf("ensureSessionIndex() error = %v", err)
	}
	if box.log.total() != 0 {
		t.Fatalf("连接身份未变时不应重置读模型：%#v", box.log.items)
	}

	svc.setConnectionState(runtimeBootstrap{BusinessAvailable: true, EucliBoxURL: box.server.URL, EucliBoxVersion: "0.2.0"})
	if _, err := svc.projection.ensureSessionIndex(ctx, roleScope("role-1")); err != nil {
		t.Fatalf("ensureSessionIndex() error = %v", err)
	}
	if got := box.log.count(http.MethodGet, "/api/roles/role-1/sessions"); got != 1 {
		t.Fatalf("连接身份变化必须重置读模型，实际重读 %d 次", got)
	}
}
