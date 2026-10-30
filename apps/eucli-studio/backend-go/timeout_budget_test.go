package main

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 三层超时预算：内层必须短于外层，且 T_work 不参与这套预算。

func TestTimeoutBudgetIsOrderedInnerToOuter(t *testing.T) {
	if !(boxInteractionTimeout < studioInteractionTimeout && studioInteractionTimeout < frontendInteractionTimeout) {
		t.Fatalf("交互类预算倒挂：box=%v studio=%v frontend=%v", boxInteractionTimeout, studioInteractionTimeout, frontendInteractionTimeout)
	}
	if !(boxBackgroundTimeout < studioBackgroundTimeout && studioBackgroundTimeout < frontendBackgroundTimeout) {
		t.Fatalf("后台类预算倒挂：box=%v studio=%v frontend=%v", boxBackgroundTimeout, studioBackgroundTimeout, frontendBackgroundTimeout)
	}
	if boxInteractionTimeout > boxBackgroundTimeout {
		t.Fatal("交互预算必须短于后台预算")
	}
}

func TestHTTPClientTimeoutIsAbsoluteCeiling(t *testing.T) {
	store, err := newConfigStore(t.TempDir())
	if err != nil {
		t.Fatalf("newConfigStore() error = %v", err)
	}
	client := newEBClient(store, testClientRelease())
	if client.http.Timeout != httpClientAbsoluteTimeout {
		t.Fatalf("http.Client.Timeout = %v, want %v", client.http.Timeout, httpClientAbsoluteTimeout)
	}
	if client.http.Timeout >= 120*time.Second {
		t.Fatal("漏配路径不允许再跑回 120s")
	}
}

func TestEBTimeoutClassSeparatesReadsAndCommands(t *testing.T) {
	if got := ebTimeoutClass(ebRequest{Method: "GET", Path: "/api/runs"}); got != timeoutClassInteraction {
		t.Fatalf("GET class = %v, want interaction", got)
	}
	if got := ebTimeoutClass(ebRequest{Method: "", Path: "/api/runs"}); got != timeoutClassInteraction {
		t.Fatalf("缺省 method class = %v, want interaction", got)
	}
	if got := ebTimeoutClass(ebRequest{Method: "POST", Path: "/api/runs"}); got != timeoutClassBackground {
		t.Fatalf("POST class = %v, want background", got)
	}
	// 停止运行是用户点击的交互命令：必须快速返回。
	if got := ebTimeoutClass(ebRequest{Method: "POST", Path: "/api/runs/run-1/cancel"}); got != timeoutClassInteraction {
		t.Fatalf("cancel class = %v, want interaction", got)
	}
}

func TestMethodTimeoutClassTreatsWritesAsBackground(t *testing.T) {
	for _, method := range []string{"aiChat.storageGet", "aiChat.session.get", "aiChat.healthCheck", "aiChat.setActiveChat", "aiChat.storageGetMany", "aiChat.session.graph"} {
		if got := methodTimeoutClass(method, ebRequest{}); got != timeoutClassInteraction {
			t.Fatalf("%s class = %v, want interaction", method, got)
		}
	}
	for _, method := range []string{"aiChat.storageSet", "artifacts.import"} {
		if got := methodTimeoutClass(method, ebRequest{}); got != timeoutClassBackground {
			t.Fatalf("%s class = %v, want background", method, got)
		}
	}
}

