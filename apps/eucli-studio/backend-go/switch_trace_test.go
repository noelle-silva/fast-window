package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// 三跳贯穿（design-5 §十二 P0）：前端 → studio → box 用同一个 X-Eucli-Trace。

func captureTraceHeader(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	traces := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		traces = append(traces, r.Header.Get(traceHeaderName))
		mu.Unlock()
		_, _ = io.WriteString(w, `{"data":{"ok":true}}`)
	}))
	t.Cleanup(server.Close)
	return server, &traces
}

// TestBoxRequestCarriesTraceHeaderFromSwitchID 钉住三跳同源：
// 请求带 switchId 时，box 收到的 X-Eucli-Trace 必须与它逐字相同。
func TestBoxRequestCarriesTraceHeaderFromSwitchID(t *testing.T) {
	box, traces := captureTraceHeader(t)
	svc := newBusinessReadyTestService(configuredTestStore(t, box.URL), nil)

	params, _ := json.Marshal(map[string]any{
		"scope":    map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":   "chat-1",
		"switchId": "sw-frontend-1",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err != nil {
		t.Fatalf("session.get error = %v", err)
	}
	if len(*traces) != 1 {
		t.Fatalf("期望一次 box 请求，实际 %d", len(*traces))
	}
	if (*traces)[0] != "sw-frontend-1" {
		t.Fatalf("X-Eucli-Trace = %q, want sw-frontend-1", (*traces)[0])
	}
}

// TestBoxRequestGeneratesTraceWhenAbsent 钉住「每次 box 请求都可关联」：
// 没有 switchId 时也必须带一个本跳生成的 trace，且非空。
func TestBoxRequestGeneratesTraceWhenAbsent(t *testing.T) {
	box, traces := captureTraceHeader(t)
	svc := newBusinessReadyTestService(configuredTestStore(t, box.URL), nil)

	if _, err := svc.dispatch(context.Background(), "aiChat.netRequest", mustJSON(map[string]any{
		"method": "GET",
		"path":   "/api/runs",
	})); err != nil {
		t.Fatalf("netRequest error = %v", err)
	}
	if len(*traces) != 1 {
		t.Fatalf("期望一次 box 请求，实际 %d", len(*traces))
	}
	if (*traces)[0] == "" {
		t.Fatal("缺少 X-Eucli-Trace：box 侧无法关联")
	}
}

// TestBoxTraceIsObservable 钉住响应/日志侧可观测：
// 一次带 switchId 的请求必须在 studio.box.request / studio.box.response 各产生一条 mark。
func TestBoxTraceIsObservable(t *testing.T) {
	box, _ := captureTraceHeader(t)
	svc := newBusinessReadyTestService(configuredTestStore(t, box.URL), nil)

	var mu sync.Mutex
	marks := []switchMark{}
	setSwitchTraceSink(func(mark switchMark) {
		mu.Lock()
		marks = append(marks, mark)
		mu.Unlock()
	})
	defer setSwitchTraceSink(nil)

	params, _ := json.Marshal(map[string]any{
		"scope":    map[string]any{"kind": "role", "targetId": "role-1"},
		"chatId":   "chat-1",
		"switchId": "sw-observable",
	})
	if _, err := svc.dispatch(context.Background(), "aiChat.session.get", params); err != nil {
		t.Fatalf("session.get error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	boundaries := map[string]bool{}
	for _, mark := range marks {
		if mark.SwitchID != "sw-observable" {
			t.Fatalf("trace mark 的 switchId 不一致：%#v", mark)
		}
		boundaries[mark.Boundary] = true
	}
	for _, expected := range []string{"studio.dispatch", "studio.box.request", "studio.box.response", "studio.dispatch.done"} {
		if !boundaries[expected] {
			t.Fatalf("缺少边界 %q：%#v", expected, boundaries)
		}
	}
}

// TestPeekProducesTraceAndEnvelopeTogether 钉住「不双重解析」：
// 一次 peek 同时产出观测键、超时信封与分道键，dispatch 直接复用。
func TestPeekProducesTraceAndEnvelopeTogether(t *testing.T) {
	params, _ := json.Marshal(map[string]any{
		"switchId": "sw-1",
		"scope":    map[string]any{"kind": "role", "targetId": "role-1"},
		"method":   "POST",
		"path":     "/api/runs",
	})
	peek := peekRequestParams("aiChat.netRequest", params)
	if peek.SwitchID != "sw-1" {
		t.Fatalf("switchId = %q", peek.SwitchID)
	}
	if peek.Scope != "role:role-1" {
		t.Fatalf("scope = %q", peek.Scope)
	}
	if peek.Envelope.Method != "POST" || peek.Envelope.Path != "/api/runs" {
		t.Fatalf("envelope = %#v", peek.Envelope)
	}
}

func TestPeekIgnoresNonEnvelopeMethods(t *testing.T) {
	params, _ := json.Marshal(map[string]any{"method": "POST", "path": "/api/runs", "chatId": "chat-1"})
	peek := peekRequestParams("aiChat.session.get", params)
	if peek.Envelope.Method != "" || peek.Envelope.Path != "" {
		t.Fatalf("非透传请求不应产出信封：%#v", peek.Envelope)
	}
}
