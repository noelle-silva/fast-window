package main

import (
	"fmt"
	"strings"
	"time"
)

func toUIRole(role map[string]any) map[string]any {
	modelConfig := objectMap(role["modelConfig"])
	candidates := uiModelCandidates(modelConfig)
	return map[string]any{
		"id":                      stringField(role, "id"),
		"name":                    fallback(stringField(role, "name"), "未命名角色"),
		"hookPromptPresetId":      stringField(role, "hookPromptPresetId"),
		"systemPrompt":            promptText(objectList(role["prompts"])),
		"temperature":             numberField(modelConfig, "temperature", 1),
		"temperatureEnabled":      boolField(modelConfig, "temperatureEnabled", false),
		"modelCandidates":         candidates,
		"defaultModelCandidateId": uiDefaultCandidateID(modelConfig, candidates),
		"toolPolicy":              normalizeUIToolPolicy(role["toolPolicy"]),
		"createdAt":               millisFromAny(role["createdAt"]),
		"updatedAt":               millisFromAny(role["updatedAt"]),
	}
}

func fromUIRole(value any) map[string]any {
	role := objectMap(value)
	now := time.Now().UTC().Format(time.RFC3339)
	return map[string]any{
		"id":                 stringField(role, "id"),
		"name":               fallback(stringField(role, "name"), "未命名角色"),
		"description":        stringField(role, "description"),
		"hookPromptPresetId": stringField(role, "hookPromptPresetId"),
		"prompts":            []any{map[string]any{"id": "system", "role": "system", "content": stringField(role, "systemPrompt"), "order": 0, "createdAt": now, "updatedAt": now}},
		"modelConfig":        boxModelConfigFromUI(role),
		"toolPolicy":         normalizeUIToolPolicy(role["toolPolicy"]),
		"createdAt":          timeFromMillis(role["createdAt"]),
		"updatedAt":          time.Now().UTC().Format(time.RFC3339),
	}
}

func toUIGroup(group map[string]any) map[string]any {
	return map[string]any{
		"id":              stringField(group, "id"),
		"name":            fallback(stringField(group, "name"), "未命名群组"),
		"prompt":          stringField(group, "prompt"),
		"mode":            fallback(stringField(group, "mode"), "roundRobin"),
		"memberRoleIds":   stringSlice(group["memberRoleIds"]),
		"roundRobinOrder": stringSlice(group["roundRobinOrder"]),
		"random":          normalizeUIGroupRandom(group["random"]),
		"createdAt":       millisFromAny(group["createdAt"]),
		"updatedAt":       millisFromAny(group["updatedAt"]),
	}
}

func fromUIGroup(value any) map[string]any {
	group := objectMap(value)
	now := time.Now().UTC().Format(time.RFC3339)
	return map[string]any{
		"id":              stringField(group, "id"),
		"name":            fallback(stringField(group, "name"), "未命名群组"),
		"prompt":          stringField(group, "prompt"),
		"mode":            normalizeGroupMode(stringField(group, "mode")),
		"memberRoleIds":   stringSlice(group["memberRoleIds"]),
		"roundRobinOrder": stringSlice(group["roundRobinOrder"]),
		"random":          normalizeUIGroupRandom(group["random"]),
		"createdAt":       timeFromMillis(group["createdAt"]),
		"updatedAt":       now,
	}
}

func normalizeGroupMode(value string) string {
	if strings.TrimSpace(value) == "random" {
		return "random"
	}
	return "roundRobin"
}

func normalizeUIGroupRandom(value any) map[string]any {
	random := objectMap(value)
	return map[string]any{
		"weightsByRoleId": objectMap(random["weightsByRoleId"]),
		"minCount":        intField(random, "minCount", 1),
		"maxCount":        intField(random, "maxCount", 2),
	}
}

