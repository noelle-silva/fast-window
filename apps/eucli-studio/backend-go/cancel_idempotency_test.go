package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// POST /api/runs/{id}/cancel 幂等化（design-5 契约 3）：
// 已终态重复调用必须是成功（204 语义），而不是把 runtimeStateInvalid 抛回前端。

func cancelNetRequestParams(t *testing.T, runID string) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"method": "POST",
		"path":   "/api/runs/" + runID + "/cancel",
	})
	if err != nil {
		t.Fatalf("marshal params error = %v", err)
	}
	return payload
}

func TestCancelRunTreatsInvalidRuntimeStateAsNoContent(t *testing.T) {
	box := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"error":{"code":"runtimeStateInvalid","message":"运行已结束"}}`)
	}))
	defer box.Close()

	svc := newBusinessReadyTestService(configuredTestStore(t, box.URL), newEventHub())
	result, err := svc.dispatch(context.Background(), "aiChat.netRequest", cancelNetRequestParams(t, "run-1"))
	if err != nil {
		t.Fatalf("已终态重复取消必须是成功，实际 error = %v", err)
	}
	payload := objectMap(result)
	if status := intField(payload, "status", 0); status != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", status, http.StatusNoContent)
	}
}

func TestCancelRunStillReportsOtherFailures(t *testing.T) {
	box := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"error":{"code":"internal","message":"炸了"}}`)
	}))
	defer box.Close()

	svc := newBusinessReadyTestService(configuredTestStore(t, box.URL), newEventHub())
	if _, err := svc.dispatch(context.Background(), "aiChat.netRequest", cancelNetRequestParams(t, "run-1")); err == nil {
		t.Fatal("非 runtimeStateInvalid 的失败必须继续上报")
	}
}

func TestCancelIdempotencyDoesNotLeakToOtherRunCommands(t *testing.T) {
	box := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = io.WriteString(w, `{"error":{"code":"runtimeStateInvalid","message":"运行已结束"}}`)
	}))
	defer box.Close()

	svc := newBusinessReadyTestService(configuredTestStore(t, box.URL), newEventHub())
	params, _ := json.Marshal(map[string]any{"method": "POST", "path": "/api/runs/run-1/retry"})
	if _, err := svc.dispatch(context.Background(), "aiChat.netRequest", params); err == nil {
		t.Fatal("幂等收敛只针对 cancel 路径")
	}
}

func TestIsRunCancelPath(t *testing.T) {
	cases := map[string]bool{
		"/api/runs/run-1/cancel":          true,
		"/api/runs/run-1/cancel/":         true,
		"/api/runs/run-1":                 false,
		"/api/runs/run-1/retry":           false,
		"/api/groups/g/sessions/s/cancel": false,
	}
	for path, want := range cases {
		if got := isRunCancelPath(path); got != want {
			t.Fatalf("isRunCancelPath(%q) = %v, want %v", path, got, want)
		}
	}
}
