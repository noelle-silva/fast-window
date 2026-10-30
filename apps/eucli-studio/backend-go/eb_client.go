package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// traceHeaderName 是前端 → studio → box 三跳共用的关联头（design-5 §十二 P0）。
const traceHeaderName = "X-Eucli-Trace"

type ebClient struct {
	config             *configStore
	release            clientRelease
	http               *http.Client
	connectionProvider func() (*boxConnection, error)
}

func newEBClient(config *configStore, release clientRelease) *ebClient {
	// http.Client.Timeout 只是绝对上限：真正的预算由每跳的 context 决定，
	// 绝不允许任何漏配路径重新跑回 120s。
	return &ebClient{config: config, release: release, http: &http.Client{Timeout: httpClientAbsoluteTimeout}}
}

func (c *ebClient) setConnectionProvider(provider func() (*boxConnection, error)) {
	c.connectionProvider = provider
}

type ebRequest struct {
	Method  string          `json:"method"`
	Path    string          `json:"path"`
	Query   json.RawMessage `json:"query,omitempty"`
	Body    json.RawMessage `json:"body,omitempty"`
	Timeout int             `json:"timeoutMs,omitempty"`
}

// request 是结构化路径的唯一入口：它把 data 字节解码成通用对象。
// 会话载荷不走这里——那条路径用 requestRaw 做纯字节中继。
func (c *ebClient) request(ctx context.Context, req ebRequest) (any, error) {
	raw, err := c.requestRaw(ctx, req)
	if err != nil {
		return nil, err
	}
	return decodeJSONValue[any](raw)
}

// requestRaw 只解信封、只回传 data 的字节区间：
// studio 侧对业务载荷的遍历次数 = 0（编码/解码都交给真正消费它的那一端）。
func (c *ebClient) requestRaw(ctx context.Context, req ebRequest) (json.RawMessage, error) {
	connection, err := c.connection()
	if err != nil {
		return nil, err
	}
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = http.MethodGet
	}
	path := strings.TrimSpace(req.Path)
	if path == "" || !strings.HasPrefix(path, "/") {
		return nil, newError("BAD_REQUEST", "e-b request path must start with /")
	}
	if strings.HasPrefix(path, "/ws/") {
		return nil, newError("BAD_REQUEST", "websocket paths are not valid HTTP request targets")
	}

	target, err := url.Parse(strings.TrimRight(connection.BaseURL, "/") + path)
	if err != nil {
		return nil, err
	}
	if len(req.Query) > 0 && string(req.Query) != "null" {
		queryValues := target.Query()
		var query map[string]any
		if err := json.Unmarshal(req.Query, &query); err != nil {
			return nil, newError("BAD_REQUEST", "query must be an object")
		}
		for key, raw := range query {
			if key == "" || raw == nil {
				continue
			}
			queryValues.Set(key, fmt.Sprint(raw))
		}
		target.RawQuery = queryValues.Encode()
	}

	var body io.Reader
	if len(req.Body) > 0 && string(req.Body) != "null" {
		body = bytes.NewReader(req.Body)
	}
	// 三层预算的内层：box 一跳必须短于 studio 一跳。
	timeout := boxTimeoutForClass(ebTimeoutClass(req))
	if req.Timeout > 0 {
		explicit := time.Duration(req.Timeout) * time.Millisecond
		if explicit < timeout {
			timeout = explicit
		}
	}
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	httpReq, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	if connection.Credential != "" {
		httpReq.Header.Set("Authorization", "Bearer "+connection.Credential)
	}
	c.release.applyHeaders(httpReq.Header)
	// 三跳贯穿：请求带 switchId 时，X-Eucli-Trace 与它逐字相同（前端 → studio → box）；
	// 没有 switchId 时仍注入一个本跳 trace 供 box 侧关联，但不产生任何观测日志
	// （观测开销只在真的开启 trace 时产生，避免每请求两条日志撑破 1% 预算）。
	traceID := traceIDFromContext(ctx)
	traced := traceID != ""
	if !traced {
		traceID = nextTraceID()
	}
	httpReq.Header.Set(traceHeaderName, traceID)
	if traced {
		traceSwitch(switchMark{SwitchID: traceID, Boundary: "studio.box.request", Method: method, Scope: path})
	}

	raw, err := c.doRaw(httpReq)
	if traced {
		status := "ok"
		if err != nil {
			status = "error"
		}
		traceSwitch(switchMark{SwitchID: traceID, Boundary: "studio.box.response", Method: method, Scope: path, Elapsed: switchElapsedSince(started), Status: status})
	}
	return raw, err
}