func normalizeUIToolPolicy(value any) map[string]any {
	policy := objectMap(value)
	runModeSource := objectMap(policy["runModes"])
	tools := []any{}
	nativeTools := []any{}
	runModes := map[string]any{}
	seen := map[string]struct{}{}
	toolSet := map[string]struct{}{}
	for _, tool := range stringSlice(policy["tools"]) {
		tool = strings.TrimSpace(tool)
		if tool == "" {
			continue
		}
		if _, ok := seen[tool]; ok {
			continue
		}
		mode := strings.TrimSpace(fmt.Sprint(runModeSource[tool]))
		seen[tool] = struct{}{}
		toolSet[tool] = struct{}{}
		tools = append(tools, tool)
		if mode == "ask" || mode == "direct" {
			runModes[tool] = mode
		}
	}
	nativeSeen := map[string]struct{}{}
	for _, tool := range stringSlice(policy["nativeTools"]) {
		tool = strings.TrimSpace(tool)
		if tool == "" {
			continue
		}
		if _, ok := toolSet[tool]; !ok {
			continue
		}
		if _, ok := nativeSeen[tool]; ok {
			continue
		}
		nativeSeen[tool] = struct{}{}
		nativeTools = append(nativeTools, tool)
	}
	return map[string]any{"tools": tools, "nativeTools": nativeTools, "runModes": runModes}
}

func toUIProvider(provider map[string]any) map[string]any {
	models := []any{}
	for _, model := range objectList(provider["models"]) {
		id := stringField(model, "id")
		if id != "" {
			models = append(models, id)
		}
	}
	apiKeys := anyList(objectList(provider["apiKeys"]))
	registeredModels := anyList(objectList(provider["registeredModels"]))
	legacyKey := stringField(provider, "key")
	if len(apiKeys) == 0 && legacyKey != "" {
		apiKeys = []any{map[string]any{"id": "legacy", "name": "默认 Key", "key": legacyKey, "enabled": true, "weight": 1}}
	}
	return map[string]any{"id": stringField(provider, "id"), "name": stringField(provider, "name"), "baseUrl": stringField(provider, "baseUrl"), "apiKey": legacyKey, "apiKeyStrategy": fallback(stringField(provider, "apiKeyStrategy"), "sequential"), "apiKeys": apiKeys, "protocol": stringField(provider, "protocol"), "registeredModels": registeredModels, "modelsCache": map[string]any{"items": models, "fetchedAt": millisFromAny(provider["updatedAt"])}}
}

func fromUIProvider(value any) map[string]any {
	provider := objectMap(value)
	modelsCache := objectMap(provider["modelsCache"])
	models := []any{}
	for _, modelID := range stringSlice(modelsCache["items"]) {
		models = append(models, map[string]any{"id": modelID, "name": modelID})
	}
	return map[string]any{"id": stringField(provider, "id"), "name": stringField(provider, "name"), "baseUrl": stringField(provider, "baseUrl"), "key": stringField(provider, "apiKey"), "apiKeyStrategy": fallback(stringField(provider, "apiKeyStrategy"), "sequential"), "apiKeys": anyList(objectList(provider["apiKeys"])), "protocol": stringField(provider, "protocol"), "models": models, "registeredModels": anyList(objectList(provider["registeredModels"]))}
}

func mergeSettings(settings map[string]any, providers []map[string]any, mermaidFix map[string]any, chatTitleNaming map[string]any, stickerNaming map[string]any, contextCompression map[string]any) map[string]any {
	out := map[string]any{"streamEnabled": true, "transparentChatBg": false, "chatBgOpacity": 0, "chatBgBlur": 0, "topbarOpacity": 100, "topbarBlur": 0, "composerOpacity": 86, "composerBlur": 10, "branchTree": map[string]any{"dir": "lr", "view": "float", "followSelected": true, "modalHotkey": ""}, "renderSafetyPolicy": "original", "userMessageCollapseEnabled": false, "userMessageCollapseLines": 8, "stickers": map[string]any{"enabled": false, "categories": []any{}, "map": map[string]any{}}, "providers": []any{}}
	for k, v := range settings {
		out[k] = v
	}
	uiProviders := []any{}
	for _, provider := range providers {
		uiProviders = append(uiProviders, toUIProvider(provider))
	}
	out["providers"] = uiProviders
	aiServices := objectMap(out["aiServices"])
	aiServices["mermaidFix"] = mermaidFix
	aiServices["chatTitleNaming"] = chatTitleNaming
	aiServices["stickerNaming"] = stickerNaming
	aiServices["contextCompression"] = contextCompression
	out["aiServices"] = aiServices
	return out
}
