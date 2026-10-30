package main

import (
	"context"
	"encoding/json"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// 读模型四分（design-1 P1）：
//
//	EntityCatalog 角色 / 供应商 / 群组 / 模型组（实体集合事实）
//	SessionIndex  每个 scope 一份不可变会话索引快照 + revision
//	ChatBody      单会话详情（只做并发合流，不保留，避免无失效通道的脏读）
//	ConfigSurface 客户端投影配置（ui / settings / folder 映射 / 偏好版本）
//
// 三条边界：
//  1. 读模型只缓存「派生自业务端」的不可变快照，权威始终在 eucli-box；
//  2. activeChatId 属于 UI 偏好，绝不进数据 revision；
//  3. meta() 只做组装，不做任何 I/O；预热由显式 ensure 完成。

const (
	sessionScopeKindRole  = "role"
	sessionScopeKindGroup = "group"
)

// ---- singleflight：同键并发只执行一次，失败不缓存 ----

type flightGroup struct {
	mu    sync.Mutex
	calls map[string]*flightCall
}

type flightCall struct {
	wg  sync.WaitGroup
	val any
	err error
}

func newFlightGroup() *flightGroup {
	return &flightGroup{calls: map[string]*flightCall{}}
}

func (g *flightGroup) do(key string, fn func() (any, error)) (any, error) {
	g.mu.Lock()
	if call, ok := g.calls[key]; ok {
		g.mu.Unlock()
		call.wg.Wait()
		return call.val, call.err
	}
	call := &flightCall{}
	call.wg.Add(1)
	g.calls[key] = call
	g.mu.Unlock()

	call.val, call.err = fn()
	call.wg.Done()

	g.mu.Lock()
	delete(g.calls, key)
	g.mu.Unlock()
	return call.val, call.err
}

// revisionHash 把一组值折叠成稳定 revision。
// 只做内容指纹，不引入时间：同样的数据永远得到同样的版本。
func revisionHash(values ...any) int64 {
	h := fnv.New64a()
	for _, value := range values {
		_, _ = h.Write([]byte(strings.TrimSpace(toStringValue(value))))
		_, _ = h.Write([]byte{0})
	}
	sum := int64(h.Sum64() & 0x7fffffffffffffff)
	if sum == 0 {
		return 1
	}
	return sum
}

func toStringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case int64:
		return strconv.FormatInt(typed, 10)
	case int:
		return strconv.Itoa(typed)
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case bool:
		if typed {
			return "1"
		}
		return "0"
	default:
		return ""
	}
}

// ---- EntityCatalog ----

type entitySnapshot struct {
	items    []map[string]any
	revision int64
}

func newEntitySnapshot(items []map[string]any) *entitySnapshot {
	return &entitySnapshot{items: items, revision: entityRevision(items)}
}

func entityRevision(items []map[string]any) int64 {
	parts := make([]string, 0, len(items)*3)
	for _, item := range items {
		parts = append(parts, stringField(item, "id"), stringField(item, "name"), stringField(item, "updatedAt"))
	}
	sort.Strings(parts)
	values := make([]any, 0, len(parts))
	for _, part := range parts {
		values = append(values, part)
	}
	return revisionHash(values...)
}

type entityCache struct {
	mu       sync.RWMutex
	snapshot *entitySnapshot
	flight   *flightGroup
}

func newEntityCache() *entityCache {
	return &entityCache{flight: newFlightGroup()}
}

// peek 只读快照，永不触发 I/O：这是 meta() 保持纯组装的基础。
func (c *entityCache) peek() *entitySnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshot
}

func (c *entityCache) items() []map[string]any {
	snapshot := c.peek()
	if snapshot == nil {
		return nil
	}
	return snapshot.items
}

func (c *entityCache) revision() int64 {
	snapshot := c.peek()
	if snapshot == nil {
		return 0
	}
	return snapshot.revision
}

// load 返回快照；快照缺席时才真正读业务端，并发调用按单飞合流。
func (c *entityCache) load(ctx context.Context, key string, loader func(context.Context) ([]map[string]any, error)) (*entitySnapshot, error) {
	if snapshot := c.peek(); snapshot != nil {
		return snapshot, nil
	}
	// 合流体不应该被首个调用方的取消打断，否则所有等待者一起失败。
	detached := context.WithoutCancel(ctx)
	value, err := c.flight.do(key, func() (any, error) {
		if snapshot := c.peek(); snapshot != nil {
			return snapshot, nil
		}
		items, loadErr := loader(detached)
		if loadErr != nil {
			return nil, loadErr
		}
		snapshot := newEntitySnapshot(items)
		c.mu.Lock()
		c.snapshot = snapshot
		c.mu.Unlock()
		return snapshot, nil
	})
	if err != nil {
		return nil, err
	}
	snapshot, _ := value.(*entitySnapshot)
	return snapshot, nil
}

