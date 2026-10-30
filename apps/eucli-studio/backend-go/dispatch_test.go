package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// 分道分类是并发治理的唯一判定点，必须逐条钉死。

func paramsOf(t *testing.T, value map[string]any) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal params error = %v", err)
	}
	return payload
}

func TestClassifyRequestPutsHealthCheckOnControlLane(t *testing.T) {
	intent := classifyRequest("aiChat.healthCheck", requestPeek{})
	if intent.lane != laneControl {
		t.Fatalf("healthCheck lane = %v, want control", intent.lane)
	}
	if intent.sequenceKey != "" {
		t.Fatalf("healthCheck 不应有序列键：%q", intent.sequenceKey)
	}
}

func TestClassifyRequestKeepsRuntimeReadsOffRemoteLane(t *testing.T) {
	params := paramsOf(t, map[string]any{"key": "runtime/lock.chat.role.role-1.chat-1"})
	intent := classifyRequest("aiChat.storageGet", peekRequestParams("aiChat.storageGet", params))
	if intent.lane != laneLocal {
		t.Fatalf("runtime read lane = %v, want local（长请求期间它必须不被饿死）", intent.lane)
	}
}

func TestClassifyRequestSerializesRuntimeWrites(t *testing.T) {
	params := paramsOf(t, map[string]any{"key": "runtime/lock.chat.role.role-1.chat-1", "value": map[string]any{}})
	intent := classifyRequest("aiChat.storageSet", peekRequestParams("aiChat.storageSet", params))
	if intent.lane != laneLocal {
		t.Fatalf("runtime write lane = %v, want local", intent.lane)
	}
	if intent.sequenceKey != "runtime:lock.chat.role.role-1.chat-1" {
		t.Fatalf("runtime write sequence = %q", intent.sequenceKey)
	}
}

func TestClassifyRequestSerializesStorageWritesPerKey(t *testing.T) {
	params := paramsOf(t, map[string]any{"key": "meta/index", "value": map[string]any{}})
	intent := classifyRequest("aiChat.storageSet", peekRequestParams("aiChat.storageSet", params))
	if intent.lane != laneRemote {
		t.Fatalf("meta write lane = %v, want remote", intent.lane)
	}
	if intent.sequenceKey != "storage:meta/index" {
		t.Fatalf("meta write sequence = %q", intent.sequenceKey)
	}

	readParams := paramsOf(t, map[string]any{"key": "meta/index"})
	read := classifyRequest("aiChat.storageGet", peekRequestParams("aiChat.storageGet", readParams))
	if read.lane != laneRemote || read.sequenceKey != "" {
		t.Fatalf("storage read 不该串行：%#v", read)
	}
}

func TestClassifyRequestRoutesClientStateLocally(t *testing.T) {
	params := paramsOf(t, map[string]any{"key": "client-state/ui", "value": map[string]any{}})
	intent := classifyRequest("aiChat.storageSet", peekRequestParams("aiChat.storageSet", params))
	if intent.lane != laneLocal {
		t.Fatalf("client-state lane = %v, want local", intent.lane)
	}
	if intent.sequenceKey != "storage:client-state/ui" {
		t.Fatalf("client-state sequence = %q", intent.sequenceKey)
	}
}

func TestClassifyRequestSharesConnectionSequence(t *testing.T) {
	if intent := classifyRequest("eucli.config.set", requestPeek{}); intent.sequenceKey != connectionSequenceKey {
		t.Fatalf("config.set sequence = %q", intent.sequenceKey)
	}
	if intent := classifyRequest("studio.bootstrap", requestPeek{}); intent.sequenceKey != connectionSequenceKey {
		t.Fatalf("bootstrap sequence = %q", intent.sequenceKey)
	}
}

func TestClassifyRequestKeepsWallpaperWritesLocal(t *testing.T) {
	params := paramsOf(t, map[string]any{"path": "wallpapers/bg.png", "dataUrl": "data:"})
	intent := classifyRequest("aiChat.imageWrite", peekRequestParams("aiChat.imageWrite", params))
	if intent.lane != laneLocal {
		t.Fatalf("wallpaper write lane = %v, want local", intent.lane)
	}
	if intent.sequenceKey != "image:wallpapers/bg.png" {
		t.Fatalf("wallpaper write sequence = %q", intent.sequenceKey)
	}

	remote := classifyRequest("aiChat.imageRead", peekRequestParams("aiChat.imageRead", paramsOf(t, map[string]any{"path": "roles/r/avatar.png"})))
	if remote.lane != laneRemote {
		t.Fatalf("avatar read lane = %v, want remote", remote.lane)
	}
}

func TestClassifyRequestDefaultsUnknownMethodsToRemote(t *testing.T) {
	intent := classifyRequest("aiChat.netRequest", peekRequestParams("aiChat.netRequest", paramsOf(t, map[string]any{"path": "/api/runs"})))
	if intent.lane != laneRemote {
		t.Fatalf("netRequest lane = %v, want remote", intent.lane)
	}
}

func TestLaneGateRejectsInsteadOfBlocking(t *testing.T) {
	gate := newLaneGate(2)
	if !gate.tryAcquire() || !gate.tryAcquire() {
		t.Fatal("前两个名额必须拿到")
	}
	if gate.tryAcquire() {
		t.Fatal("名额耗尽时必须立刻拒绝，而不是阻塞 reader")
	}
	gate.release()
	if !gate.tryAcquire() {
		t.Fatal("释放后必须能再次拿到名额")
	}
}

// TestPeekReadsOnlyClassificationFields 钉住「reader 不做全量扫描」：
// 大 value / body 只作为原始字节保留，不被重建进对象图。
func TestPeekReadsOnlyClassificationFields(t *testing.T) {
	bigValue := strings.Repeat("x", 512*1024)
	params := paramsOf(t, map[string]any{
		"key":   "meta/index",
		"value": bigValue,
	})
	peek := peekRequestParams("aiChat.storageSet", params)
	if peek.Key != "meta/index" {
		t.Fatalf("key = %q", peek.Key)
	}
	// 预览结构里根本不带 value 字段：大载荷不可能被重建。
	if peek.SwitchID != "" || peek.ImagePath != "" {
		t.Fatalf("预览不应产出无关字段：%#v", peek)
	}
}

// TestPeekIsReusedByClassifyAndTimeout 钉住同一条链路只解析一次：
// reader 的预览同时喂给分道与超时分类，两者必须一致。
func TestPeekIsReusedByClassifyAndTimeout(t *testing.T) {
	params := paramsOf(t, map[string]any{"method": "POST", "path": "/api/runs/run-1/cancel"})
	peek := peekRequestParams("aiChat.netRequest", params)
	if intent := classifyRequest("aiChat.netRequest", peek); intent.lane != laneRemote {
		t.Fatalf("cancel 应走 remote 道：%v", intent.lane)
	}
	if got := methodTimeoutClass("aiChat.netRequest", peek.Envelope); got != timeoutClassInteraction {
		t.Fatalf("cancel 应属交互类：%v", got)
	}
}
