package main

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

const (
	uiVersion           = 7
	splitSchemaVersion  = 1
	sessionFavoritesKey = "sessions/favorites"
	runStatusRunning    = "running"
	runStatusWaiting    = "waiting_confirmation"
)

var (
	roleKeyPattern         = regexp.MustCompile(`^roles/([^/]+)/role$`)
	groupKeyPattern        = regexp.MustCompile(`^groups/([^/]+)/group$`)
	providerKeyPattern     = regexp.MustCompile(`^providers/([^/]+)/provider$`)
	modelGroupKeyPattern   = regexp.MustCompile(`^model-groups/([^/]+)/model-group$`)
	chatKeyPattern         = regexp.MustCompile(`^chats/([^/]+)/([^/]+)/chat$`)
	roleChatIndexPattern   = regexp.MustCompile(`^chats/([^/]+)/index$`)
	groupChatKeyPattern    = regexp.MustCompile(`^groups/([^/]+)/chats/([^/]+)$`)
	groupChatIndexPattern  = regexp.MustCompile(`^groups/([^/]+)/chats/index$`)
	roleAvatarPathPattern  = regexp.MustCompile(`^roles/([^/]+)/avatar\.(png|jpg|jpeg|webp)$`)
	groupAvatarPathPattern = regexp.MustCompile(`^groups/([^/]+)/avatar\.(png|jpg|jpeg|webp)$`)
)

type projectionService struct {
	config *configStore
	eb     *ebClient
	model  *readModel
}

func newProjectionService(config *configStore, eb *ebClient) *projectionService {
	return &projectionService{config: config, eb: eb, model: newReadModel()}
}

func (p *projectionService) get(ctx context.Context, key string) (any, error) {
	switch key {
	case "meta/index":
		if err := p.ensureMetaInputs(ctx); err != nil {
			return nil, err
		}
		return p.meta()
	case "stickers/index":
		return p.stickers(ctx)
	case "chats/index":
		return p.chatsIndex(ctx)
	case "providers/index":
		return p.providersIndex(ctx)
	case "model-groups/index":
		return p.modelGroupsIndex(ctx)
	case "groups/index":
		return p.groupsIndex(ctx)
	case sessionFavoritesKey:
		return p.loadFavorites(ctx)
	}
	if match := roleKeyPattern.FindStringSubmatch(key); match != nil {
		return p.roleByFolder(ctx, match[1])
	}
	if match := groupKeyPattern.FindStringSubmatch(key); match != nil {
		return p.groupByFolder(ctx, match[1])
	}
	if match := providerKeyPattern.FindStringSubmatch(key); match != nil {
		return p.providerByFolder(ctx, match[1])
	}
	if match := modelGroupKeyPattern.FindStringSubmatch(key); match != nil {
		return p.modelGroupByFolder(ctx, match[1])
	}
	if match := roleChatIndexPattern.FindStringSubmatch(key); match != nil {
		return p.roleChatIndex(ctx, match[1])
	}
	if match := chatKeyPattern.FindStringSubmatch(key); match != nil {
		return p.chatByFolder(ctx, match[1], match[2])
	}
	if match := groupChatIndexPattern.FindStringSubmatch(key); match != nil {
		return p.groupChatIndex(ctx, match[1])
	}
	if match := groupChatKeyPattern.FindStringSubmatch(key); match != nil {
		return p.groupChatByFolder(ctx, match[1], match[2])
	}
	return nil, nil
}

func (p *projectionService) set(ctx context.Context, key string, value any) error {
	if match := roleKeyPattern.FindStringSubmatch(key); match != nil {
		return p.saveRole(ctx, match[1], value)
	}
	if match := groupKeyPattern.FindStringSubmatch(key); match != nil {
		return p.saveGroup(ctx, match[1], value)
	}
	if match := providerKeyPattern.FindStringSubmatch(key); match != nil {
		return p.saveProvider(ctx, match[1], value)
	}
	if match := modelGroupKeyPattern.FindStringSubmatch(key); match != nil {
		return p.saveModelGroup(ctx, match[1], value)
	}
	if match := roleChatIndexPattern.FindStringSubmatch(key); match != nil {
		return p.saveRoleChatIndex(ctx, match[1], value)
	}
	if match := groupChatIndexPattern.FindStringSubmatch(key); match != nil {
		return p.saveGroupChatIndex(ctx, match[1], value)
	}
	if key == "meta/index" {
		return p.saveMeta(ctx, value)
	}
	if key == sessionFavoritesKey {
		return p.saveFavorites(ctx, objectMap(value))
	}
	if key == "providers/index" {
		return nil
	}
	if key == "model-groups/index" {
		return nil
	}
	if key == "stickers/index" {
		return p.saveStickers(value)
	}
	if key == "groups/index" {
		return p.saveGroupsIndex(value)
	}
	if strings.HasPrefix(key, "runtime/") {
		return newError("NOT_IMPLEMENTED", "storage key 未接入 e-b 根动作："+key)
	}
	return newError("NOT_IMPLEMENTED", "未知 storage key："+key)
}