func (c *entityCache) invalidate() {
	c.mu.Lock()
	c.snapshot = nil
	c.mu.Unlock()
}

type entityCatalog struct {
	roles       *entityCache
	providers   *entityCache
	groups      *entityCache
	modelGroups *entityCache
}

func newEntityCatalog() *entityCatalog {
	return &entityCatalog{
		roles:       newEntityCache(),
		providers:   newEntityCache(),
		groups:      newEntityCache(),
		modelGroups: newEntityCache(),
	}
}

func (c *entityCatalog) invalidateAll() {
	c.roles.invalidate()
	c.providers.invalidate()
	c.groups.invalidate()
	c.modelGroups.invalidate()
}

// ---- objectCache：非实体集合的派生快照（例如四个 assist 配置） ----

type objectSnapshot struct {
	value    map[string]any
	revision int64
}

type objectCache struct {
	mu       sync.RWMutex
	snapshot *objectSnapshot
	flight   *flightGroup
}

func newObjectCache() *objectCache {
	return &objectCache{flight: newFlightGroup()}
}

func (c *objectCache) peek() *objectSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshot
}

func (c *objectCache) load(ctx context.Context, key string, loader func(context.Context) (map[string]any, error)) (*objectSnapshot, error) {
	if snapshot := c.peek(); snapshot != nil {
		return snapshot, nil
	}
	detached := context.WithoutCancel(ctx)
	value, err := c.flight.do(key, func() (any, error) {
		if snapshot := c.peek(); snapshot != nil {
			return snapshot, nil
		}
		loaded, loadErr := loader(detached)
		if loadErr != nil {
			return nil, loadErr
		}
		keys := make([]string, 0, len(loaded))
		for name := range loaded {
			keys = append(keys, name)
		}
		sort.Strings(keys)
		parts := make([]any, 0, len(keys)*2)
		for _, name := range keys {
			parts = append(parts, name, toStringValue(objectMap(loaded[name])["updatedAt"]))
		}
		snapshot := &objectSnapshot{value: loaded, revision: revisionHash(parts...)}
		c.mu.Lock()
		c.snapshot = snapshot
		c.mu.Unlock()
		return snapshot, nil
	})
	if err != nil {
		return nil, err
	}
	snapshot, _ := value.(*objectSnapshot)
	return snapshot, nil
}

func (c *objectCache) invalidate() {
	c.mu.Lock()
	c.snapshot = nil
	c.mu.Unlock()
}

// ---- SessionIndex ----

type sessionScope struct {
	Kind     string
	TargetID string
}

func (s sessionScope) key() string {
	return s.Kind + ":" + s.TargetID
}

func (s sessionScope) valid() bool {
	if s.Kind != sessionScopeKindRole && s.Kind != sessionScopeKindGroup {
		return false
	}
	return strings.TrimSpace(s.TargetID) != ""
}

// parseSessionScope 接受 {kind,targetId} 对象或 "role:xxx" 字符串两种形态。
func parseSessionScope(raw any) (sessionScope, bool) {
	if text, ok := raw.(string); ok {
		parts := strings.SplitN(strings.TrimSpace(text), ":", 2)
		if len(parts) != 2 {
			return sessionScope{}, false
		}
		scope := sessionScope{Kind: strings.TrimSpace(parts[0]), TargetID: strings.TrimSpace(parts[1])}
		return scope, scope.valid()
	}
	value := objectMap(raw)
	scope := sessionScope{Kind: stringField(value, "kind"), TargetID: stringField(value, "targetId")}
	return scope, scope.valid()
}

type sessionIndexSnapshot struct {
	// index 只承载数据事实（chatIds / chatUpdatedAt / chatMetas / updatedAt）。
	// activeChatId 是 UI 偏好，由读取方按当前偏好现场组装。
	index    map[string]any
	revision int64
	epoch    int64
}

func sessionIndexRevision(index map[string]any) int64 {
	values := []any{}
	for _, id := range stringSlice(index["chatIds"]) {
		values = append(values, id)
		updated := objectMap(index["chatUpdatedAt"])
		values = append(values, toStringValue(updated[id]))
	}
	for _, meta := range objectList(index["chatMetas"]) {
		values = append(values, stringField(meta, "title"), stringField(meta, "lastMessagePreview"))
	}
	return revisionHash(values...)
}

type sessionScopeCache struct {
	mu       sync.RWMutex
	snapshot *sessionIndexSnapshot
	flight   *flightGroup
}

func newSessionScopeCache() *sessionScopeCache {
	return &sessionScopeCache{flight: newFlightGroup()}
}

func (c *sessionScopeCache) peek() *sessionIndexSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshot
}

func (c *sessionScopeCache) store(snapshot *sessionIndexSnapshot) {
	c.mu.Lock()
	c.snapshot = snapshot
	c.mu.Unlock()
}

func (c *sessionScopeCache) invalidate() {
	c.mu.Lock()
	c.snapshot = nil
	c.mu.Unlock()
}

