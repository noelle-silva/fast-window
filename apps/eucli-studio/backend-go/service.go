package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"eucli-studio-backend/internal/ebcontract"
)

type service struct {
	config            *configStore
	release           clientRelease
	eb                *ebClient
	projection        *projectionService
	runtime           *runtimeStore
	hub               *eventHub
	capabilities      *boxCapabilityProbe
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
		capabilities:      newBoxCapabilityProbe(),
		connectionChanged: make(chan struct{}, 1),
	}
	eb.setConnectionProvider(service.currentBoxConnection)
	return service, nil
}

func (s *service) dispatch(ctx context.Context, method string, params json.RawMessage) (any, error) {
	// 一次解析同时供观测与超时分类使用：reader 已经解析过时直接复用，
	// 同一个 params 在一条请求链路上只被反序列化一次。
	peek, ok := requestPeekFromContext(ctx)
	if !ok {
		peek = peekRequestParams(method, params)
	}
	// 三跳贯穿：把本次请求的 trace 注入 context，所有出站 HTTP 自动继承。
	// 有 switchId 时三跳同源；没有时不生成、不打日志（观测开销只在真的开启时产生）。
	if peek.SwitchID != "" {
		ctx = withTraceID(ctx, peek.SwitchID)
	}
	// 切换观测：只有真的带 switchId 时才产生 dispatch 边界（零成本旁路）。
	if peek.SwitchID != "" {
		started := time.Now()
		traceSwitch(switchMark{SwitchID: peek.SwitchID, Boundary: "studio.dispatch", Method: method, Scope: peek.Scope})
		defer func() {
			traceSwitch(switchMark{SwitchID: peek.SwitchID, Boundary: "studio.dispatch.done", Method: method, Scope: peek.Scope, Elapsed: switchElapsedSince(started)})
		}()
	}
	// 客户端状态读写只依赖本地数据，先于业务连接检查处理。
	if handled, result, err := s.handleClientStateStorage(method, params); handled {
		return result, err
	}
	switch method {
	case "aiChat.healthCheck":
		cfg, _ := s.config.load()
		return map[string]any{
			"protocolVersion": directProtocolVersion,
			"clientVersion":   s.release.Version,
			"status":          "ok",
			"configured":      cfg.EucliBoxURL != "",
			// 能力协商：不升协议主版本（严格相等校验会让新旧前端互斥），
			// 用 feature 列表表达灰度。
			"features": s.healthCheckFeatures(),
			// 超时预算由 studio 统一签发：前端只消费这里的数字，不另写常量。
			"timeoutBudget": frontendTimeoutBudget(),
		}, nil
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
	case "artifacts.import":
		var importReq struct {
			Kind     string `json:"kind"`
			FilePath string `json:"filePath"`
		}
		if err := json.Unmarshal(paramsOrEmpty(params), &importReq); err != nil {
			return nil, err
		}
		return s.importArtifact(ctx, importReq.Kind, importReq.FilePath)
	case "eucli.config.get":
		return s.config.load()
	case "eucli.config.set":
		var input struct {
			EucliBoxURL          string `json:"eucliBoxUrl"`
			EucliBoxKey          string `json:"eucliBoxKey"`
			EucliBoxDisconnected bool   `json:"eucliBoxDisconnected"`
		}
		if err := json.Unmarshal(paramsOrEmpty(params), &input); err != nil {
			return nil, err
		}
		saved, err := s.config.saveConnection(input.EucliBoxURL, input.EucliBoxKey, input.EucliBoxDisconnected)
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
	case "aiChat.sessionIndex.get":
		return s.handleSessionIndexGet(ctx, params)
	case "aiChat.sessionSummary.list":
		return s.handleSessionSummaryList(ctx, params)
	case "aiChat.session.get":
		return s.handleSessionGet(ctx, params)
	case "aiChat.session.window":
		return s.handleSessionWindow(ctx, params)
	case "aiChat.session.view":
		return s.handleSessionView(ctx, params)
	case "aiChat.session.graph":
		return s.handleSessionGraph(ctx, params)
	case "aiChat.setActiveChat":
		return s.handleSetActiveChat(ctx, params)
	case "aiChat.storageGetMany":
		return s.handleStorageGetMany(ctx, params)
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

// importArtifact 把本机安装包直传业务端导入接口；客户端不保存任何结果。
// 选择的是目录时先在本地打包成临时 zip 再直传，业务端始终只收标准压缩包。
func (s *service) importArtifact(ctx context.Context, kind string, filePath string) (any, error) {
	kind = strings.TrimSpace(kind)
	var path string
	switch kind {
	case ebcontract.ReleaseArtifactKindTool:
		path = "/api/tools/import"
	case ebcontract.ReleaseArtifactKindPlugin:
		path = "/api/system-plugins/import"
	default:
		return nil, newError("BAD_REQUEST", fmt.Sprintf("不支持的导入分类 %q", kind))
	}
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return nil, newError("BAD_REQUEST", "缺少安装包文件路径")
	}
	if err := s.requireReachableBusiness(); err != nil {
		return nil, err
	}
	archivePath := filePath
	cleanup := func() {}
	if info, err := os.Stat(filePath); err == nil && info.IsDir() {
		packed, packedCleanup, packErr := packDirectoryArchive(filePath)
		if packErr != nil {
			return nil, newError("BAD_REQUEST", packErr.Error())
		}
		archivePath = packed
		cleanup = packedCleanup
	}
	defer cleanup()
	return s.eb.upload(ctx, path, archivePath)
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
		"aiChat.storageGetMany",
		"aiChat.sessionIndex.get",
		"aiChat.sessionSummary.list",
		"aiChat.session.get",
		"aiChat.session.window",
		"aiChat.session.view",
		"aiChat.session.graph",
		"aiChat.setActiveChat",
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
	//
	// 切换观测的「事件投递」边界：notice 携带 switchId 时记一次 mark，
	// 不携带时整条路径都不启动。
	if notice := objectMap(value); stringField(notice, "switchId") != "" {
		traceSwitch(switchMark{
			SwitchID: stringField(notice, "switchId"),
			Boundary: "studio.event",
			Method:   directEventChatUpdated,
			Scope:    stringField(notice, "scope"),
		})
	}
	// 事件载荷在这里编码一次，hub 只做字节分发。
	payload, err := json.Marshal(value)
	if err != nil {
		return
	}
	s.hub.broadcastRaw(directEventChatUpdated, payload)
}

func (s *service) handleImageRead(ctx context.Context, params json.RawMessage) (any, error) {
	req, err := imagePayload(params)
	if err != nil {
		return nil, err
	}
	if isWallpaperRelPath(req.Path) {
		return readWallpaperFile(s.config.dataDir(), req.Path)
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
	if isWallpaperRelPath(req.Path) {
		if req.DataURL == "" {
			return nil, newError("BAD_REQUEST", "image data url is required")
		}
		if err := writeWallpaperFile(s.config.dataDir(), req.Path, req.DataURL); err != nil {
			return nil, err
		}
		return map[string]any{"relPath": req.Path}, nil
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
	if isWallpaperRelPath(req.Path) {
		if err := removeWallpaperFile(s.config.dataDir(), req.Path); err != nil {
			return nil, err
		}
		return map[string]any{}, nil
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
	// 只解一次：path / method 复用 reader 的预览，body / query 直接取原始字节。
	// 大 body 不再经过 map[string]any 重建（少一次全量扫描与对象图分配）。
	peek, _ := requestPeekFromContext(ctx)
	path := strings.TrimSpace(peek.Envelope.Path)
	if path == "" {
		var head struct {
			Path string `json:"path"`
			URL  string `json:"url"`
		}
		if err := json.Unmarshal(paramsOrEmpty(params), &head); err != nil {
			return nil, err
		}
		path = strings.TrimSpace(head.Path)
		if path == "" {
			path = strings.TrimSpace(head.URL)
		}
	}
	if path == "" {
		return nil, errors.New("aiChat.netRequest requires path")
	}
	var envelope struct {
		Method  string          `json:"method"`
		Body    json.RawMessage `json:"body"`
		Query   json.RawMessage `json:"query"`
		Timeout float64         `json:"timeoutMs"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &envelope); err != nil {
		return nil, err
	}
	req := ebRequest{Method: fmt.Sprint(envelope.Method), Path: path, Query: envelope.Query, Body: envelope.Body}
	if envelope.Timeout > 0 {
		req.Timeout = int(envelope.Timeout)
	}
	data, err := s.eb.request(ctx, req)
	if err != nil {
		// 取消是幂等命令：对已终态的 run 重复调用必须是成功（204 语义），
		// 而不是把 runtimeStateInvalid 抛回前端（「用户连点两次停止」报错的来源）。
		if isRunCancelPath(path) && isInvalidRuntimeStateError(err) {
			return map[string]any{"status": http.StatusNoContent, "body": nil}, nil
		}
		return nil, err
	}
	return map[string]any{"status": http.StatusOK, "body": data}, nil
}

// isRunCancelPath 只匹配 `/api/runs/{id}/cancel`，不误伤其他运行命令。
func isRunCancelPath(path string) bool {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	return len(segments) == 4 && segments[0] == "api" && segments[1] == "runs" && segments[3] == "cancel"
}

// isInvalidRuntimeStateError 只识别业务端的「运行已不在可取消状态」这一个错误码：
// 这是定点语义收敛，不是把任意失败当成功。
func isInvalidRuntimeStateError(err error) bool {
	coded, ok := err.(codedError)
	if ok && coded.Code() == "runtimeStateInvalid" {
		return true
	}
	detailed, ok := err.(detailedError)
	if !ok {
		return false
	}
	details, ok := detailed.Details().(map[string]any)
	if !ok {
		return false
	}
	jsonBody, ok := details["json"].(map[string]any)
	if !ok {
		return false
	}
	errorBox, ok := jsonBody["error"].(map[string]any)
	if !ok {
		return false
	}
	return stringValue(errorBox, "code") == "runtimeStateInvalid"
}

func paramsOrEmpty(params json.RawMessage) json.RawMessage {
	if len(params) == 0 || string(params) == "null" {
		return json.RawMessage(`{}`)
	}
	return params
}