// upload 把本机文件作为原始字节直传业务端；用于安装包导入。
func (c *ebClient) upload(ctx context.Context, path string, filePath string) (any, error) {
	connection, err := c.connection()
	if err != nil {
		return nil, err
	}
	path = strings.TrimSpace(path)
	if path == "" || !strings.HasPrefix(path, "/") {
		return nil, newError("BAD_REQUEST", "e-b request path must start with /")
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, newError("BAD_REQUEST", "无法读取安装包文件："+err.Error())
	}
	defer file.Close()
	target, err := url.Parse(strings.TrimRight(connection.BaseURL, "/") + path)
	if err != nil {
		return nil, err
	}
	// 上传是后台动作：必须套上 box 后台内层预算（30s），
	// 否则 studio 会带着「没有 deadline」的请求等业务端，三层预算在这里断掉。
	uploadCtx, cancel := context.WithTimeout(ctx, boxTimeoutForClass(timeoutClassBackground))
	defer cancel()
	httpReq, err := http.NewRequestWithContext(uploadCtx, http.MethodPost, target.String(), file)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/zip")
	if connection.Credential != "" {
		httpReq.Header.Set("Authorization", "Bearer "+connection.Credential)
	}
	c.release.applyHeaders(httpReq.Header)
	// 上传同样贯穿 trace：三跳关联不能因为载荷形态不同而断掉。
	traceID := traceIDFromContext(ctx)
	traced := traceID != ""
	if !traced {
		traceID = nextTraceID()
	}
	httpReq.Header.Set(traceHeaderName, traceID)
	if traced {
		traceSwitch(switchMark{SwitchID: traceID, Boundary: "studio.box.request", Method: http.MethodPost, Scope: path})
	}

	started := time.Now()
	data, err := c.do(httpReq)
	if traced {
		status := "ok"
		if err != nil {
			status = "error"
		}
		traceSwitch(switchMark{SwitchID: traceID, Boundary: "studio.box.response", Method: http.MethodPost, Scope: path, Elapsed: switchElapsedSince(started), Status: status})
	}
	return data, err
}

func (c *ebClient) do(httpReq *http.Request) (any, error) {
	raw, err := c.doRaw(httpReq)
	if err != nil {
		return nil, err
	}
	return decodeJSONValue[any](raw)
}

// doRaw 是唯一的响应出口：成功时只返回 data 的字节区间，失败时只构造一次错误体。
func (c *ebClient) doRaw(httpReq *http.Request) (json.RawMessage, error) {
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ebResponseError(resp, payload)
	}
	return extractEnvelopeData(payload)
}

func (c *ebClient) connection() (*boxConnection, error) {
	if c.connectionProvider != nil {
		return c.connectionProvider()
	}
	cfg, err := c.config.requireConfigured()
	if err != nil {
		return nil, err
	}
	return &boxConnection{Source: boxConnectionSourceManual, BaseURL: cfg.EucliBoxURL, Credential: cfg.EucliBoxKey}, nil
}

// ebErrorBodyLimit 是错误体的固定上限：一次 4MB 的错误响应不允许变成 10MB 的帧。
const ebErrorBodyLimit = 4096

// ebResponseError 只解析一次错误响应：可解码为 JSON 时只带 json，
// 否则只带截断后的原始文本。两条互斥分支，永不重复携带同一份内容。
func ebResponseError(resp *http.Response, payload []byte) error {
	details := map[string]any{
		"statusCode": resp.StatusCode,
		"status":     resp.Status,
		"headers":    resp.Header,
	}
	message := ""
	if decoded, err := decodeJSONValue[any](payload); err == nil && len(bytes.TrimSpace(payload)) > 0 {
		details["json"] = decoded
		message = errorMessageFromPayload(decoded)
	} else {
		details["body"] = truncateText(payload, ebErrorBodyLimit)
		message = strings.TrimSpace(string(details["body"].(string)))
	}
	if message == "" {
		message = resp.Status
	}
	return newErrorWithDetails("EB_REQUEST_FAILED", message, details)
}

// errorMessageFromPayload 从业务端错误信封里取人类可读消息。
func errorMessageFromPayload(decoded any) string {
	envelope, ok := decoded.(map[string]any)
	if !ok {
		return ""
	}
	errBox, ok := envelope["error"].(map[string]any)
	if !ok {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(errBox["message"]))
}
