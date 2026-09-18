package main

import (
	"context"
	"fmt"
	"strings"
)

func (p *projectionService) roleByFolder(ctx context.Context, folder string) (any, error) {
	roles, err := p.listRoles(ctx)
	if err != nil {
		return nil, err
	}
	cfg, _ := p.config.load()
	for _, role := range roles {
		id := stringField(role, "id")
		if folderFor(cfg.Projection.RoleFolders, id, stringField(role, "name"), "角色") == folder {
			uiRole := toUIRole(role)
			if avatarImage, err := p.loadRoleAvatar(ctx, id); err == nil {
				uiRole["avatarImage"] = avatarImage
			}
			return uiRole, nil
		}
	}
	return nil, newError("NOT_FOUND", "角色不存在")
}

func (p *projectionService) groupByFolder(ctx context.Context, folder string) (any, error) {
	groups, err := p.listGroups(ctx)
	if err != nil {
		return nil, err
	}
	cfg, _ := p.config.load()
	for _, group := range groups {
		id := stringField(group, "id")
		if folderFor(cfg.Projection.GroupFolders, id, stringField(group, "name"), "群组") == folder {
			uiGroup := toUIGroup(group)
			if avatarImage, err := p.loadGroupAvatar(ctx, id); err == nil {
				uiGroup["avatarImage"] = avatarImage
			}
			return uiGroup, nil
		}
	}
	return nil, newError("NOT_FOUND", "群组不存在")
}

func (p *projectionService) roleIDByAvatarPath(ctx context.Context, path string) (string, error) {
	match := roleAvatarPathPattern.FindStringSubmatch(strings.TrimSpace(path))
	if match == nil {
		return "", newError("NOT_IMPLEMENTED", "仅支持角色头像图片路径")
	}
	return p.roleIDByFolder(ctx, match[1])
}

func (p *projectionService) groupIDByAvatarPath(ctx context.Context, path string) (string, error) {
	match := groupAvatarPathPattern.FindStringSubmatch(strings.TrimSpace(path))
	if match == nil {
		return "", newError("NOT_IMPLEMENTED", "仅支持群组头像图片路径")
	}
	return p.groupIDByFolder(ctx, match[1])
}

func (p *projectionService) providerByFolder(ctx context.Context, folder string) (any, error) {
	providers, err := p.listProviders(ctx)
	if err != nil {
		return nil, err
	}
	cfg, _ := p.config.load()
	for _, provider := range providers {
		id := stringField(provider, "id")
		if folderFor(cfg.Projection.ProviderFolders, id, stringField(provider, "name"), "供应商") == folder {
			return toUIProvider(provider), nil
		}
	}
	return nil, newError("NOT_FOUND", "供应商不存在")
}

func (p *projectionService) modelGroupByFolder(ctx context.Context, folder string) (any, error) {
	groups, err := p.listModelGroups(ctx)
	if err != nil {
		return nil, err
	}
	cfg, _ := p.config.load()
	for _, group := range groups {
		id := stringField(group, "id")
		if folderFor(cfg.Projection.ModelGroupFolders, id, stringField(group, "name"), "模型组") == folder {
			return group, nil
		}
	}
	return nil, newError("NOT_FOUND", "模型组不存在")
}

func (p *projectionService) chatByFolder(ctx context.Context, folder string, chatID string) (any, error) {
	roleID, err := p.roleIDByFolder(ctx, folder)
	if err != nil {
		return nil, err
	}
	session, err := p.loadSession(ctx, roleID, chatID)
	if err != nil {
		return nil, err
	}
	return toUIChat(session), nil
}

func (p *projectionService) groupChatByFolder(ctx context.Context, folder string, chatID string) (any, error) {
	groupID, err := p.groupIDByFolder(ctx, folder)
	if err != nil {
		return nil, err
	}
	session, err := p.loadGroupSession(ctx, groupID, chatID)
	if err != nil {
		return nil, err
	}
	return toUIChat(session), nil
}

func (p *projectionService) saveRole(ctx context.Context, folder string, value any) error {
	role := fromUIRole(value)
	roleID := stringField(role, "id")
	if roleID == "" {
		return newError("BAD_REQUEST", "role id is required")
	}
	if _, err := p.eb.request(ctx, ebRequest{Method: "POST", Path: "/api/roles", Body: mustJSON(role)}); err != nil {
		return err
	}
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		projection.RoleFolders[roleID] = folder
	})
	return err
}

func (p *projectionService) saveGroup(ctx context.Context, folder string, value any) error {
	group := fromUIGroup(value)
	groupID := stringField(group, "id")
	if groupID == "" {
		return newError("BAD_REQUEST", "group id is required")
	}
	if _, err := p.eb.request(ctx, ebRequest{Method: "POST", Path: "/api/groups", Body: mustJSON(group)}); err != nil {
		return err
	}
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		projection.GroupFolders[groupID] = folder
	})
	return err
}

func (p *projectionService) saveProvider(ctx context.Context, folder string, value any) error {
	provider := fromUIProvider(value)
	providerID := stringField(provider, "id")
	if providerID == "" {
		return newError("BAD_REQUEST", "provider id is required")
	}
	if _, err := p.eb.request(ctx, ebRequest{Method: "POST", Path: "/api/providers", Body: mustJSON(provider)}); err != nil {
		return err
	}
	_, err := p.config.updateProjection(func(projection *projectionConfig) {
		projection.ProviderFolders[providerID] = folder
	})
	return err
}

