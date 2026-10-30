package main

import (
	"context"
)

// 四个 index key 不再走 meta()：
// meta() 是「全站装配」，为拿 4 个字段而装配全部实体与会话索引，
// 在切换热路径上等于把 O(R²+G²) 的代价塞进每个 index 读取。
// 这里改成只取自己需要的那一小块，返回形状保持不变。

func (p *projectionService) chatsIndex(ctx context.Context) (any, error) {
	if err := p.ensureRoles(ctx); err != nil {
		return nil, err
	}
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	roleOrder := []string{}
	roleFolders := map[string]string{}
	for _, role := range p.model.catalog.roles.items() {
		id := stringField(role, "id")
		if id == "" {
			continue
		}
		roleOrder = append(roleOrder, id)
		roleFolders[id] = folderFor(projection.RoleFolders, id, stringField(role, "name"), "角色")
	}
	return map[string]any{
		"roleOrder":   roleOrder,
		"roleFolders": roleFolders,
		"updatedAt":   stableUpdatedAt(projection.UpdatedAt),
	}, nil
}

func (p *projectionService) providersIndex(ctx context.Context) (any, error) {
	if err := p.ensureProviders(ctx); err != nil {
		return nil, err
	}
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	providerOrder := []string{}
	providerFolders := map[string]string{}
	for _, provider := range p.model.catalog.providers.items() {
		id := stringField(provider, "id")
		if id == "" {
			continue
		}
		providerOrder = append(providerOrder, id)
		providerFolders[id] = folderFor(projection.ProviderFolders, id, stringField(provider, "name"), "供应商")
	}
	return map[string]any{
		"providerOrder":   providerOrder,
		"providerFolders": providerFolders,
		"updatedAt":       stableUpdatedAt(projection.UpdatedAt),
	}, nil
}

func (p *projectionService) modelGroupsIndex(ctx context.Context) (any, error) {
	if err := p.ensureModelGroups(ctx); err != nil {
		return nil, err
	}
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	modelGroupOrder := []string{}
	modelGroupFolders := map[string]string{}
	for _, group := range p.model.catalog.modelGroups.items() {
		id := stringField(group, "id")
		if id == "" {
			continue
		}
		modelGroupOrder = append(modelGroupOrder, id)
		modelGroupFolders[id] = folderFor(projection.ModelGroupFolders, id, stringField(group, "name"), "模型组")
	}
	return map[string]any{
		"modelGroupOrder":   modelGroupOrder,
		"modelGroupFolders": modelGroupFolders,
		"updatedAt":         stableUpdatedAt(projection.UpdatedAt),
	}, nil
}

func (p *projectionService) groupsIndex(ctx context.Context) (any, error) {
	if err := p.ensureGroups(ctx); err != nil {
		return nil, err
	}
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	groupByID := map[string]map[string]any{}
	for _, group := range p.model.catalog.groups.items() {
		id := stringField(group, "id")
		if id == "" {
			continue
		}
		groupByID[id] = group
	}
	groupOrder := []string{}
	groupFolders := map[string]string{}
	for _, id := range orderedIDs(projection.GroupOrder, mapKeys(groupByID)) {
		groupOrder = append(groupOrder, id)
		groupFolders[id] = folderFor(projection.GroupFolders, id, stringField(groupByID[id], "name"), "群组")
	}
	return map[string]any{
		"groupOrder":   groupOrder,
		"groupFolders": groupFolders,
		"updatedAt":    stableUpdatedAt(projection.UpdatedAt),
	}, nil
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
	return p.sessionsIndex(ctx, roleScope(roleID), "新聊天")
}

func (p *projectionService) sessionsIndexForGroup(ctx context.Context, groupID string) (any, error) {
	return p.sessionsIndex(ctx, groupScope(groupID), "群聊")
}

// sessionsIndex 是「单 scope 会话索引」的唯一装配点：
// 数据来自读模型快照，activeChatId 来自客户端偏好，返回形状与旧实现逐字段一致。
func (p *projectionService) sessionsIndex(ctx context.Context, scope sessionScope, _ string) (any, error) {
	if !scope.valid() {
		return nil, newError("BAD_REQUEST", "会话 scope 无效")
	}
	cfg, err := p.config.snapshot()
	if err != nil {
		return nil, err
	}
	projection := normalizeProjection(cfg.Projection)
	preferred := projection.ActiveChatByRole[scope.TargetID]
	if scope.Kind == sessionScopeKindGroup {
		preferred = projection.ActiveChatByGroup[scope.TargetID]
	}
	snapshot, err := p.ensureSessionIndex(ctx, scope)
	if err != nil {
		return nil, err
	}
	return p.sessionIndexView(scope, snapshot, preferred), nil
}

// saveRoleChatIndex 只接收 activeChatId：
// 索引里的 chatIds / chatMetas / updatedAt 是业务数据派生物，由业务端与读模型负责，
// 客户端整包回写在这里必须被丢弃，否则一次「切换会话」就变成一次索引改写。
func (p *projectionService) saveRoleChatIndex(ctx context.Context, folder string, value any) error {
	roleID, err := p.roleIDByFolder(ctx, folder)
	if err != nil {
		return err
	}
	activeChatID := stringField(objectMap(value), "activeChatId")
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
	activeChatID := stringField(objectMap(value), "activeChatId")
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
