package main

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
)

// P2/P3 新接口：协议走 scope，不走 storage key。
//
//   aiChat.sessionIndex.get({scopes})        原子快照，只返回请求里可见的 scope
//   aiChat.sessionSummary.list({scope,cursor}) 单 scope 分页
//   aiChat.session.get({scope, chatId})      详情层
//   aiChat.setActiveChat({scope,chatId})     偏好命令，只推进 preferenceRevision
//   aiChat.storageGetMany                    仅迁移垫片，不进长期契约
//
// 内部仍然走现有 eucli-box HTTP 接口：先把新契约在 studio 侧自洽跑通，
// 不假设 box 侧已经有新接口。

const (
	sessionSummaryDefaultLimit = 50
	sessionSummaryMaxLimit     = 200
)

func (s *service) handleSessionIndexGet(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scopes []any `json:"scopes"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "sessionIndex.get 参数无效")
	}
	// 只返回调用方声明的可见 scope：不再默认返回全站 chatIndexByRole。
	scopes := make([]sessionScope, 0, len(req.Scopes))
	seen := map[string]struct{}{}
	for _, raw := range req.Scopes {
		scope, ok := parseSessionScope(raw)
		if !ok {
			return nil, newError("BAD_REQUEST", "sessionIndex.get 收到无效 scope")
		}
		if _, dup := seen[scope.key()]; dup {
			continue
		}
		seen[scope.key()] = struct{}{}
		scopes = append(scopes, scope)
	}
	if len(scopes) == 0 {
		return nil, newError("BAD_REQUEST", "sessionIndex.get 需要至少一个 scope")
	}

	cfg, err := s.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)

	indexes := make([]any, 0, len(scopes))
	for _, scope := range scopes {
		snapshot, err := s.projection.ensureSessionIndex(ctx, scope)
		if err != nil {
			return nil, err
		}
		preferred := projection.ActiveChatByRole[scope.TargetID]
		if scope.Kind == sessionScopeKindGroup {
			preferred = projection.ActiveChatByGroup[scope.TargetID]
		}
		indexes = append(indexes, s.projection.composeSessionIndexWithSnapshot(scope, snapshot, preferred))
	}
	return map[string]any{
		"schemaVersion":      splitSchemaVersion,
		"dataRevision":       s.projection.model.dataRevision(),
		"preferenceRevision": projection.Revision,
		"epoch":              s.projection.model.epoch(),
		"indexes":            indexes,
	}, nil
}

func (s *service) handleSessionSummaryList(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scope  any    `json:"scope"`
		Cursor string `json:"cursor"`
		Limit  int    `json:"limit"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "sessionSummary.list 参数无效")
	}
	scope, ok := parseSessionScope(req.Scope)
	if !ok {
		return nil, newError("BAD_REQUEST", "sessionSummary.list 需要有效 scope")
	}
	limit := req.Limit
	if limit <= 0 {
		limit = sessionSummaryDefaultLimit
	}
	if limit > sessionSummaryMaxLimit {
		limit = sessionSummaryMaxLimit
	}
	snapshot, err := s.projection.ensureSessionIndex(ctx, scope)
	if err != nil {
		return nil, err
	}
	metas := objectList(snapshot.index["chatMetas"])
	sorted := make([]map[string]any, 0, len(metas))
	for _, meta := range metas {
		if stringField(meta, "id") == "" {
			continue
		}
		sorted = append(sorted, meta)
	}
	// 排序契约与业务端一致：updatedAt 降序，id 升序做稳定兜底。
	sort.SliceStable(sorted, func(i int, j int) bool {
		left := millisFromAnyOrZero(sorted[i]["updatedAt"])
		right := millisFromAnyOrZero(sorted[j]["updatedAt"])
		if left != right {
			return left > right
		}
		return stringField(sorted[i], "id") < stringField(sorted[j], "id")
	})

	cursor := strings.TrimSpace(req.Cursor)
	start := 0
	if cursor != "" {
		start = len(sorted)
		for index, meta := range sorted {
			if stringField(meta, "id") == cursor {
				start = index + 1
				break
			}
		}
	}
	end := start + limit
	if end > len(sorted) {
		end = len(sorted)
	}
	if start > len(sorted) {
		start = len(sorted)
	}
	page := make([]any, 0, end-start)
	for _, meta := range sorted[start:end] {
		page = append(page, meta)
	}
	nextCursor := ""
	if end < len(sorted) && end > 0 {
		nextCursor = stringField(sorted[end-1], "id")
	}
	return map[string]any{
		"scope":      scope.key(),
		"items":      page,
		"nextCursor": nextCursor,
		"revision":   snapshot.revision,
		"updatedAt":  snapshot.index["updatedAt"],
	}, nil
}

