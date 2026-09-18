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
}

func newProjectionService(config *configStore, eb *ebClient) *projectionService {
	return &projectionService{config: config, eb: eb}
}

func (p *projectionService) get(ctx context.Context, key string) (any, error) {
	switch key {
	case "meta/index":
		return p.meta(ctx)
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
	if key == "chats/index" {
		return p.saveChatsIndex(value)
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

func (p *projectionService) saveMeta(ctx context.Context, value any) error {
	meta := objectMap(value)
	settings := objectMap(meta["settings"])
	if err := p.saveAssistConfigs(ctx, settings); err != nil {
		return err
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
		body := map[string]any{"enabled": boolField(req.config, "enabled", false), "modelPick": modelID, "coordinate": coordinate, "systemPrompt": stringField(req.config, "systemPrompt"), "temperature": 0.2}
		if req.path == "/api/assist/context-compression/config" {
			body = map[string]any{"modelPick": modelID, "coordinate": coordinate, "retainRecentMessages": intField(req.config, "retainRecentMessages", 15), "temperature": 0.2}
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
		for _, item := range objectList(itemsByCategory[category]) {
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
			box[name] = map[string]any{"relPath": relPath, "createdAt": createdAt, "updatedAt": updatedAt}
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
		"updatedAt":            millisFromAnyOrZero(config["updatedAt"]),
	}, nil
}

func (p *projectionService) meta(ctx context.Context) (any, error) {
	roles, err := p.listRoles(ctx)
	if err != nil {
		return nil, err
	}
	providers, err := p.listProviders(ctx)
	if err != nil {
		return nil, err
	}
	mermaidFix, err := p.loadAssistConfig(ctx, "/api/assist/mermaid-fix/config")
	if err != nil {
		return nil, err
	}
	chatTitleNaming, err := p.loadAssistConfig(ctx, "/api/assist/chat-title/config")
	if err != nil {
		return nil, err
	}
	stickerNaming, err := p.loadAssistConfig(ctx, "/api/assist/stickers/name/config")
	if err != nil {
		return nil, err
	}
	contextCompression, err := p.loadAssistConfig(ctx, "/api/assist/context-compression/config")
	if err != nil {
		return nil, err
	}
	cfg, err := p.config.load()
	if err != nil {
		return nil, err
	}
	projection := cfg.Projection
	roleOrder := []string{}
	roleFolders := map[string]string{}
	chatIndexByRole := map[string]any{}
	roleByID := map[string]map[string]any{}
	updatedAt := stableUpdatedAt(projection.UpdatedAt)
	for _, role := range roles {
		id := stringField(role, "id")
		if id == "" {
			continue
		}
		roleByID[id] = role
		updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(role["updatedAt"]), millisFromAnyOrZero(role["createdAt"]))
	}
	for _, id := range orderedIDs(projection.RoleOrder, mapKeys(roleByID)) {
		role := roleByID[id]
		folder := folderFor(projection.RoleFolders, id, stringField(role, "name"), "角色")
		roleOrder = append(roleOrder, id)
		roleFolders[id] = folder
		index, _ := p.sessionsIndexForRole(ctx, id)
		chatIndexByRole[id] = index
		updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(objectMap(index)["updatedAt"]))
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
		updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(provider["updatedAt"]), millisFromAnyOrZero(provider["createdAt"]))
	}
	modelGroups, err := p.listModelGroups(ctx)
	if err != nil {
		return nil, err
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
		updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(group["updatedAt"]), millisFromAnyOrZero(group["createdAt"]))
	}
	groups, err := p.listGroups(ctx)
	if err != nil {
		return nil, err
	}
	groupOrder := []string{}
	groupFolders := map[string]string{}
	chatIndexByGroup := map[string]any{}
	groupByID := map[string]map[string]any{}
	for _, group := range groups {
		id := stringField(group, "id")
		if id == "" {
			continue
		}
		groupByID[id] = group
		updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(group["updatedAt"]), millisFromAnyOrZero(group["createdAt"]))
	}
	for _, id := range orderedIDs(projection.GroupOrder, mapKeys(groupByID)) {
		group := groupByID[id]
		folder := folderFor(projection.GroupFolders, id, stringField(group, "name"), "群组")
		groupOrder = append(groupOrder, id)
		groupFolders[id] = folder
		index, _ := p.sessionsIndexForGroup(ctx, id)
		chatIndexByGroup[id] = index
		updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(objectMap(index)["updatedAt"]))
	}
	updatedAt = stableUpdatedAt(updatedAt, millisFromAnyOrZero(mermaidFix["updatedAt"]), millisFromAnyOrZero(chatTitleNaming["updatedAt"]), millisFromAnyOrZero(stickerNaming["updatedAt"]), millisFromAnyOrZero(contextCompression["updatedAt"]))
	return map[string]any{
		"schemaVersion":     splitSchemaVersion,
		"dataVersion":       uiVersion,
		"updatedAt":         updatedAt,
		"ui":                projection.UI,
		"settings":          mergeSettings(projection.Settings, providers, mermaidFix, chatTitleNaming, stickerNaming, contextCompression),
		"roleOrder":         roleOrder,
		"roleFolders":       roleFolders,
		"chatIndexByRole":   chatIndexByRole,
		"groupOrder":        groupOrder,
		"groupFolders":      groupFolders,
		"chatIndexByGroup":  chatIndexByGroup,
		"providerOrder":     providerOrder,
		"providerFolders":   providerFolders,
		"modelGroupOrder":   modelGroupOrder,
		"modelGroupFolders": modelGroupFolders,
	}, nil
}