type sessionIndexCache struct {
	mu      sync.RWMutex
	scopes  map[string]*sessionScopeCache
	epoch   int64
	dataRev int64
}

func newSessionIndexCache() *sessionIndexCache {
	return &sessionIndexCache{scopes: map[string]*sessionScopeCache{}, epoch: nowMillis(), dataRev: 1}
}

func (c *sessionIndexCache) epochValue() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.epoch
}

// bumpDataRevision 在「会话数据快照真的换了」时推进数据版本。
// 它是单调计数器，不是内容指纹：前端只做「变了没」判断，不做比较大小以外的推断。
func (c *sessionIndexCache) bumpDataRevision() {
	c.mu.Lock()
	c.dataRev++
	c.mu.Unlock()
}

func (c *sessionIndexCache) dataRevision() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.dataRev
}

func (c *sessionIndexCache) scope(scope sessionScope) *sessionScopeCache {
	key := scope.key()
	c.mu.RLock()
	entry, ok := c.scopes[key]
	c.mu.RUnlock()
	if ok {
		return entry
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.scopes[key]; ok {
		return entry
	}
	entry = newSessionScopeCache()
	c.scopes[key] = entry
	return entry
}

func (c *sessionIndexCache) peek(scope sessionScope) *sessionIndexSnapshot {
	if !scope.valid() {
		return nil
	}
	key := scope.key()
	c.mu.RLock()
	entry, ok := c.scopes[key]
	c.mu.RUnlock()
	if !ok {
		return nil
	}
	return entry.peek()
}

func (c *sessionIndexCache) load(ctx context.Context, scope sessionScope, loader func(context.Context) (map[string]any, error)) (*sessionIndexSnapshot, error) {
	entry := c.scope(scope)
	if snapshot := entry.peek(); snapshot != nil {
		return snapshot, nil
	}
	detached := context.WithoutCancel(ctx)
	value, err := entry.flight.do(scope.key(), func() (any, error) {
		if snapshot := entry.peek(); snapshot != nil {
			return snapshot, nil
		}
		index, loadErr := loader(detached)
		if loadErr != nil {
			return nil, loadErr
		}
		snapshot := &sessionIndexSnapshot{index: index, revision: sessionIndexRevision(index), epoch: c.epochValue()}
		entry.store(snapshot)
		c.bumpDataRevision()
		return snapshot, nil
	})
	if err != nil {
		return nil, err
	}
	snapshot, _ := value.(*sessionIndexSnapshot)
	return snapshot, nil
}

func (c *sessionIndexCache) invalidate(scope sessionScope) {
	if !scope.valid() {
		return
	}
	key := scope.key()
	c.mu.RLock()
	entry, ok := c.scopes[key]
	c.mu.RUnlock()
	if !ok {
		return
	}
	entry.invalidate()
	c.bumpDataRevision()
}

// invalidateAll 是「索引重建」语义：清空所有 scope 并推进 epoch。
func (c *sessionIndexCache) invalidateAll() {
	c.mu.Lock()
	c.scopes = map[string]*sessionScopeCache{}
	c.epoch = nowMillis()
	c.dataRev++
	c.mu.Unlock()
}

// ---- ChatBody ----

// chatBodyReader 只做并发合流，不保留结果：会话载荷没有事件失效通道之前，
// 任何跨请求保留都会把「已经改过的会话」当成新数据读出来。
//
// 它承接的是业务端原始字节，不做任何投影：studio 不再是「第二份会话模型」。
type chatBodyReader struct {
	flight *flightGroup
}

func newChatBodyReader() *chatBodyReader {
	return &chatBodyReader{flight: newFlightGroup()}
}

func (r *chatBodyReader) read(ctx context.Context, key string, loader func(context.Context) (json.RawMessage, error)) (json.RawMessage, error) {
	detached := context.WithoutCancel(ctx)
	value, err := r.flight.do(key, func() (any, error) {
		return loader(detached)
	})
	if err != nil {
		return nil, err
	}
	payload, _ := value.(json.RawMessage)
	return payload, nil
}

// reset 作废所有在途合流：视图（head）改变后，旧的读取结果属于旧路径，
// 绝不能被后续请求复用。合流表本身不保留已完成结果，清空即可。
func (r *chatBodyReader) reset() {
	r.flight = newFlightGroup()
}

// ---- 组装 ----

type readModel struct {
	catalog  *entityCatalog
	sessions *sessionIndexCache
	bodies   *chatBodyReader
	assist   *objectCache
}

func newReadModel() *readModel {
	return &readModel{
		catalog:  newEntityCatalog(),
		sessions: newSessionIndexCache(),
		bodies:   newChatBodyReader(),
		assist:   newObjectCache(),
	}
}

func (m *readModel) epoch() int64 {
	return m.sessions.epochValue()
}

func (m *readModel) dataRevision() int64 {
	return m.sessions.dataRevision()
}