func (p *projectionService) saveModelGroup(ctx context.Context, folder string, value any) error {
	group := objectMap(value)
	groupID := stringField(group, "id")
	if groupID == "" {
		return newError("BAD_REQUEST", "model group id is required")
	}
	groups, err := p.listModelGroups(ctx)
	if err != nil {
		return err
	}
	next := make([]map[string]any, 0, len(groups)+1)
	replaced := false
	for _, existing := range groups {
		if stringField(existing, "id") == groupID {
			next = append(next, group)
			replaced = true
			continue
		}
		next = append(next, existing)
	}
	if !replaced {
		next = append([]map[string]any{group}, next...)
	}
	if _, err := p.eb.request(ctx, ebRequest{Method: "PUT", Path: "/api/model-groups", Body: mustJSON(next)}); err != nil {
		return err
	}
	_, err = p.config.updateProjection(func(projection *projectionConfig) {
		projection.ModelGroupFolders[groupID] = folder
	})
	return err
}

func (p *projectionService) listRoles(ctx context.Context) ([]map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/roles"})
	if err != nil {
		return nil, err
	}
	summaries := objectList(data)
	roles := make([]map[string]any, 0, len(summaries))
	for _, summary := range summaries {
		id := stringField(summary, "id")
		if id == "" {
			continue
		}
		detail, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/roles/%s", id)})
		if err != nil {
			return nil, err
		}
		roles = append(roles, objectMap(detail))
	}
	return roles, nil
}

func (p *projectionService) listProviders(ctx context.Context) ([]map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/providers"})
	if err != nil {
		return nil, err
	}
	summaries := objectList(data)
	providers := make([]map[string]any, 0, len(summaries))
	for _, summary := range summaries {
		id := stringField(summary, "id")
		if id == "" {
			continue
		}
		detail, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/providers/%s", id)})
		if err != nil {
			return nil, err
		}
		providers = append(providers, objectMap(detail))
	}
	return providers, nil
}

func (p *projectionService) listModelGroups(ctx context.Context) ([]map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/model-groups"})
	return objectList(data), err
}

func (p *projectionService) listGroups(ctx context.Context) ([]map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: "/api/groups"})
	if err != nil {
		return nil, err
	}
	summaries := objectList(data)
	groups := make([]map[string]any, 0, len(summaries))
	for _, summary := range summaries {
		id := stringField(summary, "id")
		if id == "" {
			continue
		}
		detail, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/groups/%s", id)})
		if err != nil {
			return nil, err
		}
		groups = append(groups, objectMap(detail))
	}
	return groups, nil
}

func (p *projectionService) listSessions(ctx context.Context, roleID string) ([]map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/roles/%s/sessions", roleID)})
	return objectList(data), err
}

func (p *projectionService) listGroupSessions(ctx context.Context, groupID string) ([]map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/groups/%s/sessions", groupID)})
	return objectList(data), err
}

func (p *projectionService) loadSession(ctx context.Context, roleID string, sessionID string) (map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/roles/%s/sessions/%s", roleID, sessionID)})
	if err != nil {
		return nil, err
	}
	return objectMap(data), nil
}

func (p *projectionService) loadGroupSession(ctx context.Context, groupID string, sessionID string) (map[string]any, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/groups/%s/sessions/%s", groupID, sessionID)})
	if err != nil {
		return nil, err
	}
	return objectMap(data), nil
}

func (p *projectionService) loadRoleAvatar(ctx context.Context, roleID string) (string, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/roles/%s/avatar", roleID)})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(fmt.Sprint(data)), nil
}

func (p *projectionService) loadGroupAvatar(ctx context.Context, groupID string) (string, error) {
	data, err := p.eb.request(ctx, ebRequest{Method: "GET", Path: fmt.Sprintf("/api/groups/%s/avatar", groupID)})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(fmt.Sprint(data)), nil
}

func (p *projectionService) roleIDByFolder(ctx context.Context, folder string) (string, error) {
	roles, err := p.listRoles(ctx)
	if err != nil {
		return "", err
	}
	cfg, _ := p.config.load()
	for _, role := range roles {
		id := stringField(role, "id")
		if folderFor(cfg.Projection.RoleFolders, id, stringField(role, "name"), "角色") == folder {
			return id, nil
		}
	}
	return "", newError("NOT_FOUND", "角色不存在")
}

func (p *projectionService) groupIDByFolder(ctx context.Context, folder string) (string, error) {
	groups, err := p.listGroups(ctx)
	if err != nil {
		return "", err
	}
	cfg, _ := p.config.load()
	for _, group := range groups {
		id := stringField(group, "id")
		if folderFor(cfg.Projection.GroupFolders, id, stringField(group, "name"), "群组") == folder {
			return id, nil
		}
	}
	return "", newError("NOT_FOUND", "群组不存在")
}

func (p *projectionService) providerIDByFolder(ctx context.Context, folder string) (string, error) {
	providers, err := p.listProviders(ctx)
	if err != nil {
		return "", err
	}
	cfg, _ := p.config.load()
	for _, provider := range providers {
		id := stringField(provider, "id")
		if folderFor(cfg.Projection.ProviderFolders, id, stringField(provider, "name"), "供应商") == folder {
			return id, nil
		}
	}
	return "", newError("NOT_FOUND", "供应商不存在")
}

func (p *projectionService) modelGroupIDByFolder(ctx context.Context, folder string) (string, error) {
	groups, err := p.listModelGroups(ctx)
	if err != nil {
		return "", err
	}
	cfg, _ := p.config.load()
	for _, group := range groups {
		id := stringField(group, "id")
		if folderFor(cfg.Projection.ModelGroupFolders, id, stringField(group, "name"), "模型组") == folder {
			return id, nil
		}
	}
	return "", newError("NOT_FOUND", "模型组不存在")
}
