package main

import (
	"errors"
	"strings"
)

func (svc *service) loadSplitMeta() (map[string]any, error) {
	value, err := svc.storageGetByKey(splitMetaKey)
	if err != nil {
		return nil, err
	}
	meta, _ := value.(map[string]any)
	if meta == nil {
		return nil, errors.New("存储未初始化")
	}
	if int(asInt64(meta["schemaVersion"], 0)) != 1 {
		return nil, errors.New("存储索引损坏：meta/index 格式不正确")
	}

	chatsIndex, _ := svc.loadObject(splitChatsIndexKeyGo())
	roleOrder := normalizeStringIDsKeepOrder(firstNonNil(chatsIndex["roleOrder"], meta["roleOrder"]))
	roleFolders := normalizeStringMapGo(firstNonNil(chatsIndex["roleFolders"], meta["roleFolders"]))
	chatIndexByRole := map[string]any{}
	for _, roleID := range roleOrder {
		folder := strings.TrimSpace(roleFolders[roleID])
		if folder == "" {
			continue
		}
		idx, _ := svc.loadObject(splitRoleChatIndexKeyGo(folder))
		if idx == nil {
			idx = asMap(asMap(meta["chatIndexByRole"])[roleID])
		}
		chatIndexByRole[roleID] = normalizeChatIndexSnapshot(idx)
	}

	groupsIndex, _ := svc.loadObject(splitGroupsIndexKeyGo())
	groupOrder := normalizeStringIDsKeepOrder(firstNonNil(groupsIndex["groupOrder"], meta["groupOrder"]))
	groupFolders := normalizeStringMapGo(firstNonNil(groupsIndex["groupFolders"], meta["groupFolders"]))
	chatIndexByGroup := map[string]any{}
	for _, groupID := range groupOrder {
		folder := strings.TrimSpace(groupFolders[groupID])
		if folder == "" {
			continue
		}
		idx, _ := svc.loadObject(splitGroupChatIndexKeyGo(folder))
		if idx == nil {
			idx = asMap(asMap(meta["chatIndexByGroup"])[groupID])
		}
		chatIndexByGroup[groupID] = normalizeChatIndexSnapshot(idx)
	}

	meta["roleOrder"] = roleOrder
	meta["roleFolders"] = roleFolders
	meta["chatIndexByRole"] = chatIndexByRole
	meta["groupOrder"] = groupOrder
	meta["groupFolders"] = groupFolders
	meta["chatIndexByGroup"] = chatIndexByGroup
	return meta, nil
}

func (svc *service) loadProviders() ([]any, error) {
	metaValue, err := svc.storageGetByKey(splitMetaKey)
	if err != nil {
		return nil, err
	}
	meta := asMap(metaValue)
	index, _ := svc.loadObject(splitProvidersIndexKeyGo())
	providerOrder := normalizeStringIDsKeepOrder(index["providerOrder"])
	providerFolders := normalizeStringMapGo(index["providerFolders"])
	if len(providerOrder) == 0 {
		providers := asSlice(asMap(meta["settings"])["providers"])
		if providers == nil {
			return []any{}, nil
		}
		return providers, nil
	}
	providers := make([]any, 0, len(providerOrder))
	for _, providerID := range providerOrder {
		folder := strings.TrimSpace(providerFolders[providerID])
		if folder == "" {
			continue
		}
		provider, err := svc.loadObject(splitProviderKeyGo(folder))
		if err != nil {
			return nil, err
		}
		if provider != nil {
			providers = append(providers, provider)
		}
	}
	return providers, nil
}

func normalizeChatIndexSnapshot(idx map[string]any) map[string]any {
	if idx == nil {
		idx = map[string]any{}
	}
	return map[string]any{
		"activeChatId":  strings.TrimSpace(asString(idx["activeChatId"])),
		"chatIds":       normalizeStringIDsKeepOrder(idx["chatIds"]),
		"chatUpdatedAt": asMapOrNew(idx["chatUpdatedAt"]),
	}
}

func normalizeStringMapGo(raw any) map[string]string {
	src := asMap(raw)
	out := map[string]string{}
	for key, value := range src {
		k := strings.TrimSpace(key)
		v := strings.TrimSpace(asString(value))
		if k != "" && v != "" {
			out[k] = v
		}
	}
	return out
}

func normalizeStringIDsKeepOrder(raw any) []string {
	items := asSlice(raw)
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		value := strings.TrimSpace(asString(item))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func asMapOrNew(raw any) map[string]any {
	value := asMap(raw)
	if value == nil {
		return map[string]any{}
	}
	return value
}

func firstNonNil(items ...any) any {
	for _, item := range items {
		if item != nil {
			return item
		}
	}
	return nil
}

func splitChatsIndexKeyGo() string {
	return "chats/index"
}

func splitRoleChatIndexKeyGo(folder string) string {
	return "chats/" + strings.TrimSpace(folder) + "/index"
}

func splitGroupsIndexKeyGo() string {
	return "groups/index"
}

func splitGroupChatIndexKeyGo(folder string) string {
	return "groups/" + strings.TrimSpace(folder) + "/chats/index"
}

func splitProvidersIndexKeyGo() string {
	return "providers/index"
}

func splitProviderKeyGo(folder string) string {
	return "providers/" + strings.TrimSpace(folder) + "/provider"
}