func (p *projectionService) remove(ctx context.Context, key string) error {
	if match := roleKeyPattern.FindStringSubmatch(key); match != nil {
		roleID, err := p.roleIDByFolder(ctx, match[1])
		if isNotFoundError(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := p.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/roles/%s", roleID)}); err != nil {
			return err
		}
		p.model.catalog.roles.invalidate()
		p.model.sessions.invalidate(roleScope(roleID))
		_, err = p.config.updateProjection(func(projection *projectionConfig) {
			delete(projection.RoleFolders, roleID)
			delete(projection.ActiveChatByRole, roleID)
		})
		return err
	}
	if match := groupKeyPattern.FindStringSubmatch(key); match != nil {
		groupID, err := p.groupIDByFolder(ctx, match[1])
		if isNotFoundError(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := p.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/groups/%s", groupID)}); err != nil {
			return err
		}
		p.model.catalog.groups.invalidate()
		p.model.sessions.invalidate(groupScope(groupID))
		_, err = p.config.updateProjection(func(projection *projectionConfig) {
			delete(projection.GroupFolders, groupID)
			delete(projection.ActiveChatByGroup, groupID)
		})
		return err
	}
	if match := providerKeyPattern.FindStringSubmatch(key); match != nil {
		providerID, err := p.providerIDByFolder(ctx, match[1])
		if err != nil {
			return err
		}
		if _, err := p.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/providers/%s", providerID)}); err != nil {
			return err
		}
		p.model.catalog.providers.invalidate()
		_, err = p.config.updateProjection(func(projection *projectionConfig) {
			delete(projection.ProviderFolders, providerID)
		})
		return err
	}
	if match := modelGroupKeyPattern.FindStringSubmatch(key); match != nil {
		groupID, err := p.modelGroupIDByFolder(ctx, match[1])
		if err != nil {
			return err
		}
		groups, err := p.listModelGroups(ctx)
		if err != nil {
			return err
		}
		next := make([]map[string]any, 0, len(groups))
		for _, group := range groups {
			if stringField(group, "id") != groupID {
				next = append(next, group)
			}
		}
		if _, err := p.eb.request(ctx, ebRequest{Method: "PUT", Path: "/api/model-groups", Body: mustJSON(next)}); err != nil {
			return err
		}
		p.model.catalog.modelGroups.invalidate()
		_, err = p.config.updateProjection(func(projection *projectionConfig) {
			delete(projection.ModelGroupFolders, groupID)
		})
		return err
	}
	if match := chatKeyPattern.FindStringSubmatch(key); match != nil {
		roleID, err := p.roleIDByFolder(ctx, match[1])
		if err != nil {
			return err
		}
		_, err = p.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/roles/%s/sessions/%s", roleID, match[2])})
		if err == nil {
			p.model.sessions.invalidate(roleScope(roleID))
		}
		return err
	}
	if match := groupChatIndexPattern.FindStringSubmatch(key); match != nil {
		return p.saveGroupChatIndex(ctx, match[1], map[string]any{"activeChatId": ""})
	}
	if match := groupChatKeyPattern.FindStringSubmatch(key); match != nil {
		groupID, err := p.groupIDByFolder(ctx, match[1])
		if err != nil {
			return err
		}
		_, err = p.eb.request(ctx, ebRequest{Method: "DELETE", Path: fmt.Sprintf("/api/groups/%s/sessions/%s", groupID, match[2])})
		if err == nil {
			p.model.sessions.invalidate(groupScope(groupID))
		}
		return err
	}
	if key == sessionFavoritesKey {
		return p.saveFavorites(ctx, map[string]any{"folders": []any{}, "chatRefsByFolderId": map[string]any{}})
	}
	if key == "meta/index" || key == "chats/index" || key == "providers/index" || key == "model-groups/index" || key == "groups/index" || strings.HasPrefix(key, "runtime/") {
		return newError("NOT_IMPLEMENTED", "storage key 未接入 e-b 根动作："+key)
	}
	if key == "stickers/index" {
		return p.saveStickers(map[string]any{})
	}
	return newError("NOT_IMPLEMENTED", "未知 storage key："+key)
}