// TestNetRequestTimeoutClassFollowsPayload 钉住透传一跳不产生预算倒挂：
// netRequest 的类别必须由它承载的 HTTP 方法决定。
func TestNetRequestTimeoutClassFollowsPayload(t *testing.T) {
	getEnvelope := peekRequestParams("aiChat.netRequest", paramsOf(t, map[string]any{"method": "GET", "path": "/api/runs"})).Envelope
	if got := methodTimeoutClass("aiChat.netRequest", getEnvelope); got != timeoutClassInteraction {
		t.Fatalf("netRequest GET class = %v, want interaction", got)
	}
	postEnvelope := peekRequestParams("aiChat.netRequest", paramsOf(t, map[string]any{"method": "POST", "path": "/api/runs"})).Envelope
	if got := methodTimeoutClass("aiChat.netRequest", postEnvelope); got != timeoutClassBackground {
		t.Fatalf("netRequest POST class = %v, want background", got)
	}
	cancelEnvelope := peekRequestParams("aiChat.netRequest", paramsOf(t, map[string]any{"method": "POST", "path": "/api/runs/run-1/cancel"})).Envelope
	if got := methodTimeoutClass("aiChat.netRequest", cancelEnvelope); got != timeoutClassInteraction {
		t.Fatalf("netRequest cancel class = %v, want interaction", got)
	}
}

// TestEBRequestAppliesInnerTimeout 钉住「box 一跳短于 studio 一跳」：
// 即使调用方不传 timeoutMs，请求也必须带上内层预算。
func TestEBRequestAppliesInnerTimeout(t *testing.T) {
	var deadline time.Time
	store := configuredTestStore(t, "http://127.0.0.1:1")
	client := newEBClient(store, testClientRelease())
	client.http = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		deadline, _ = req.Context().Deadline()
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     http.Header{},
			Body:       io.NopCloser(strings.NewReader(`{"data":{"ok":true}}`)),
			Request:    req,
		}, nil
	})}

	started := time.Now()
	if _, err := client.request(context.Background(), ebRequest{Method: http.MethodGet, Path: "/api/runs"}); err != nil {
		t.Fatalf("request error = %v", err)
	}
	if deadline.IsZero() {
		t.Fatal("请求必须携带内层 deadline")
	}
	budget := deadline.Sub(started)
	if budget > studioInteractionTimeout {
		t.Fatalf("内层预算 %v 超过 studio 一跳 %v", budget, studioInteractionTimeout)
	}
	if budget > boxInteractionTimeout+time.Second {
		t.Fatalf("内层预算 %v 超过 box 交互预算 %v", budget, boxInteractionTimeout)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestFrontendTimeoutBudgetMatchesConstants(t *testing.T) {
	budget := frontendTimeoutBudget()
	if budget["interactionMs"] != int(frontendInteractionTimeout/time.Millisecond) {
		t.Fatalf("interactionMs = %v", budget["interactionMs"])
	}
	if budget["backgroundMs"] != int(frontendBackgroundTimeout/time.Millisecond) {
		t.Fatalf("backgroundMs = %v", budget["backgroundMs"])
	}
}

// TestUploadAppliesBoxBackgroundBudget 钉住 P5 契约 2 的 upload 一跳：
// 上传是后台动作，必须带 box 后台内层预算（30s），否则三层预算在这里断掉。
//
// 服务端看不到客户端 deadline，因此在客户端侧用 Transport 捕获请求上下文。
func TestUploadAppliesBoxBackgroundBudget(t *testing.T) {
	var deadline time.Time
	store := configuredTestStore(t, "http://127.0.0.1:1")
	client := newEBClient(store, testClientRelease())
	client.http = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		deadline, _ = req.Context().Deadline()
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     http.Header{},
			Body:       io.NopCloser(strings.NewReader(`{"data":{"ok":true}}`)),
			Request:    req,
		}, nil
	})}

	archivePath := filepath.Join(t.TempDir(), "demo.zip")
	if err := os.WriteFile(archivePath, []byte("PK\x03\x04"), 0o644); err != nil {
		t.Fatalf("write archive: %v", err)
	}
	started := time.Now()
	if _, err := client.upload(context.Background(), "/api/tools/import", archivePath); err != nil {
		t.Fatalf("upload() error = %v", err)
	}
	if deadline.IsZero() {
		t.Fatal("上传必须携带内层 deadline")
	}
	budget := deadline.Sub(started)
	if budget > boxBackgroundTimeout+time.Second {
		t.Fatalf("上传预算 %v 超过 box 后台预算 %v", budget, boxBackgroundTimeout)
	}
}
