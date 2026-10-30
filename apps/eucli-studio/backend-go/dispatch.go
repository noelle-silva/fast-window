package main

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
)

// 分道并发（design-5 决策 2）：
//
//	reader（1 goroutine，只做校验 + 门禁 + 入道）
//	  ├─ control 道：healthCheck，永不占名额
//	  ├─ local 道：client-state / runtime / wallpaper / 客户端配置（纯本地）
//	  └─ remote 道：HTTP 到 box
//
// 为什么要分道：否则 5 个长 netRequest 会把纯内存的 storageGet("runtime/...")
// 一起饿死，而前端切换正依赖这类轻请求。
//
// 为什么不用固定 worker 池：慢请求会长期占住 worker，退化成更粗的队头阻塞。
// 这里用「信号量 + 每请求 goroutine」：名额满时只拒绝该帧（SERVER_BUSY），
// 不排队、不中断连接。

type requestLane int

const (
	laneControl requestLane = iota
	laneLocal
	laneRemote
)

const (
	localLaneConcurrency  = 4
	remoteLaneConcurrency = 6
)

// laneGate 是「道」的并发名额：TryAcquire 永不阻塞 reader。
type laneGate struct {
	tokens chan struct{}
}

func newLaneGate(limit int) *laneGate {
	return &laneGate{tokens: make(chan struct{}, limit)}
}

func (g *laneGate) tryAcquire() bool {
	select {
	case g.tokens <- struct{}{}:
		return true
	default:
		return false
	}
}

func (g *laneGate) release() {
	select {
	case <-g.tokens:
	default:
	}
}

// keyGate 是 per-key 序列门：同一资源上的请求严格 FIFO。
//
// 它只保证「顺序」，不保证「并发」：不同 key 完全并行。
// 等待发生在 worker goroutine 内（不占 reader），取消时把令牌接力给下一位，
// 因此 ctx 取消不会破坏队列的 FIFO 结构。
type keyGate struct {
	mu      sync.Mutex
	waiters map[string][]chan struct{}
}

func newKeyGate() *keyGate {
	return &keyGate{waiters: map[string][]chan struct{}{}}
}

func (g *keyGate) acquire(ctx context.Context, key string) error {
	g.mu.Lock()
	token := make(chan struct{}, 1)
	queue := append(g.waiters[key], token)
	g.waiters[key] = queue
	granted := len(queue) == 1
	g.mu.Unlock()
	if granted {
		return nil
	}
	select {
	case <-token:
		return nil
	case <-ctx.Done():
		// 取消的等待者仍然占着队位：由接力 goroutine 收下令牌并交给下一位，
		// 这样既不会跳过别人，也不会永久卡住队列。
		go func() {
			<-token
			g.release(key)
		}()
		return ctx.Err()
	}
}

func (g *keyGate) release(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	queue := g.waiters[key]
	if len(queue) == 0 {
		return
	}
	queue = queue[1:]
	if len(queue) == 0 {
		delete(g.waiters, key)
		return
	}
	g.waiters[key] = queue
	select {
	case queue[0] <- struct{}{}:
	default:
	}
}

// dispatchIntent 是「这一帧走哪条道、按什么序列键排队」的唯一判定结果。
type dispatchIntent struct {
	lane        requestLane
	sequenceKey string
}

const (
	storageSequencePrefix = "storage:"
	runtimeSequencePrefix = "runtime:"
	imageSequencePrefix   = "image:"
	connectionSequenceKey = "connection"
)

// requestPeek 是一次「轻量预览」：只解出分道与超时分类需要的字段。
//
// reader 只解一次，结果同时喂给 classifyRequest / methodTimeoutClass / dispatch：
// 大 storageSet 的 params 不再被全量扫描两遍。
// value 是懒加载的——只有真正需要它的 handler 才会再次解析（那里本来就要全量）。
type requestPeek struct {
	// Key 是 storage key（storageGet/Set/Remove）。
	Key string
	// ImagePath 是 imageRead/Write/Delete 的路径。
	ImagePath string
	// Envelope 是透传请求（netRequest / eb.request）的 method / path。
	Envelope ebRequest
	// SwitchID / Scope 是观测关联键。
	SwitchID string
	Scope    string
}