func roleScope(roleID string) sessionScope {
	return sessionScope{Kind: sessionScopeKindRole, TargetID: roleID}
}

func groupScope(groupID string) sessionScope {
	return sessionScope{Kind: sessionScopeKindGroup, TargetID: groupID}
}

// resetReadModel 是「连接换代 / 索引重建」语义：
// 清空实体与会话快照、推进 epoch，让前端按 epoch 变化整份重拉。
func (p *projectionService) resetReadModel() {
	p.model.catalog.invalidateAll()
	p.model.assist.invalidate()
	p.model.sessions.invalidateAll()
}

func (p *projectionService) saveMeta(ctx context.Context, value any) error {
	meta := objectMap(value)
	settings := objectMap(meta["settings"])
	if err := p.saveAssistConfigs(ctx, settings); err != nil {
		return err
	}
	if len(settings) > 0 {
		p.model.assist.invalidate()
	}
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		projection.UI = objectMap(meta["ui"])
		projection.Settings = mergeProjectionSettingsForMetaSave(projection.Settings, settings)
	})
	return err
}

func (p *projectionService) loadFavorites(ctx context.Context) (map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/sessions/favorites"})
	if err != nil {
		return nil, err
	}
	favorites, ok := data.(map[string]any)
	if !ok {
		return nil, newError("BAD_RESPONSE", "favorites response must be an object")
	}
	return favorites, nil
}

func (p *projectionService) saveFavorites(ctx context.Context, favorites map[string]any) error {
	_, err := p.eb.request(ctx, ebRequest{Method: "PUT", Path: "/api/sessions/favorites", Body: mustJSON(favorites)})
	return err
}

func (p *projectionService) saveAssistConfigs(ctx context.Context, settings map[string]any) error {
	services := objectMap(settings["aiServices"])
	requests := []struct {
		config map[string]any
		path   string
	}{
		{config: objectMap(services["stickerNaming"]), path: "/api/assist/stickers/name/config"},
		{config: objectMap(services["mermaidFix"]), path: "/api/assist/mermaid-fix/config"},
		{config: objectMap(services["chatTitleNaming"]), path: "/api/assist/chat-title/config"},
		{config: objectMap(services["contextCompression"]), path: "/api/assist/context-compression/config"},
	}
	for _, req := range requests {
		if len(req.config) == 0 {
			continue
		}
		kind := stringField(req.config, "kind")
		providerID := stringField(req.config, "providerId")
		groupID := stringField(req.config, "groupId")
		modelID := stringField(req.config, "modelId")
		coordinate := assistModelCoordinate(kind, providerID, groupID, modelID)
		body := map[string]any{"enabled": boolField(req.config, "enabled", false), "modelPick": modelID, "coordinate": coordinate, "systemPrompt": stringField(req.config, "systemPrompt"), "lowTemperature": boolField(req.config, "lowTemperature", true)}
		if req.path == "/api/assist/context-compression/config" {
			body = map[string]any{"modelPick": modelID, "coordinate": coordinate, "retainRecentMessages": intField(req.config, "retainRecentMessages", 15), "lowTemperature": boolField(req.config, "lowTemperature", true)}
		}
		if _, err := p.eb.request(ctx, ebRequest{Method: "PUT", Path: req.path, Body: mustJSON(body)}); err != nil {
			return err
		}
	}
	return nil
}

func (p *projectionService) saveStickers(value any) error {
	stickers := objectMap(value)
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		settings := copyObjectMap(projection.Settings)
		settings["stickers"] = map[string]any{"enabled": boolField(stickers, "enabled", false)}
		projection.Settings = settings
	})
	return err
}

