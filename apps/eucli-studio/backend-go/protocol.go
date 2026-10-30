package main

import (
	"bytes"
	"encoding/json"
	"strings"
)

const directProtocolVersion = 2

const directEventChatUpdated = "aiChat.chat.updated"
const directEventEucliBoxRun = "eucliBox.run.event"

type requestFrame struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type responseFrame struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	OK     bool           `json:"ok"`
	Result any            `json:"result,omitempty"`
	Error  *responseError `json:"error,omitempty"`
}

type responseError struct {
	Code    string           `json:"code,omitempty"`
	Message string           `json:"message"`
	System  string           `json:"system,omitempty"`
	Details any              `json:"details,omitempty"`
	Cause   *responseError   `json:"cause,omitempty"`
	Causes  []*responseError `json:"causes,omitempty"`
	// Retryable / RetryAfterMs 是协议级的「这次失败可以安全重试」声明。
	//
	// 为什么放在协议层而不是让客户端认业务错误码：
	// 传输层只需要知道「能不能重发、隔多久重发」，不需要知道 SERVER_BUSY 是什么语义。
	// 由服务端在构造错误时就声明可重试性，客户端按字段执行，分层不泄漏。
	//
	// 只有「保证未被执行」的拒绝才能置为 true（例如入道前的并发拒绝）。
	Retryable    bool `json:"retryable,omitempty"`
	RetryAfterMs int  `json:"retryAfterMs,omitempty"`
}

// rawResult 标记「这个结果已经是业务端的原始字节」：
// 写帧时直接拼进 result 字段，绝不再经过一次对象图编码。
type rawResult struct {
	payload json.RawMessage
}

func newRawResult(payload json.RawMessage) rawResult {
	if len(bytes.TrimSpace(payload)) == 0 {
		return rawResult{payload: json.RawMessage("{}")}
	}
	return rawResult{payload: payload}
}

type readyFrame struct {
	Type string   `json:"type"`
	IPC  readyIPC `json:"ipc"`
}

type readyIPC struct {
	Mode            string `json:"mode"`
	Transport       string `json:"transport"`
	URL             string `json:"url"`
	ProtocolVersion int    `json:"protocolVersion"`
}

func okResponse(id string, result any) responseFrame {
	return responseFrame{ID: id, Type: "response", OK: true, Result: result}
}

func errorResponseFor(id string, err error) responseFrame {
	code := "BACKEND_ERROR"
	message := "请求失败"
	if err != nil {
		message = err.Error()
		if coded, ok := err.(codedError); ok {
			code = coded.Code()
		}
		if detailed, ok := err.(detailedError); ok {
			payload := errorPayloadFor(code, message, detailed.Details())
			applyRetryHint(payload, err)
			return responseFrame{ID: id, Type: "response", OK: false, Error: payload}
		}
	}
	payload := &responseError{Code: code, Message: message}
	applyRetryHint(payload, err)
	return responseFrame{ID: id, Type: "response", OK: false, Error: payload}
}

// applyRetryHint 把「这次失败可以安全重试」的声明从 error 搬到错误帧上。
// 只有实现了 retryableError 的错误才会带这两个字段；其余错误保持默认 false。
func applyRetryHint(payload *responseError, err error) {
	if payload == nil || err == nil {
		return
	}
	hinted, ok := err.(retryableError)
	if !ok {
		return
	}
	retryable, retryAfterMs := hinted.RetryHint()
	if !retryable {
		return
	}
	payload.Retryable = true
	payload.RetryAfterMs = retryAfterMs
}

func errorPayloadFor(code string, message string, details any) *responseError {
	if payload, ok := details.(map[string]any); ok {
		if raw, ok := payload["error"].(map[string]any); ok {
			return responseErrorFromMap(raw)
		}
		if raw, ok := payload["json"].(map[string]any); ok {
			if errBox, ok := raw["error"].(map[string]any); ok {
				return responseErrorFromMap(errBox)
			}
		}
	}
	return &responseError{Code: code, Message: message, Details: details}
}

func responseErrorFromMap(raw map[string]any) *responseError {
	message := stringValue(raw, "message")
	if message == "" {
		message = "请求失败"
	}
	out := &responseError{Code: stringValue(raw, "code"), Message: message, System: stringValue(raw, "system"), Details: raw["details"]}
	if cause, ok := raw["cause"].(map[string]any); ok {
		out.Cause = responseErrorFromMap(cause)
	}
	if causes, ok := raw["causes"].([]any); ok {
		out.Causes = responseErrorsFromList(causes)
	}
	return out
}

func responseErrorsFromList(raw []any) []*responseError {
	if len(raw) == 0 {
		return nil
	}
	result := make([]*responseError, 0, len(raw))
	for _, item := range raw {
		if cause, ok := item.(map[string]any); ok {
			result = append(result, responseErrorFromMap(cause))
		}
	}
	return result
}

func stringValue(raw map[string]any, key string) string {
	value, ok := raw[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

type codedError interface {
	error
	Code() string
}

type detailedError interface {
	error
	Details() any
}

// retryableError 是「这次失败可以安全重试」的协议级声明。
//
// 语义边界（必须严格遵守）：只有「保证未被执行」的失败才可以声明可重试。
// 典型例子是入道前的并发拒绝 —— 请求从未到达 service.dispatch。
// 任何已经进入执行、可能产生副作用的失败都不得实现该接口。
type retryableError interface {
	error
	RetryHint() (retryable bool, retryAfterMs int)
}

type appError struct {
	code    string
	message string
	details any
}

func (e appError) Error() string { return e.message }
func (e appError) Code() string  { return e.code }
func (e appError) Details() any  { return e.details }

// retryableAppError 在 appError 之上附加「可重试」声明。
type retryableAppError struct {
	appError
	retryAfterMs int
}

func (e retryableAppError) RetryHint() (bool, int) { return true, e.retryAfterMs }

func newError(code string, message string) error {
	return appError{code: code, message: message}
}

func newErrorWithDetails(code string, message string, details any) error {
	return appError{code: code, message: message, details: details}
}

// newRetryableError 只用于「保证未被执行」的失败（如入道前的并发拒绝）。
func newRetryableError(code string, message string, retryAfterMs int) error {
	return retryableAppError{
		appError:     appError{code: code, message: message},
		retryAfterMs: retryAfterMs,
	}
}
