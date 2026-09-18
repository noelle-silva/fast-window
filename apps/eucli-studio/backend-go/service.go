package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"eucli-studio-backend/internal/ebcontract"
)

type service struct {
	config            *configStore
	release           clientRelease
	eb                *ebClient
	projection        *projectionService
	runtime           *runtimeStore
	hub               *eventHub
	connectionMu      sync.RWMutex
	connectionState   *runtimeBootstrap
	connectionChanged chan struct{}
	shutdownMu        sync.RWMutex
	shutdown          func()
}

func newService(config *configStore, release clientRelease, hub *eventHub) (*service, error) {
	if config == nil {
		return nil, errors.New("eucli-studio config store is required")
	}
	eb := newEBClient(config, release)
	service := &service{
		config: config, release: release, eb: eb, projection: newProjectionService(config, eb), runtime: newRuntimeStore(), hub: hub,
		connectionChanged: make(chan struct{}, 1),
	}
	eb.setConnectionProvider(service.currentBoxConnection)
	return service, nil
}

func (s *service) dispatch(ctx context.Context, method string, params json.RawMessage) (any, error) {
	switch method {
	case "aiChat.healthCheck":
		cfg, _ := s.config.load()
		return map[string]any{"protocolVersion": directProtocolVersion, "clientVersion": s.release.Version, "status": "ok", "configured": cfg.EucliBoxURL != ""}, nil
	case "studio.bootstrap":
		return s.bootstrap(ctx)
	case "releaseCandidates.list":
		var listReq struct {
			Kind string `json:"kind"`
		}
		_ = json.Unmarshal(paramsOrEmpty(params), &listReq)
		return s.listReleaseCandidates(ctx, listReq.Kind)
	case "artifacts.installations":
		return s.listArtifactInstallations(ctx)
	case "eucli.config.get":
		return s.config.load()
	case "eucli.config.set":
		var cfg clientConfig
		if err := json.Unmarshal(paramsOrEmpty(params), &cfg); err != nil {
			return nil, err
		}
		saved, err := s.config.save(cfg)
		if err == nil {
			s.clearConnectionState()
		}
		return saved, err
	}
	if !isBusinessMethod(method) {
		return nil, newError("METHOD_NOT_FOUND", "未知请求："+method)
	}
	if err := s.requireBusinessConnection(); err != nil {
		return nil, err
	}
	switch method {
	case "eucli.eb.request":
		var req ebRequest
		if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
			return nil, err
		}
		return s.eb.request(ctx, req)
	case "aiChat.netRequest":
		return s.handleNetRequest(ctx, params)
	case "aiChat.submitChatCompletion", "aiChat.submitManyChatCompletions", "aiChat.submitRawServiceRequest":
		return nil, newError("EB_MODEL_REQUIRED", fmt.Sprintf("%s 必须通过 e-b runs 接口推进，客户端不再本地运行", method))
	case "aiChat.cancelAssistant", "aiChat.getAssistantRuntime", "aiChat.readAssistantStream", "aiChat.consumeAssistantFinal", "aiChat.resetAssistantRuntime", "aiChat.waitServiceFinal":
		return nil, newError("EB_MODEL_REQUIRED", fmt.Sprintf("%s 必须通过 e-b runs/events 接口读取，客户端不再维护本地运行态", method))
	case "aiChat.storageGet":
		key, err := storageKey(params)
		if err != nil {
			return nil, err
		}
		if logicalKey, ok := runtimeLogicalKey(key); ok {
			value, exists := s.runtime.get(logicalKey)
			if !exists {
				return nil, nil
			}
			return value, nil
		}
		return s.projection.get(ctx, key)
	case "aiChat.storageSet":
		key, value, err := storageSetPayload(params)
		if err != nil {
			return nil, err
		}
		if logicalKey, ok := runtimeLogicalKey(key); ok {
			s.runtime.set(logicalKey, value)
			s.broadcastRuntimeStorageSet(logicalKey, value)
			return map[string]any{}, nil
		}
		return map[string]any{}, s.projection.set(ctx, key, value)
	case "aiChat.storageRemove":
		key, err := storageKey(params)
		if err != nil {
			return nil, err
		}
		if logicalKey, ok := runtimeLogicalKey(key); ok {
			s.runtime.remove(logicalKey)
			return map[string]any{}, nil
		}
		return map[string]any{}, s.projection.remove(ctx, key)
	case "aiChat.imageRead":
		return s.handleImageRead(ctx, params)
	case "aiChat.imageWrite":
		return s.handleImageWrite(ctx, params)
	case "aiChat.imageDelete":
		return s.handleImageDelete(ctx, params)
	case "aiChat.imagePick":
		return nil, newError("NOT_IMPLEMENTED", fmt.Sprintf("%s 必须由宿主 UI 处理", method))
	default:
		return nil, newError("METHOD_NOT_FOUND", "未知请求："+method)
	}
}