func (p *projectionService) stickers(ctx context.Context) (any, error) {
	library, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/stickers"})
	if err != nil {
		return nil, err
	}
	cfg, err := p.config.load()
	if err != nil {
		return nil, err
	}
	enabled := boolField(objectMap(cfg.Projection.Settings["stickers"]), "enabled", false)
	libraryMap := objectMap(library)
	categories := []string{}
	stickerMap := map[string]any{}
	for _, summary := range objectList(libraryMap["categories"]) {
		name := stringField(summary, "name")
		if name == "" {
			continue
		}
		categories = append(categories, name)
		stickerMap[name] = map[string]any{}
	}
	itemsByCategory := objectMap(libraryMap["map"])
	for _, category := range categories {
		box := map[string]any{}
		for index, item := range objectList(itemsByCategory[category]) {
			name := stringField(item, "name")
			relPath := stringField(item, "relPath")
			if name == "" || relPath == "" {
				continue
			}
			createdAt := millisFromAny(item["createdAt"])
			updatedAt := millisFromAnyOrZero(item["updatedAt"])
			if updatedAt == 0 {
				updatedAt = createdAt
			}
			box[name] = map[string]any{"relPath": relPath, "createdAt": createdAt, "updatedAt": updatedAt, "order": index}
		}
		stickerMap[category] = box
	}
	return map[string]any{"enabled": enabled, "categories": categories, "map": stickerMap, "updatedAt": millisFromAny(libraryMap["updatedAt"])}, nil
}

func (p *projectionService) loadAssistConfig(ctx context.Context, path string) (map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: path})
	if err != nil {
		return nil, err
	}
	config := objectMap(data)
	coordinate := objectMap(config["coordinate"])
	modelID := stringField(coordinate, "modelId")
	modelPick := stringField(config, "modelPick")
	if modelID == "" && modelPick != "__custom__" {
		modelID = modelPick
	}
	return map[string]any{
		"enabled":              boolField(config, "enabled", false),
		"kind":                 stringField(coordinate, "kind"),
		"groupId":              stringField(coordinate, "groupId"),
		"providerId":           stringField(coordinate, "providerId"),
		"modelId":              modelID,
		"systemPrompt":         stringField(config, "systemPrompt"),
		"retainRecentMessages": intField(config, "retainRecentMessages", 15),
		"lowTemperature":       boolField(config, "lowTemperature", true),
		"updatedAt":            millisFromAnyOrZero(config["updatedAt"]),
	}, nil
}

// ensureMetaInputs 为旧 storage key 路径（meta/index）预热读模型。
//
// 旧 meta 形状仍携带 chatIndexByRole / chatIndexByGroup（形状不变），
// 所以这条旧路径需要把每个 scope 的索引预热出来，与旧实现等价——
// 这是「前端不改也不会坏」的前提。
//
// 新接口（sessionIndex.get / sessionSummary.list / session.get）各自按需预热，
// 绝不经过这里——这才是「切换热路径不再装配全站」的结构保证。
// meta() 本身仍然是纯组装，零 I/O。
func (p *projectionService) ensureMetaInputs(ctx context.Context) error {
	if err := p.ensureCatalog(ctx); err != nil {
		return err
	}
	if _, err := p.ensureAssistConfigs(ctx); err != nil {
		return err
	}
	// 单个 scope 失败不阻断 meta：旧实现同样对 sessionsIndexForRole 的错误取空值。
	for _, role := range p.model.catalog.roles.items() {
		if id := stringField(role, "id"); id != "" {
			_, _ = p.ensureSessionIndex(ctx, roleScope(id))
		}
	}
	for _, group := range p.model.catalog.groups.items() {
		if id := stringField(group, "id"); id != "" {
			_, _ = p.ensureSessionIndex(ctx, groupScope(id))
		}
	}
	return nil
}

func (p *projectionService) ensureCatalog(ctx context.Context) error {
	if err := p.ensureRoles(ctx); err != nil {
		return err
	}
	if err := p.ensureProviders(ctx); err != nil {
		return err
	}
	if err := p.ensureModelGroups(ctx); err != nil {
		return err
	}
	return p.ensureGroups(ctx)
}

func (p *projectionService) ensureRoles(ctx context.Context) error {
	_, err := p.model.catalog.roles.load(ctx, "roles", p.listRoles)
	return err
}

func (p *projectionService) ensureProviders(ctx context.Context) error {
	_, err := p.model.catalog.providers.load(ctx, "providers", p.listProviders)
	return err
}

func (p *projectionService) ensureGroups(ctx context.Context) error {
	_, err := p.model.catalog.groups.load(ctx, "groups", p.listGroups)
	return err
}

func (p *projectionService) ensureModelGroups(ctx context.Context) error {
	_, err := p.model.catalog.modelGroups.load(ctx, "model-groups", p.listModelGroups)
	return err
}

func (p *projectionService) ensureAssistConfigs(ctx context.Context) (map[string]any, error) {
	snapshot, err := p.model.assist.load(ctx, "assist", p.fetchAssistConfigs)
	if err != nil {
		return nil, err
	}
	return snapshot.value, nil
}

