package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

const (
	methodProtocolHello = "protocol.hello"

	errorBadRequest                 = "BAD_REQUEST"
	errorUnauthorized               = "UNAUTHORIZED"
	errorProtocolVersionUnsupported = "PROTOCOL_VERSION_UNSUPPORTED"
	errorMethodNotFound             = "METHOD_NOT_FOUND"
	errorTaskNotFound               = "TASK_NOT_FOUND"
	errorUpstreamFailed             = "UPSTREAM_FAILED"
	errorImageInvalid               = "IMAGE_INVALID"
	errorStorageFailed              = "STORAGE_FAILED"
	errorInternal                   = "INTERNAL"

	eventGenerationCreated   = "generation.created"
	eventGenerationProgress  = "generation.progress"
	eventGenerationCompleted = "generation.completed"
	eventGenerationFailed    = "generation.failed"
	eventGenerationCanceled  = "generation.canceled"
)

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
	Error  map[string]any `json:"error,omitempty"`
}

type eventFrame struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Payload any    `json:"payload,omitempty"`
}

type eventSink interface {
	Broadcast(eventFrame)
}

type noopEventSink struct{}

func (noopEventSink) Broadcast(eventFrame) {}

func newEvent(name string, payload any) eventFrame {
	return eventFrame{Type: "event", Name: name, Payload: payload}
}

type directError struct {
	Code    string
	Message string
	Details any
}

func (err directError) Error() string {
	return err.Message
}

func newDirectError(code string, message string) directError {
	return directError{Code: code, Message: message}
}

func errorResponse(id string, err error) responseFrame {
	payload := map[string]any{"code": errorInternal, "message": "请求失败"}
	var direct directError
	if errors.As(err, &direct) {
		payload["code"] = direct.Code
		payload["message"] = direct.Message
		if direct.Details != nil {
			payload["details"] = direct.Details
		}
	} else if err != nil {
		payload["message"] = err.Error()
	}
	return responseFrame{ID: id, Type: "response", OK: false, Error: payload}
}

func decodeMap(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("请求参数不是合法对象: %w", err)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return payload, nil
}