func (s *service) setShutdown(fn func()) {
	s.shutdownMu.Lock()
	s.shutdown = fn
	s.shutdownMu.Unlock()
}

func (s *service) requestShutdown() {
	s.shutdownMu.RLock()
	shutdown := s.shutdown
	s.shutdownMu.RUnlock()
	if shutdown != nil {
		go shutdown()
	}
}

// listReleaseCandidates 直通读取业务端当前安装来源下某分类的候选事实；客户端不保存任何结果。
func (s *service) listReleaseCandidates(ctx context.Context, kind string) (ebcontract.ArtifactCandidateList, error) {
	kind = strings.TrimSpace(kind)
	switch kind {
	case ebcontract.ReleaseArtifactKindTool, ebcontract.ReleaseArtifactKindPlugin:
	default:
		return ebcontract.ArtifactCandidateList{}, newError("BAD_REQUEST", fmt.Sprintf("不支持的候选分类 %q", kind))
	}
	if err := s.requireReachableBusiness(); err != nil {
		return ebcontract.ArtifactCandidateList{}, err
	}
	raw, err := s.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/release-candidates", Query: mustJSON(map[string]any{"kind": kind}), Timeout: 8000})
	if err != nil {
		return ebcontract.ArtifactCandidateList{}, err
	}
	return decodeArtifactCandidateList(raw)
}

// listArtifactInstallations 直通读取业务端当前真实的已装事实；客户端不保存任何结果。
func (s *service) listArtifactInstallations(ctx context.Context) (ebcontract.ArtifactInstallationList, error) {
	if err := s.requireReachableBusiness(); err != nil {
		return ebcontract.ArtifactInstallationList{}, err
	}
	raw, err := s.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/artifact-installations", Timeout: 8000})
	if err != nil {
		return ebcontract.ArtifactInstallationList{}, err
	}
	return decodeArtifactInstallationList(raw)
}

func (s *service) requireReachableBusiness() error {
	state := s.connectionSnapshot()
	if state == nil || !state.EucliBoxReachable {
		return newError("EUCLI_BOX_CONNECTION_REQUIRED", "需要先连接业务端")
	}
	return nil
}

func decodeArtifactCandidateList(raw any) (ebcontract.ArtifactCandidateList, error) {
	payload, err := json.Marshal(raw)
	if err != nil {
		return ebcontract.ArtifactCandidateList{}, fmt.Errorf("读取发行候选失败：%w", err)
	}
	var list ebcontract.ArtifactCandidateList
	if err := json.Unmarshal(payload, &list); err != nil {
		return ebcontract.ArtifactCandidateList{}, fmt.Errorf("读取发行候选失败：%w", err)
	}
	if list.SourceKind != string(ebcontract.KindOfficial) && list.SourceKind != string(ebcontract.KindLocal) {
		return ebcontract.ArtifactCandidateList{}, fmt.Errorf("发行候选返回了无效来源")
	}
	if list.Candidates == nil {
		list.Candidates = []ebcontract.ArtifactReleaseCandidate{}
	}
	return list, nil
}