// peekRequestParams 只解出「分道 / 超时 / 观测」需要的字段。
// 用 json.RawMessage 承接大字段（value / body），避免把它们重建进对象图。
func peekRequestParams(method string, params json.RawMessage) requestPeek {
	var peek requestPeek
	trimmed := paramsOrEmpty(params)
	var probe struct {
		Key      string          `json:"key"`
		Path     string          `json:"path"`
		RelPath  string          `json:"relPath"`
		Method   string          `json:"method"`
		URL      string          `json:"url"`
		SwitchID string          `json:"switchId"`
		Scope    json.RawMessage `json:"scope"`
	}
	if err := json.Unmarshal(trimmed, &probe); err != nil {
		return peek
	}
	peek.Key = strings.TrimSpace(probe.Key)
	if path := strings.TrimSpace(probe.Path); path != "" {
		peek.ImagePath = path
	} else {
		peek.ImagePath = strings.TrimSpace(probe.RelPath)
	}
	peek.SwitchID = strings.TrimSpace(probe.SwitchID)
	if len(probe.Scope) > 0 {
		var scope any
		if err := json.Unmarshal(probe.Scope, &scope); err == nil {
			if parsed, ok := parseSessionScope(scope); ok {
				peek.Scope = parsed.key()
			}
		}
	}
	if method == "aiChat.netRequest" || method == "eucli.eb.request" {
		path := strings.TrimSpace(probe.Path)
		if path == "" {
			path = strings.TrimSpace(probe.URL)
		}
		peek.Envelope = ebRequest{Method: probe.Method, Path: path}
	}
	return peek
}

// classifyRequest 只依赖 method + peek，不产生任何副作用。
func classifyRequest(method string, peek requestPeek) dispatchIntent {
	if method == "aiChat.healthCheck" {
		return dispatchIntent{lane: laneControl}
	}
	switch method {
	case "aiChat.storageGet", "aiChat.storageSet", "aiChat.storageRemove":
		key := peek.Key
		if key == "" {
			return dispatchIntent{lane: laneLocal}
		}
		if logicalKey, isRuntime := runtimeLogicalKey(key); isRuntime {
			if method == "aiChat.storageGet" {
				return dispatchIntent{lane: laneLocal}
			}
			return dispatchIntent{lane: laneLocal, sequenceKey: runtimeSequencePrefix + logicalKey}
		}
		if _, isClientState := clientStateLogicalKey(key); isClientState {
			if method == "aiChat.storageGet" {
				return dispatchIntent{lane: laneLocal}
			}
			return dispatchIntent{lane: laneLocal, sequenceKey: storageSequencePrefix + key}
		}
		if method == "aiChat.storageGet" {
			return dispatchIntent{lane: laneRemote}
		}
		// meta/index 内含 4 次 assist 配置写，必须与同类写入严格有序。
		return dispatchIntent{lane: laneRemote, sequenceKey: storageSequencePrefix + key}
	case "aiChat.imageRead", "aiChat.imageWrite", "aiChat.imageDelete":
		path := peek.ImagePath
		if isWallpaperRelPath(path) {
			if method == "aiChat.imageRead" {
				return dispatchIntent{lane: laneLocal}
			}
			return dispatchIntent{lane: laneLocal, sequenceKey: imageSequencePrefix + path}
		}
		if method == "aiChat.imageRead" {
			return dispatchIntent{lane: laneRemote}
		}
		return dispatchIntent{lane: laneRemote, sequenceKey: imageSequencePrefix + path}
	case "eucli.config.get":
		return dispatchIntent{lane: laneLocal}
	case "eucli.config.set":
		// 配置写入会清空连接状态机：与 bootstrap 共用 connection 序列键。
		return dispatchIntent{lane: laneLocal, sequenceKey: connectionSequenceKey}
	case "studio.bootstrap":
		// bootstrap 读取 box 并推进连接状态机：必须与 config.set 有序。
		return dispatchIntent{lane: laneRemote, sequenceKey: connectionSequenceKey}
	case "aiChat.setActiveChat":
		// 偏好命令写客户端投影配置：与 meta 写共用一把序列门。
		return dispatchIntent{lane: laneLocal, sequenceKey: storageSequencePrefix + "meta/index"}
	default:
		return dispatchIntent{lane: laneRemote}
	}
}
