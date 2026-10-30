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
			return responseFrame{ID: id, Type: "response", OK: false, Error: errorPayloadFor(code, message, detailed.Details())}
		}
	}
	return responseFrame{ID: id, Type: "response", OK: false, Error: &responseError{Code: code, Message: message}}
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

type appError struct {
	code    string
	message string
	details any
}

func (e appError) Error() string { return e.message }
func (e appError) Code() string  { return e.code }
func (e appError) Details() any  { return e.details }

func newError(code string, message string) error {
	return appError{code: code, message: message}
}

func newErrorWithDetails(code string, message string, details any) error {
	return appError{code: code, message: message, details: details}
}