func decodeArtifactInstallationList(raw any) (ebcontract.ArtifactInstallationList, error) {
	payload, err := json.Marshal(raw)
	if err != nil {
		return ebcontract.ArtifactInstallationList{}, fmt.Errorf("读取已装事实失败：%w", err)
	}
	var list ebcontract.ArtifactInstallationList
	if err := json.Unmarshal(payload, &list); err != nil {
		return ebcontract.ArtifactInstallationList{}, fmt.Errorf("读取已装事实失败：%w", err)
	}
	if list.Artifacts == nil {
		list.Artifacts = []ebcontract.ArtifactInstallation{}
	}
	return list, nil
}

func isBusinessMethod(method string) bool {
	switch method {
	case "eucli.eb.request",
		"aiChat.netRequest",
		"aiChat.submitChatCompletion",
		"aiChat.submitManyChatCompletions",
		"aiChat.submitRawServiceRequest",
		"aiChat.cancelAssistant",
		"aiChat.getAssistantRuntime",
		"aiChat.readAssistantStream",
		"aiChat.consumeAssistantFinal",
		"aiChat.resetAssistantRuntime",
		"aiChat.waitServiceFinal",
		"aiChat.storageGet",
		"aiChat.storageSet",
		"aiChat.storageRemove",
		"aiChat.imageRead",
		"aiChat.imageWrite",
		"aiChat.imageDelete",
		"aiChat.imagePick":
		return true
	default:
		return false
	}
}

func (s *service) broadcastRuntimeStorageSet(logicalKey string, value any) {
	if logicalKey != chatUpdatedNoticeRuntimeKey || s.hub == nil {
		return
	}

	// Chat-updated notices are the event-driven refresh root for the UI. They are
	// written only after the durable chat write path succeeds, so broadcasting
	// them here makes the real data change speak for itself. Do not route this
	// through projection/e-b storage: the notice is a runtime coordination fact,
	// not business data, and using it as the primary signal keeps the UI from
	// falling back to high-frequency polling for normal updates.
	s.hub.broadcast(eventFrame{Type: "event", Name: directEventChatUpdated, Payload: value})
}

func (s *service) handleImageRead(ctx context.Context, params json.RawMessage) (any, error) {
	req, err := imagePayload(params)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(filepath.ToSlash(req.Path), "stickers/") {
		return s.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/stickers/image", Query: mustJSON(map[string]any{"path": filepath.ToSlash(req.Path)})})
	}
	if strings.HasPrefix(filepath.ToSlash(req.Path), "sessions/") {
		return s.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/session-attachments/image", Query: mustJSON(map[string]any{"path": filepath.ToSlash(req.Path)})})
	}
	if groupAvatarPathPattern.MatchString(strings.TrimSpace(filepath.ToSlash(req.Path))) {
		groupID, err := s.projection.groupIDByAvatarPath(ctx, req.Path)
		if err != nil {
			return nil, err
		}
		return s.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/groups/%s/avatar", groupID)})
	}
	roleID, err := s.projection.roleIDByAvatarPath(ctx, req.Path)
	if err != nil {
		return nil, err
	}
	return s.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/roles/%s/avatar", roleID)})
}

