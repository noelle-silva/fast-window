package main

import (
	"context"
)

func (p *projectionService) saveChatsIndex(value any) error {
	index := objectMap(value)
	roleOrder := stringSlice(index["roleOrder"])
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		projection.RoleOrder = roleOrder
	})
	return err
}

func (p *projectionService) chatsIndex(ctx context.Context) (any, error) {
	meta, err := p.meta(ctx)
	if err != nil {
		return nil, err
	}
	m := meta.(map[string]any)
	return map[string]any{"roleOrder": m["roleOrder"], "roleFolders": m["roleFolders"], "updatedAt": stableUpdatedAt(millisFromAnyOrZero(m["updatedAt"]))}, nil
}

func (p *projectionService) providersIndex(ctx context.Context) (any, error) {
	meta, err := p.meta(ctx)
	if err != nil {
		return nil, err
	}
	m := meta.(map[string]any)
	return map[string]any{"providerOrder": m["providerOrder"], "providerFolders": m["providerFolders"], "updatedAt": stableUpdatedAt(millisFromAnyOrZero(m["updatedAt"]))}, nil
}

func (p *projectionService) modelGroupsIndex(ctx context.Context) (any, error) {
	meta, err := p.meta(ctx)
	if err != nil {
		return nil, err
	}
	m := meta.(map[string]any)
	return map[string]any{"modelGroupOrder": m["modelGroupOrder"], "modelGroupFolders": m["modelGroupFolders"], "updatedAt": stableUpdatedAt(millisFromAnyOrZero(m["updatedAt"]))}, nil
}

func (p *projectionService) groupsIndex(ctx context.Context) (any, error) {
	meta, err := p.meta(ctx)
	if err != nil {
		return nil, err
	}
	m := meta.(map[string]any)
	return map[string]any{"groupOrder": m["groupOrder"], "groupFolders": m["groupFolders"], "updatedAt": stableUpdatedAt(millisFromAnyOrZero(m["updatedAt"]))}, nil
}

func (p *projectionService) roleChatIndex(ctx context.Context, folder string) (any, error) {
	roleID, err := p.roleIDByFolder(ctx, folder)
	if err != nil {
		return nil, err
	}
	return p.sessionsIndexForRole(ctx, roleID)
}

func (p *projectionService) groupChatIndex(ctx context.Context, folder string) (any, error) {
	groupID, err := p.groupIDByFolder(ctx, folder)
	if err != nil {
		return nil, err
	}
	return p.sessionsIndexForGroup(ctx, groupID)
}

func (p *projectionService) sessionsIndexForRole(ctx context.Context, roleID string) (any, error) {
	cfg, _ := p.config.load()
	indexUpdatedAt := stableUpdatedAt(cfg.Projection.UpdatedAt)
	sessions, err := p.listSessions(ctx, roleID)
	if err != nil {
		return map[string]any{"activeChatId": "", "chatIds": []any{}, "chatUpdatedAt": map[string]any{}, "chatMetas": []any{}, "updatedAt": indexUpdatedAt}, err
	}
	chatIds := []string{}
	chatUpdatedAt := map[string]any{}
	chatMetas := []any{}
	for _, session := range sessions {
		id := stringField(session, "id")
		if id == "" {
			continue
		}
		updatedAt := stableUpdatedAt(millisFromAnyOrZero(session["lastActive"]), millisFromAnyOrZero(session["updatedAt"]), millisFromAnyOrZero(session["createdAt"]))
		chatIds = append(chatIds, id)
		chatUpdatedAt[id] = updatedAt
		chatMetas = append(chatMetas, map[string]any{"id": id, "title": fallback(stringField(session, "title"), "新聊天"), "updatedAt": updatedAt, "createdAt": updatedAt})
		indexUpdatedAt = stableUpdatedAt(indexUpdatedAt, updatedAt)
	}
	active := cfg.Projection.ActiveChatByRole[roleID]
	if active != "" {
		found := false
		for _, id := range chatIds {
			if id == active {
				found = true
				break
			}
		}
		if !found {
			active = ""
		}
	}
	if active == "" && len(chatIds) > 0 {
		active = chatIds[0]
	}
	return map[string]any{"activeChatId": active, "chatIds": chatIds, "chatUpdatedAt": chatUpdatedAt, "chatMetas": chatMetas, "updatedAt": indexUpdatedAt}, nil
}

func (p *projectionService) sessionsIndexForGroup(ctx context.Context, groupID string) (any, error) {
	cfg, _ := p.config.load()
	indexUpdatedAt := stableUpdatedAt(cfg.Projection.UpdatedAt)
	sessions, err := p.listGroupSessions(ctx, groupID)
	if err != nil {
		return map[string]any{"activeChatId": "", "chatIds": []any{}, "chatUpdatedAt": map[string]any{}, "chatMetas": []any{}, "updatedAt": indexUpdatedAt}, err
	}
	chatIds := []string{}
	chatUpdatedAt := map[string]any{}
	chatMetas := []any{}
	for _, session := range sessions {
		id := stringField(session, "id")
		if id == "" {
			continue
		}
		updatedAt := stableUpdatedAt(millisFromAnyOrZero(session["lastActive"]), millisFromAnyOrZero(session["updatedAt"]), millisFromAnyOrZero(session["createdAt"]))
		chatIds = append(chatIds, id)
		chatUpdatedAt[id] = updatedAt
		chatMetas = append(chatMetas, map[string]any{"id": id, "title": fallback(stringField(session, "title"), "群聊"), "updatedAt": updatedAt, "createdAt": updatedAt})
		indexUpdatedAt = stableUpdatedAt(indexUpdatedAt, updatedAt)
	}
	active := cfg.Projection.ActiveChatByGroup[groupID]
	if active != "" {
		found := false
		for _, id := range chatIds {
			if id == active {
				found = true
				break
			}
		}
		if !found {
			active = ""
		}
	}
	if active == "" && len(chatIds) > 0 {
		active = chatIds[0]
	}
	return map[string]any{"activeChatId": active, "chatIds": chatIds, "chatUpdatedAt": chatUpdatedAt, "chatMetas": chatMetas, "updatedAt": indexUpdatedAt}, nil
}

func (p *projectionService) saveRoleChatIndex(ctx context.Context, folder string, value any) error {
	roleID, err := p.roleIDByFolder(ctx, folder)
	if err != nil {
		return err
	}
	index := objectMap(value)
	activeChatID := stringField(index, "activeChatId")
	_, err = p.config.updateProjection(func(projection *projectionConfig) {
		if activeChatID == "" {
			delete(projection.ActiveChatByRole, roleID)
			return
		}
		projection.ActiveChatByRole[roleID] = activeChatID
	})
	return err
}

func (p *projectionService) saveGroupChatIndex(ctx context.Context, folder string, value any) error {
	groupID, err := p.groupIDByFolder(ctx, folder)
	if err != nil {
		return err
	}
	index := objectMap(value)
	activeChatID := stringField(index, "activeChatId")
	_, err = p.config.updateProjection(func(projection *projectionConfig) {
		if activeChatID == "" {
			delete(projection.ActiveChatByGroup, groupID)
			return
		}
		projection.ActiveChatByGroup[groupID] = activeChatID
	})
	return err
}

func (p *projectionService) saveGroupsIndex(value any) error {
	index := objectMap(value)
	groupOrder := stringSlice(index["groupOrder"])
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		projection.GroupOrder = groupOrder
	})
	return err
}