func (s *service) handleSessionGet(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scope   any    `json:"scope"`
		ChatID  string `json:"chatId"`
		Profile string `json:"profile"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "session.get 参数无效")
	}
	scope, ok := parseSessionScope(req.Scope)
	if !ok {
		return nil, newError("BAD_REQUEST", "session.get 需要有效 scope")
	}
	chatID := strings.TrimSpace(req.ChatID)
	if chatID == "" {
		return nil, newError("BAD_REQUEST", "session.get 需要 chatId")
	}
	profile, err := sessionWireProfile(req.Profile)
	if err != nil {
		return nil, err
	}
	return s.projection.sessionRawWithProfile(ctx, scope, chatID, profile)
}

// handleSessionWindow 是消息窗口的唯一入口：studio 只做「参数校验 + 转发」，
// 分页与裁剪全部属于业务端的领域职责。
//
// cursor 由业务端签发与解释（内含 head/anchor/direction/profile），
// studio 原样透传：第二套游标方言只会让两端语义分叉。
func (s *service) handleSessionWindow(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scope    any    `json:"scope"`
		ChatID   string `json:"chatId"`
		Cursor   string `json:"cursor"`
		Head     string `json:"head"`
		Before   string `json:"before"`
		Limit    int    `json:"limit"`
		MaxBytes int    `json:"maxBytes"`
		Profile  string `json:"profile"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "session.window 参数无效")
	}
	scope, ok := parseSessionScope(req.Scope)
	if !ok {
		return nil, newError("BAD_REQUEST", "session.window 需要有效 scope")
	}
	chatID := strings.TrimSpace(req.ChatID)
	if chatID == "" {
		return nil, newError("BAD_REQUEST", "session.window 需要 chatId")
	}
	profile, err := sessionWireProfile(req.Profile)
	if err != nil {
		return nil, err
	}
	window, err := normalizeSessionWindowParams(sessionWindowParams{
		Head:     req.Head,
		Before:   req.Before,
		Limit:    req.Limit,
		MaxBytes: req.MaxBytes,
		Profile:  profile,
		Cursor:   req.Cursor,
	})
	if err != nil {
		return nil, err
	}
	base, err := sessionRoutePath(scope, chatID)
	if err != nil {
		return nil, err
	}
	payload, err := s.eb.requestRaw(ctx, ebRequest{
		Method: "GET",
		Path:   base + "/window",
		Query:  mustJSON(window.query()),
	})
	if err != nil {
		return nil, err
	}
	// 窗口文档按字节透传：前端是唯一真解析方。
	return newRawResult(payload), nil
}

// handleSessionGraph 是树视图的结构投影（design-4 P3）。
//
// 为什么需要独立端点：窗口模式只加载一窗（≤ limit 条），
// 树视图若吃首窗消息就只画得出首屏那几条，分支结构被截断。
//
// 契约：只回结构（id / parent / branch / createdAt / 极短文本），**不回正文**。
// studio 只做参数校验与转发；结构投影属于业务端的领域职责。
func (s *service) handleSessionGraph(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scope  any    `json:"scope"`
		ChatID string `json:"chatId"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "session.graph 参数无效")
	}
	scope, ok := parseSessionScope(req.Scope)
	if !ok {
		return nil, newError("BAD_REQUEST", "session.graph 需要有效 scope")
	}
	chatID := strings.TrimSpace(req.ChatID)
	if chatID == "" {
		return nil, newError("BAD_REQUEST", "session.graph 需要 chatId")
	}
	base, err := sessionRoutePath(scope, chatID)
	if err != nil {
		return nil, err
	}
	payload, err := s.eb.requestRaw(ctx, ebRequest{
		Method: "GET",
		Path:   base + "/graph",
	})
	if err != nil {
		return nil, err
	}
	return newRawResult(payload), nil
}

// handleSessionView 把「用户在看哪条路径」变成服务端事实（design-4 决策 3）。
//
// 背景：前端 setActiveBranch / switchBranchByAssistantSibling 过去只改本地
// chat.branching，从不回写；于是多客户端 / 重启后「用户在看哪条路径」丢失。
//
// 语义：head 是「以这条消息为终点的路径」，比 branchId 可靠
// （branchId 空值一律回落 main，真正的分叉事实是 parentMessageId + 多个 child）。
// studio 只做参数校验与转发，视图状态的持久化属于业务端领域职责。
func (s *service) handleSessionView(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scope  any    `json:"scope"`
		ChatID string `json:"chatId"`
		Head   string `json:"head"`
		Branch string `json:"branchId"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "session.view 参数无效")
	}
	scope, ok := parseSessionScope(req.Scope)
	if !ok {
		return nil, newError("BAD_REQUEST", "session.view 需要有效 scope")
	}
	chatID := strings.TrimSpace(req.ChatID)
	if chatID == "" {
		return nil, newError("BAD_REQUEST", "session.view 需要 chatId")
	}
	head := strings.TrimSpace(req.Head)
	if head == "" {
		return nil, newError("BAD_REQUEST", "session.view 需要 head")
	}
	base, err := sessionRoutePath(scope, chatID)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"head": head}
	if branch := strings.TrimSpace(req.Branch); branch != "" {
		body["branchId"] = branch
	}
	payload, err := s.eb.requestRaw(ctx, ebRequest{
		Method: "PATCH",
		Path:   base + "/view",
		Body:   mustJSON(body),
	})
	if err != nil {
		return nil, err
	}
	// 视图变了：本地正文/窗口缓存必须作废，否则下一次读会拿旧路径的窗口。
	s.projection.model.bodies.reset()
	return newRawResult(payload), nil
}

