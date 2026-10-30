package main

import (
	"context"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// 切换观测（studio 侧边界 + box 一跳）。
//
// 三跳贯穿（design-5 §十二 P0）：前端 → studio → box 用同一个 X-Eucli-Trace 贯穿。
//   frontend.select / frontend.command       前端 switchSpan 上报
//   studio.dispatch / studio.dispatch.done   命令在 studio 侧进入 / 结束分发
//   studio.event                             事件在 studio 侧投递给前端
//   studio.box.request / studio.box.response studio → box 这一跳（带 X-Eucli-Trace 头）
//
// box handler 在业务端仓库，不属于本工作区；它的边界由 X-Eucli-Trace 头关联。
//
// 观测是纯旁路：默认 sink 只做一次结构化日志，可用 setSwitchTraceSink 关闭。
// 任何观测路径都不得改变行为分支。

type switchMark struct {
	SwitchID string `json:"switchId"`
	Boundary string `json:"boundary"`
	Method   string `json:"method,omitempty"`
	Scope    string `json:"scope,omitempty"`
	Elapsed  int64  `json:"elapsedMs,omitempty"`
	Status   string `json:"status,omitempty"`
}

type switchTraceSink func(mark switchMark)

var (
	switchTraceMu    sync.RWMutex
	switchTraceSink_ switchTraceSink = func(mark switchMark) {
		log.Printf("switch trace: %s %s method=%s scope=%s elapsed=%dms status=%s", mark.SwitchID, mark.Boundary, mark.Method, mark.Scope, mark.Elapsed, mark.Status)
	}
)

func setSwitchTraceSink(next switchTraceSink) {
	switchTraceMu.Lock()
	switchTraceSink_ = next
	switchTraceMu.Unlock()
}

func traceSwitch(mark switchMark) {
	switchTraceMu.RLock()
	sink := switchTraceSink_
	switchTraceMu.RUnlock()
	if sink == nil {
		return
	}
	mark.SwitchID = strings.TrimSpace(mark.SwitchID)
	if mark.SwitchID == "" {
		return
	}
	sink(mark)
}

func switchElapsedSince(start time.Time) int64 {
	return time.Since(start).Milliseconds()
}

// traceContextKey 承载「本次请求的三跳关联键」。
//
// 用 context 而不是给每个 ebRequest 加字段：所有出站路径（会话正文、窗口、
// 图片、上传、netRequest…）都会自动继承同一个 trace，不存在漏配点。
type traceContextKey struct{}

func withTraceID(ctx context.Context, traceID string) context.Context {
	id := strings.TrimSpace(traceID)
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, traceContextKey{}, id)
}

func traceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(traceContextKey{}).(string)
	return strings.TrimSpace(value)
}

// requestPeekContextKey 承载「已经解析过一次」的请求预览。
//
// reader 用它做分道与超时分类，dispatch 用它做观测与 trace 注入：
// 同一个 params 在一条请求链路上只被反序列化一次（大 storageSet 不再双重全量扫描）。
type requestPeekContextKey struct{}

func withRequestPeek(ctx context.Context, peek requestPeek) context.Context {
	return context.WithValue(ctx, requestPeekContextKey{}, peek)
}

func requestPeekFromContext(ctx context.Context) (requestPeek, bool) {
	if ctx == nil {
		return requestPeek{}, false
	}
	peek, ok := ctx.Value(requestPeekContextKey{}).(requestPeek)
	return peek, ok
}

// traceIDSequence 在请求完全没有 switchId / loadId 时生成一个可关联的 trace。
// 它只用于「这一跳自己发起的请求」，绝不参与任何行为分支。
var traceIDSequence uint64

func nextTraceID() string {
	seq := atomic.AddUint64(&traceIDSequence, 1)
	return "tx-" + strconv.FormatInt(time.Now().UnixNano(), 36) + "-" + strconv.FormatUint(seq, 36)
}

// resolveTraceID 决定这一次请求携带的 X-Eucli-Trace：
// 请求自带 switchId 就用它（三跳同源），否则生成一个本跳专用 trace。
func resolveTraceID(switchID string) string {
	if id := strings.TrimSpace(switchID); id != "" {
		return id
	}
	return nextTraceID()
}
