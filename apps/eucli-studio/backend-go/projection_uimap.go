package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

func toUIRole(role map[string]any) map[string]any {
	modelConfig := objectMap(role["modelConfig"])
	coordinate := objectMap(modelConfig["coordinate"])
	modelRef := map[string]any{"kind": stringField(coordinate, "kind"), "groupId": stringField(coordinate, "groupId"), "providerId": stringField(coordinate, "providerId"), "modelId": stringField(coordinate, "modelId")}
	if stringField(modelRef, "kind") == "" {
		modelRef["kind"] = "provider"
	}
	return map[string]any{
		"id":                 stringField(role, "id"),
		"name":               fallback(stringField(role, "name"), "未命名角色"),
		"avatar":             stringField(role, "avatar"),
		"hookPromptPresetId": stringField(role, "hookPromptPresetId"),
		"systemPrompt":       promptText(objectList(role["prompts"])),
		"temperature":        numberField(modelConfig, "temperature", 0.7),
		"modelRef":           modelRef,
		"toolPolicy":         normalizeUIToolPolicy(role["toolPolicy"]),
		"createdAt":          millisFromAny(role["createdAt"]),
		"updatedAt":          millisFromAny(role["updatedAt"]),
	}
}

func fromUIRole(value any) map[string]any {
	role := objectMap(value)
	modelRef := objectMap(role["modelRef"])
	now := time.Now().UTC().Format(time.RFC3339)
	return map[string]any{
		"id":                 stringField(role, "id"),
		"name":               fallback(stringField(role, "name"), "未命名角色"),
		"avatar":             stringField(role, "avatar"),
		"description":        stringField(role, "description"),
		"hookPromptPresetId": stringField(role, "hookPromptPresetId"),
		"prompts":            []any{map[string]any{"id": "system", "role": "system", "content": stringField(role, "systemPrompt"), "order": 0, "createdAt": now, "updatedAt": now}},
		"modelConfig":        map[string]any{"coordinate": map[string]any{"kind": fallback(stringField(modelRef, "kind"), "provider"), "groupId": stringField(modelRef, "groupId"), "providerId": stringField(modelRef, "providerId"), "modelId": stringField(modelRef, "modelId")}, "temperature": numberField(role, "temperature", 0.7)},
		"toolPolicy":         normalizeUIToolPolicy(role["toolPolicy"]),
		"createdAt":          timeFromMillis(role["createdAt"]),
		"updatedAt":          time.Now().UTC().Format(time.RFC3339),
	}
}