func (s *service) handleImageWrite(ctx context.Context, params json.RawMessage) (any, error) {
	req, err := imagePayload(params)
	if err != nil {
		return nil, err
	}
	roleID, err := s.projection.roleIDByAvatarPath(ctx, req.Path)
	if err != nil {
		groupID, groupErr := s.projection.groupIDByAvatarPath(ctx, req.Path)
		if groupErr != nil {
			return nil, err
		}
		if req.DataURL == "" {
			return nil, newError("BAD_REQUEST", "image data url is required")
		}
		_, err = s.eb.request(ctx, ebRequest{Method: "PUT", Path: fmt.Sprintf("/api/groups/%s/avatar", groupID), Body: mustJSON(map[string]any{"dataUrl": req.DataURL})})
		if err != nil {
			return nil, err
		}
		return map[string]any{"relPath": req.Path}, nil
	}
	if req.DataURL == "" {
		return nil, newError("BAD_REQUEST", "image data url is required")
	}
	_, err = s.eb.request(ctx, ebRequest{Method: "PUT", Path: fmt.Sprintf("/api/roles/%s/avatar", roleID), Body: mustJSON(map[string]any{"dataUrl": req.DataURL})})
	if err != nil {
		return nil, err
	}
	return map[string]any{"relPath": req.Path}, nil
}

func (s *service) handleImageDelete(ctx context.Context, params json.RawMessage) (any, error) {
	req, err := imagePayload(params)
	if err != nil {
		return nil, err
	}
	roleID, err := s.projection.roleIDByAvatarPath(ctx, req.Path)
	if err != nil {
		groupID, groupErr := s.projection.groupIDByAvatarPath(ctx, req.Path)
		if groupErr != nil {
			return nil, err
		}
		_, err = s.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/groups/%s/avatar", groupID)})
		if err != nil {
			return nil, err
		}
		return map[string]any{}, nil
	}
	_, err = s.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/roles/%s/avatar", roleID)})
	if err != nil {
		return nil, err
	}
	return map[string]any{}, nil
}

type imageRequest struct {
	Path    string
	DataURL string
}

func imagePayload(params json.RawMessage) (imageRequest, error) {
	var raw map[string]any
	if err := json.Unmarshal(paramsOrEmpty(params), &raw); err != nil {
		return imageRequest{}, err
	}
	path := strings.TrimSpace(fmt.Sprint(firstPresent(raw, "relPath", "path")))
	if path == "" {
		return imageRequest{}, newError("BAD_REQUEST", "image path is required")
	}
	return imageRequest{Path: path, DataURL: strings.TrimSpace(fmt.Sprint(firstPresent(raw, "dataUrlOrBase64", "dataUrl", "base64")))}, nil
}

func firstPresent(raw map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := raw[key]; ok && value != nil {
			return value
		}
	}
	return ""
}

func storageKey(params json.RawMessage) (string, error) {
	var req struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return "", err
	}
	if req.Key == "" {
		return "", newError("BAD_REQUEST", "storage key is required")
	}
	return req.Key, nil
}

func storageSetPayload(params json.RawMessage) (string, any, error) {
	var req struct {
		Key   string `json:"key"`
		Value any    `json:"value"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return "", nil, err
	}
	if req.Key == "" {
		return "", nil, newError("BAD_REQUEST", "storage key is required")
	}
	return req.Key, req.Value, nil
}

func (s *service) handleNetRequest(ctx context.Context, params json.RawMessage) (any, error) {
	var raw map[string]any
	if err := json.Unmarshal(paramsOrEmpty(params), &raw); err != nil {
		return nil, err
	}
	path, _ := raw["path"].(string)
	if path == "" {
		urlValue, _ := raw["url"].(string)
		path = urlValue
	}
	if path == "" {
		return nil, errors.New("aiChat.netRequest requires path")
	}
	body, _ := json.Marshal(raw["body"])
	query, _ := json.Marshal(raw["query"])
	req := ebRequest{Method: fmt.Sprint(raw["method"]), Path: path, Query: query, Body: body}
	if timeout, ok := raw["timeoutMs"].(float64); ok {
		req.Timeout = int(timeout)
	}
	data, err := s.eb.request(ctx, req)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": 200, "body": data}, nil
}

func paramsOrEmpty(params json.RawMessage) json.RawMessage {
	if len(params) == 0 || string(params) == "null" {
		return json.RawMessage(`{}`)
	}
	return params
}