func (p *projectionService) fetchAssistConfigs(ctx context.Context) (map[string]any, error) {
	out := map[string]any{}
	for _, item := range []struct {
		key  string
		path string
	}{
		{key: "mermaidFix", path: "/api/assist/mermaid-fix/config"},
		{key: "chatTitleNaming", path: "/api/assist/chat-title/config"},
		{key: "stickerNaming", path: "/api/assist/stickers/name/config"},
		{key: "contextCompression", path: "/api/assist/context-compression/config"},
	} {
		config, err := p.loadAssistConfig(ctx, item.path)
		if err != nil {
			return nil, err
		}
		out[item.key] = config
	}
	return out, nil
}

// ensureSessionIndex 保证某个 scope 的索引快照存在（缺失时单飞加载）。
func (p *projectionService) ensureSessionIndex(ctx context.Context, scope sessionScope) (*sessionIndexSnapshot, error) {
	if !scope.valid() {
		return nil, newError("BAD_REQUEST", "会话 scope 无效")
	}
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	if scope.Kind == sessionScopeKindRole {
		return p.model.sessions.load(ctx, scope, func(loadCtx context.Context) (map[string]any, error) {
			sessions, err := p.listSessions(loadCtx, scope.TargetID)
			if err != nil {
				return nil, err
			}
			return buildSessionIndex(sessions, "新聊天", projection.UpdatedAt), nil
		})
	}
	return p.model.sessions.load(ctx, scope, func(loadCtx context.Context) (map[string]any, error) {
		sessions, err := p.listGroupSessions(loadCtx, scope.TargetID)
		if err != nil {
			return nil, err
		}
		return buildSessionIndex(sessions, "群聊", projection.UpdatedAt), nil
	})
}

// buildSessionIndex 只装数据事实：activeChatId 是 UI 偏好，由读取方现场组装。
func buildSessionIndex(sessions []map[string]any, fallbackTitle string, baseUpdatedAt int64) map[string]any {
	indexUpdatedAt := stableUpdatedAt(baseUpdatedAt)
	chatIDs := []string{}
	chatUpdatedAt := map[string]any{}
	chatMetas := []any{}
	for _, session := range sessions {
		id := stringField(session, "id")
		if id == "" {
			continue
		}
		updatedAt := stableUpdatedAt(millisFromAnyOrZero(session["lastActive"]), millisFromAnyOrZero(session["updatedAt"]), millisFromAnyOrZero(session["createdAt"]))
		chatIDs = append(chatIDs, id)
		chatUpdatedAt[id] = updatedAt
		chatMetas = append(chatMetas, map[string]any{"id": id, "title": fallback(stringField(session, "title"), fallbackTitle), "lastMessagePreview": stringField(session, "lastMessagePreview"), "updatedAt": updatedAt, "createdAt": updatedAt})
		indexUpdatedAt = stableUpdatedAt(indexUpdatedAt, updatedAt)
	}
	return map[string]any{"chatIds": chatIDs, "chatUpdatedAt": chatUpdatedAt, "chatMetas": chatMetas, "updatedAt": indexUpdatedAt}
}

