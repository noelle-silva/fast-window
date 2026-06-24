package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

const (
	controlActionInvokeCapability       = "invokeCapability"
	controlActionQueryCapabilityOptions = "queryCapabilityOptions"
)

type backendControlServer struct {
	svc   *service
	token string
}

type controlRequestBody struct {
	Action       string          `json:"action"`
	CapabilityID string          `json:"capabilityId"`
	Input        *string         `json:"input"`
	OptionSource string          `json:"optionSource"`
	Config       json.RawMessage `json:"config"`
}

func (server *backendControlServer) handleControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "控制入口只接受 POST")
		return
	}
	if !server.authorizeControlRequest(w, r) {
		return
	}

	var body controlRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "控制请求不是有效 JSON")
		return
	}

	var result any
	var err error
	switch strings.TrimSpace(body.Action) {
	case controlActionInvokeCapability:
		input, inputErr := requiredControlText(body.Input, "input")
		if inputErr != nil {
			writeJSONError(w, http.StatusBadRequest, inputErr.Error())
			return
		}
		result, err = invokeCapability(r.Context(), server.svc, capabilityInvokeRequest{
			CapabilityID: body.CapabilityID,
			Input:        input,
			Config:       body.Config,
		})
	case controlActionQueryCapabilityOptions:
		result, err = queryCapabilityOptions(server.svc, capabilityQueryOptionsRequest{
			CapabilityID: body.CapabilityID,
			OptionSource: body.OptionSource,
			Config:       body.Config,
		})
	default:
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("不支持的控制动作: %s", body.Action))
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (server *backendControlServer) authorizeControlRequest(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("X-FW-Control-Token") != server.token {
		writeJSONError(w, http.StatusForbidden, "控制令牌无效")
		return false
	}
	return true
}

func writeJSONResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSONResponse(w, status, map[string]any{"error": message})
}

func requiredControlText(value *string, field string) (string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return "", fmt.Errorf("%s 不能为空", field)
	}
	return strings.TrimSpace(*value), nil
}