func toUIGroup(group map[string]any) map[string]any {
	return map[string]any{
		"id":              stringField(group, "id"),
		"name":            fallback(stringField(group, "name"), "未命名群组"),
		"avatar":          fallback(stringField(group, "avatar"), "群"),
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
		"avatar":          fallback(stringField(group, "avatar"), "群"),
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

func toUIChat(session map[string]any) map[string]any {
	messages := []map[string]any{}
	for _, msg := range objectList(session["messages"]) {
		createdAt := millisFromAny(msg["createdAt"])
		updatedAt := millisFromAnyOrZero(msg["updatedAt"])
		if updatedAt == 0 {
			updatedAt = createdAt
		}
		uiMessage := map[string]any{"id": stringField(msg, "id"), "type": messageStorageType(msg), "role": messageRole(msg), "content": stringField(msg, "content"), "parentMid": stringField(msg, "parentMessageId"), "branchId": fallback(stringField(msg, "branchId"), "main"), "createdAt": createdAt, "updatedAt": updatedAt}
		if speakerRoleID := stringField(msg, "speakerRoleId"); speakerRoleID != "" {
			uiMessage["speakerRoleId"] = speakerRoleID
		}
		if control := objectMap(msg["control"]); stringField(control, "kind") != "" {
			uiMessage["control"] = control
		}
		if tokenEstimate := intField(msg, "tokenEstimate", 0); tokenEstimate > 0 {
			uiMessage["tokenEstimate"] = tokenEstimate
		}
		if errBox := objectMap(msg["error"]); stringField(errBox, "message") != "" {
			uiMessage["error"] = errBox
		}
		if parts := objectList(msg["parts"]); len(parts) > 0 {
			uiMessage["parts"] = anyList(parts)
		}
		images, attachments := toUIMessageAttachments(objectList(msg["attachments"]))
		if len(images) > 0 {
			uiMessage["images"] = images
		}
		if len(attachments) > 0 {
			uiMessage["attachments"] = attachments
		}
		messages = append(messages, uiMessage)
	}
	createdAt := millisFromAny(session["createdAt"])
	updatedAt := millisFromAnyOrZero(session["updatedAt"])
	if updatedAt == 0 {
		updatedAt = millisFromAnyOrZero(session["lastActive"])
	}
	if updatedAt == 0 {
		updatedAt = createdAt
	}
	branching := deriveUIBranching(messages, createdAt, updatedAt)
	chat := map[string]any{"id": stringField(session, "id"), "title": fallback(stringField(session, "title"), "新聊天"), "status": stringField(session, "status"), "createdAt": createdAt, "updatedAt": updatedAt, "branching": branching, "messages": anyList(messages)}
	metadata := objectMap(session["metadata"])
	if effort := normalizeReasoningEffort(stringField(metadata, "reasoningEffort")); effort != "" {
		chat["reasoningEffort"] = effort
	}
	if stringField(metadata, "streamEnabled") == "false" {
		chat["streamEnabled"] = false
	}
	if modelOverride := modelOverrideFromMetadata(metadata); stringField(modelOverride, "modelId") != "" {
		chat["modelOverride"] = modelOverride
	}
	return chat
}

func deriveUIBranching(messages []map[string]any, createdAt int64, updatedAt int64) map[string]any {
	if len(messages) == 0 {
		return map[string]any{"schemaVersion": 1, "activeBranchId": "main", "branches": []any{map[string]any{"id": "main", "name": "主线", "headMid": "", "createdAt": createdAt, "updatedAt": updatedAt, "forkFromMid": ""}}}
	}
	byID := map[string]map[string]any{}
	children := map[string][]string{}
	for _, message := range messages {
		id := stringField(message, "id")
		if id == "" {
			continue
		}
		byID[id] = message
		parentID := stringField(message, "parentMid")
		if parentID != "" {
			children[parentID] = append(children[parentID], id)
		}
	}
	for parentID := range children {
		sort.SliceStable(children[parentID], func(i int, j int) bool {
			return messageSortLess(byID[children[parentID][i]], byID[children[parentID][j]])
		})
	}
	leaves := []map[string]any{}
	for _, message := range messages {
		id := stringField(message, "id")
		if id == "" {
			continue
		}
		if len(children[id]) == 0 {
			leaves = append(leaves, message)
		}
	}
	if len(leaves) == 0 {
		leaves = append(leaves, messages[len(messages)-1])
	}
	sort.SliceStable(leaves, func(i int, j int) bool { return messageSortLess(leaves[i], leaves[j]) })
	branches := make([]any, 0, len(leaves))
	activeBranchID := "main"
	usedBranchIDs := map[string]struct{}{}
	for index, leaf := range leaves {
		headMid := stringField(leaf, "id")
		branchID := fallback(stringField(leaf, "branchId"), "main")
		branchName := "主线"
		if _, ok := usedBranchIDs[branchID]; ok {
			branchID = "leaf_" + sanitizeBranchID(headMid)
		}
		if len(leaves) > 1 && branchID != "main" {
			branchName = fmt.Sprintf("分支 %d", index+1)
		}
		usedBranchIDs[branchID] = struct{}{}
		if index == len(leaves)-1 {
			activeBranchID = branchID
		}
		branches = append(branches, map[string]any{"id": branchID, "name": branchName, "headMid": headMid, "createdAt": millisFromAnyOrZero(leaf["createdAt"]), "updatedAt": updatedAt, "forkFromMid": stringField(leaf, "parentMid")})
	}
	return map[string]any{"schemaVersion": 1, "activeBranchId": activeBranchID, "branches": branches}
}

func messageSortLess(left map[string]any, right map[string]any) bool {
	leftTime := millisFromAnyOrZero(left["createdAt"])
	rightTime := millisFromAnyOrZero(right["createdAt"])
	if leftTime != rightTime {
		return leftTime < rightTime
	}
	return stringField(left, "id") < stringField(right, "id")
}

func sanitizeBranchID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "main"
	}
	replacer := strings.NewReplacer(" ", "_", "/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return replacer.Replace(value)
}

func modelOverrideFromMetadata(metadata map[string]any) map[string]any {
	return normalizeUIModelRef(map[string]any{"kind": stringField(metadata, "modelOverride.kind"), "providerId": stringField(metadata, "modelOverride.providerId"), "groupId": stringField(metadata, "modelOverride.groupId"), "modelId": stringField(metadata, "modelOverride.modelId")})
}

func normalizeUIModelRef(value any) map[string]any {
	ref := objectMap(value)
	kind := stringField(ref, "kind")
	providerID := stringField(ref, "providerId")
	groupID := stringField(ref, "groupId")
	modelID := stringField(ref, "modelId")
	if modelID == "" {
		return nil
	}
	if kind == "model_group" || groupID != "" {
		if groupID == "" {
			return nil
		}
		return map[string]any{"kind": "model_group", "providerId": "", "groupId": groupID, "modelId": modelID}
	}
	if providerID == "" {
		return nil
	}
	return map[string]any{"kind": "provider", "providerId": providerID, "groupId": "", "modelId": modelID}
}

func toUIMessageAttachments(attachments []map[string]any) ([]any, []any) {
	images := []any{}
	files := []any{}
	for _, attachment := range attachments {
		kind := strings.TrimSpace(strings.ToLower(stringField(attachment, "kind")))
		if kind == "image" {
			path := stringField(attachment, "path")
			if path != "" {
				images = append(images, path)
			}
			continue
		}
		text := stringField(attachment, "text")
		if text == "" {
			continue
		}
		fullLen := int(numberField(attachment, "fullLen", float64(len([]rune(text)))))
		sendLen := int(numberField(attachment, "sendLen", float64(len([]rune(text)))))
		sendPct := int(numberField(attachment, "sendPct", 100))
		files = append(files, map[string]any{"id": stringField(attachment, "id"), "name": fallback(stringField(attachment, "name"), "文件"), "kind": fallback(kind, "txt"), "lang": fallback(stringField(attachment, "lang"), "text"), "text": text, "fullLen": fullLen, "sendLen": sendLen, "sendPct": sendPct})
	}
	return images, files
}

func mergeSettings(settings map[string]any, providers []map[string]any, mermaidFix map[string]any, chatTitleNaming map[string]any, stickerNaming map[string]any, contextCompression map[string]any) map[string]any {
	out := map[string]any{"streamEnabled": true, "transparentChatBg": false, "chatBgOpacity": 0, "chatBgBlur": 0, "topbarOpacity": 100, "topbarBlur": 0, "composerOpacity": 86, "composerBlur": 10, "branchTree": map[string]any{"dir": "lr", "view": "float", "followSelected": true, "modalHotkey": ""}, "renderSafetyPolicy": "original", "userMessageCollapseEnabled": false, "userMessageCollapseLines": 8, "attachments": map[string]any{"sendLimitChars": 80000, "maxFileSizeMbByKind": map[string]any{"txt": 10, "md": 10, "pdf": 10, "docx": 10, "ppt": 10}}, "stickers": map[string]any{"enabled": false, "categories": []any{}, "map": map[string]any{}}, "providers": []any{}}
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