// setActiveChat 是独立命令：幂等，只推进 preferenceRevision，不碰业务 revision。
func (s *service) handleSetActiveChat(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Scope            any    `json:"scope"`
		ChatID           string `json:"chatId"`
		ExpectedRevision *int64 `json:"expectedRevision"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "setActiveChat 参数无效")
	}
	scope, ok := parseSessionScope(req.Scope)
	if !ok {
		return nil, newError("BAD_REQUEST", "setActiveChat 需要有效 scope")
	}
	chatID := strings.TrimSpace(req.ChatID)

	cfg, err := s.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	current := projection.ActiveChatByRole[scope.TargetID]
	if scope.Kind == sessionScopeKindGroup {
		current = projection.ActiveChatByGroup[scope.TargetID]
	}
	if req.ExpectedRevision != nil && *req.ExpectedRevision != projection.Revision {
		return map[string]any{
			"applied":            false,
			"preferenceRevision": projection.Revision,
			"activeChatId":       current,
			"reason":             "revision_mismatch",
		}, nil
	}
	// 幂等：目标与现状一致时不写盘、不推进版本。
	if current == chatID {
		return map[string]any{
			"applied":            true,
			"preferenceRevision": projection.Revision,
			"activeChatId":       current,
		}, nil
	}
	updated, err := s.config.updateProjection(func(next *projectionConfig) {
		if scope.Kind == sessionScopeKindGroup {
			if chatID == "" {
				delete(next.ActiveChatByGroup, scope.TargetID)
				return
			}
			next.ActiveChatByGroup[scope.TargetID] = chatID
			return
		}
		if chatID == "" {
			delete(next.ActiveChatByRole, scope.TargetID)
			return
		}
		next.ActiveChatByRole[scope.TargetID] = chatID
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"applied":            true,
		"preferenceRevision": updated.Revision,
		"activeChatId":       chatID,
	}, nil
}

// storageGetMany 只是迁移垫片：让前端一次拿多个旧 storage key，
// 把「4 个 key 扇出」压成一次往返。它不是长期契约。
func (s *service) handleStorageGetMany(ctx context.Context, params json.RawMessage) (any, error) {
	var req struct {
		Keys []string `json:"keys"`
	}
	if err := json.Unmarshal(paramsOrEmpty(params), &req); err != nil {
		return nil, newError("BAD_REQUEST", "storageGetMany 参数无效")
	}
	if len(req.Keys) == 0 {
		return nil, newError("BAD_REQUEST", "storageGetMany 需要 keys")
	}
	values := map[string]any{}
	for _, raw := range req.Keys {
		key := strings.TrimSpace(raw)
		if key == "" {
			continue
		}
		value, err := s.projection.get(ctx, key)
		if err != nil {
			return nil, err
		}
		// 迁移垫片只承载索引类 key：会话正文是字节中继的结果，
		// 塞进 map 再编码会静默丢掉整份载荷，因此这里显式拒绝。
		if _, ok := value.(rawResult); ok {
			return nil, newError("BAD_REQUEST", "storageGetMany 不支持会话正文 key："+key)
		}
		values[key] = value
	}
	return map[string]any{"values": values}, nil
}