// meta 是纯组装：不读盘、不发请求、不写状态。
// 调用前必须由 ensureMetaInputs 预热（storageGet / 新接口都这样做）。
func (p *projectionService) meta() (any, error) {
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	assist := map[string]any{}
	if snapshot := p.model.assist.peek(); snapshot != nil {
		assist = snapshot.value
	}
	roles := p.model.catalog.roles.items()
	providers := p.model.catalog.providers.items()
	groups := p.model.catalog.groups.items()
	modelGroups := p.model.catalog.modelGroups.items()

	roleOrder := []string{}
	roleFolders := map[string]string{}
	chatIndexByRole := map[string]any{}
	for _, role := range roles {
		id := stringField(role, "id")
		if id == "" {
			continue
		}
		roleOrder = append(roleOrder, id)
		roleFolders[id] = folderFor(projection.RoleFolders, id, stringField(role, "name"), "角色")
		chatIndexByRole[id] = p.composeSessionIndex(roleScope(id), projection.ActiveChatByRole[id])
	}
	providerOrder := []string{}
	providerFolders := map[string]string{}
	for _, provider := range providers {
		id := stringField(provider, "id")
		if id == "" {
			continue
		}
		providerOrder = append(providerOrder, id)
		providerFolders[id] = folderFor(projection.ProviderFolders, id, stringField(provider, "name"), "供应商")
	}
	modelGroupOrder := []string{}
	modelGroupFolders := map[string]string{}
	for _, group := range modelGroups {
		id := stringField(group, "id")
		if id == "" {
			continue
		}
		modelGroupOrder = append(modelGroupOrder, id)
		modelGroupFolders[id] = folderFor(projection.ModelGroupFolders, id, stringField(group, "name"), "模型组")
	}
	groupByID := map[string]map[string]any{}
	for _, group := range groups {
		id := stringField(group, "id")
		if id == "" {
			continue
		}
		groupByID[id] = group
	}
	groupOrder := []string{}
	groupFolders := map[string]string{}
	chatIndexByGroup := map[string]any{}
	for _, id := range orderedIDs(projection.GroupOrder, mapKeys(groupByID)) {
		group := groupByID[id]
		groupOrder = append(groupOrder, id)
		groupFolders[id] = folderFor(projection.GroupFolders, id, stringField(group, "name"), "群组")
		chatIndexByGroup[id] = p.composeSessionIndex(groupScope(id), projection.ActiveChatByGroup[id])
	}

	mermaidFix := objectMap(assist["mermaidFix"])
	chatTitleNaming := objectMap(assist["chatTitleNaming"])
	stickerNaming := objectMap(assist["stickerNaming"])
	contextCompression := objectMap(assist["contextCompression"])

	return map[string]any{
		"schemaVersion": splitSchemaVersion,
		"dataVersion":   uiVersion,
		// updatedAt 只是展示排序字段：禁止任何新鲜度判定依赖它。
		"updatedAt": projection.UpdatedAt,
		// 三层版本各司其职：数据（box）、偏好（studio）、重建纪元（box 进程/索引重建）。
		"dataRevision":       p.model.dataRevision(),
		"preferenceRevision": projection.Revision,
		"epoch":              p.model.epoch(),
		"ui":                 projection.UI,
		"settings":           mergeSettings(projection.Settings, providers, mermaidFix, chatTitleNaming, stickerNaming, contextCompression),
		"roleOrder":          roleOrder,
		"roleFolders":        roleFolders,
		"chatIndexByRole":    chatIndexByRole,
		"groupOrder":         groupOrder,
		"groupFolders":       groupFolders,
		"chatIndexByGroup":   chatIndexByGroup,
		"providerOrder":      providerOrder,
		"providerFolders":    providerFolders,
		"modelGroupOrder":    modelGroupOrder,
		"modelGroupFolders":  modelGroupFolders,
	}, nil
}

// composeSessionIndex 把「数据快照」与「UI 偏好」组装成旧 storage key 的对外形状。
// 快照缺席时返回空索引：meta() 绝不为了补一个 scope 去发请求。
// 返回形状与旧实现逐字段一致，不夹带版本字段。
func (p *projectionService) composeSessionIndex(scope sessionScope, preferredActive string) map[string]any {
	return p.sessionIndexView(scope, p.model.sessions.peek(scope), preferredActive)
}

// composeSessionIndexWithSnapshot 是新接口（sessionIndex.get）的封装：
// 在同样的视图上附带 revision 与 scope，供前端按版本对账。
func (p *projectionService) composeSessionIndexWithSnapshot(scope sessionScope, snapshot *sessionIndexSnapshot, preferredActive string) map[string]any {
	view := p.sessionIndexView(scope, snapshot, preferredActive)
	if snapshot != nil {
		view["revision"] = snapshot.revision
	} else {
		view["revision"] = int64(0)
	}
	view["scope"] = scope.key()
	return view
}

func (p *projectionService) sessionIndexView(scope sessionScope, snapshot *sessionIndexSnapshot, preferredActive string) map[string]any {
	if snapshot == nil {
		return map[string]any{"activeChatId": "", "chatIds": []any{}, "chatUpdatedAt": map[string]any{}, "chatMetas": []any{}, "updatedAt": 1}
	}
	index := snapshot.index
	chatIDs := stringSlice(index["chatIds"])
	active := strings.TrimSpace(preferredActive)
	if active != "" && !containsString(chatIDs, active) {
		active = ""
	}
	if active == "" && len(chatIDs) > 0 {
		active = chatIDs[0]
	}
	return map[string]any{
		"activeChatId":  active,
		"chatIds":       chatIDs,
		"chatUpdatedAt": index["chatUpdatedAt"],
		"chatMetas":     index["chatMetas"],
		"updatedAt":     index["updatedAt"],
	}
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
