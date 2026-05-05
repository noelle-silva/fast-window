package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
)

const (
	splitMetaKey           = "meta/index"
	groupSpeakerUserPrefix = "用户"
	chatDefaultBranchID    = "main"
)

func (svc *service) buildOpenAIChatReqFromStorage(job map[string]any) (aiHTTPRequest, error) {
	roleID := strings.TrimSpace(asString(job["roleId"]))
	chatID := strings.TrimSpace(asString(job["chatId"]))
	if roleID == "" || chatID == "" {
		return aiHTTPRequest{}, errors.New("job 缺少 roleId/chatId")
	}

	meta, err := svc.loadSplitMeta()
	if err != nil {
		return aiHTTPRequest{}, err
	}
	folder := strings.TrimSpace(asString(asMap(meta["roleFolders"])[roleID]))
	if folder == "" {
		return aiHTTPRequest{}, errors.New("角色不存在")
	}

	role, err := svc.loadObject(splitRoleKeyGo(folder))
	if err != nil || role == nil {
		return aiHTTPRequest{}, errors.New("角色不存在")
	}
	chat, err := svc.loadObject(splitChatKeyGo(folder, chatID))
	if err != nil || chat == nil {
		return aiHTTPRequest{}, errors.New("会话不存在")
	}

	providers, err := svc.loadProviders()
	if err != nil {
		return aiHTTPRequest{}, err
	}
	fallbackPid := ""
	if len(providers) > 0 {
		fallbackPid = strings.TrimSpace(asString(asMap(providers[0])["id"]))
	}
	modelRef := asMap(role["modelRef"])
	providerID := strings.TrimSpace(asString(modelRef["providerId"]))
	modelID := strings.TrimSpace(asString(modelRef["modelId"]))
	if providerID == "" {
		providerID = fallbackPid
	}
	if override := normalizeChatModelOverrideGo(chat); override != nil {
		if providerByID(providers, asString(override["providerId"])) != nil {
			providerID = strings.TrimSpace(asString(override["providerId"]))
			modelID = strings.TrimSpace(asString(override["modelId"]))
		}
	}

	provider := providerByID(providers, providerID)
	if provider == nil {
		return aiHTTPRequest{}, errors.New("供应商不存在")
	}
	baseURL := trimSlashGo(asString(provider["baseUrl"]))
	apiKey := strings.TrimSpace(asString(provider["apiKey"]))
	if !isHTTPBaseURLGo(baseURL) {
		return aiHTTPRequest{}, errors.New("Base URL 无效（需 http/https）")
	}
	if apiKey == "" {
		return aiHTTPRequest{}, errors.New("API Key 为空")
	}
	if modelID == "" {
		return aiHTTPRequest{}, errors.New("模型ID 为空")
	}

	history := buildHistory(chat, job)
	messages := make([]map[string]any, 0, len(history)+1)
	if sys := strings.TrimSpace(asString(role["systemPrompt"])); sys != "" {
		messages = append(messages, map[string]any{"role": "system", "content": sys})
	}
	for _, msg := range history {
		roleName := "user"
		if asString(msg["role"]) == "assistant" {
			roleName = "assistant"
		}
		text := asString(msg["content"])
		if roleName == "user" {
			text = buildUserTextForOpenAIGo(msg)
			paths := normImagePathsGo(msg["images"], 8)
			if len(paths) > 0 {
				parts := []any{map[string]any{"type": "text", "text": text}}
				for _, imagePath := range paths {
					dataURL, err := svc.imageReadDataURLByRel(imagePath)
					if err != nil {
						return aiHTTPRequest{}, fmt.Errorf("读取图片失败：%w", err)
					}
					if !strings.HasPrefix(dataURL, "data:image/") {
						return aiHTTPRequest{}, errors.New("读取图片失败：格式不支持")
					}
					parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURL}})
				}
				messages = append(messages, map[string]any{"role": "user", "content": parts})
				continue
			}
		}
		messages = append(messages, map[string]any{"role": roleName, "content": text})
	}

	stream := truthy(job["stream"])
	return buildChatCompletionsRequest(baseURL, apiKey, modelID, messages, clampTempGo(role["temperature"]), stream), nil
}

func (svc *service) buildOpenAIGroupChatReqFromStorage(job map[string]any) (aiHTTPRequest, error) {
	roleID := strings.TrimSpace(asString(job["roleId"]))
	groupID := strings.TrimSpace(asString(job["groupId"]))
	chatID := strings.TrimSpace(asString(job["chatId"]))
	if roleID == "" || groupID == "" || chatID == "" {
		return aiHTTPRequest{}, errors.New("job 缺少 groupId/roleId/chatId")
	}

	meta, err := svc.loadSplitMeta()
	if err != nil {
		return aiHTTPRequest{}, err
	}
	roleFolder := strings.TrimSpace(asString(asMap(meta["roleFolders"])[roleID]))
	groupFolder := strings.TrimSpace(asString(asMap(meta["groupFolders"])[groupID]))
	if roleFolder == "" {
		return aiHTTPRequest{}, errors.New("角色不存在")
	}
	if groupFolder == "" {
		return aiHTTPRequest{}, errors.New("群组不存在")
	}

	role, err := svc.loadObject(splitRoleKeyGo(roleFolder))
	if err != nil || role == nil {
		return aiHTTPRequest{}, errors.New("角色不存在")
	}
	group, err := svc.loadObject(splitGroupKeyGo(groupFolder))
	if err != nil || group == nil {
		return aiHTTPRequest{}, errors.New("群组不存在")
	}
	chat, err := svc.loadObject(splitGroupChatKeyGo(groupFolder, chatID))
	if err != nil || chat == nil {
		return aiHTTPRequest{}, errors.New("会话不存在")
	}

	providers, err := svc.loadProviders()
	if err != nil {
		return aiHTTPRequest{}, err
	}
	fallbackPid := ""
	if len(providers) > 0 {
		fallbackPid = strings.TrimSpace(asString(asMap(providers[0])["id"]))
	}
	modelRef := asMap(role["modelRef"])
	providerID := strings.TrimSpace(asString(modelRef["providerId"]))
	modelID := strings.TrimSpace(asString(modelRef["modelId"]))
	if providerID == "" {
		providerID = fallbackPid
	}
	if override := normalizeChatModelOverrideGo(chat); override != nil {
		if providerByID(providers, asString(override["providerId"])) != nil {
			providerID = strings.TrimSpace(asString(override["providerId"]))
			modelID = strings.TrimSpace(asString(override["modelId"]))
		}
	}

	provider := providerByID(providers, providerID)
	if provider == nil {
		return aiHTTPRequest{}, errors.New("供应商不存在")
	}
	baseURL := trimSlashGo(asString(provider["baseUrl"]))
	apiKey := strings.TrimSpace(asString(provider["apiKey"]))
	if !isHTTPBaseURLGo(baseURL) {
		return aiHTTPRequest{}, errors.New("Base URL 无效（需 http/https）")
	}
	if apiKey == "" {
		return aiHTTPRequest{}, errors.New("API Key 为空")
	}
	if modelID == "" {
		return aiHTTPRequest{}, errors.New("模型ID 为空")
	}

	roleNameByID := map[string]string{}
	memberRoleIDs := normalizeStringIDs(group["memberRoleIds"])
	ids := append(memberRoleIDs, roleID)
	seen := map[string]bool{}
	for _, rid := range ids {
		if seen[rid] {
			continue
		}
		seen[rid] = true
		folder := strings.TrimSpace(asString(asMap(meta["roleFolders"])[rid]))
		if folder == "" {
			continue
		}
		if rr, err := svc.loadObject(splitRoleKeyGo(folder)); err == nil && rr != nil {
			name := strings.TrimSpace(asString(rr["name"]))
			if name == "" {
				name = "AI"
			}
			roleNameByID[rid] = name
		}
	}
	if _, ok := roleNameByID[roleID]; !ok {
		name := strings.TrimSpace(asString(role["name"]))
		if name == "" {
			name = "AI"
		}
		roleNameByID[roleID] = name
	}
	speakerName := roleNameByID[roleID]
	if speakerName == "" {
		speakerName = "AI"
	}

	history := buildHistory(chat, job)
	messages := make([]map[string]any, 0, len(history)+4)
	if sys := strings.TrimSpace(asString(role["systemPrompt"])); sys != "" {
		messages = append(messages, map[string]any{"role": "system", "content": sys})
	}
	messages = append(messages, map[string]any{"role": "system", "content": "你只能以你自己/当前这个成员的身份发言，不得冒充或代替其他任何群成员或用户说话。"})
	if groupPrompt := strings.TrimSpace(asString(group["prompt"])); groupPrompt != "" {
		messages = append(messages, map[string]any{"role": "system", "content": "群聊设定：\n" + groupPrompt})
	}

	for _, msg := range history {
		if asString(msg["role"]) != "assistant" {
			baseText := buildUserTextForOpenAIGo(msg)
			wrappedText := strings.TrimRight(fmt.Sprintf("[%s的发言]: %s", groupSpeakerUserPrefix, baseText), " \t\r\n")
			paths := normImagePathsGo(msg["images"], 8)
			if len(paths) > 0 {
				parts := []any{map[string]any{"type": "text", "text": wrappedText}}
				for _, imagePath := range paths {
					dataURL, err := svc.imageReadDataURLByRel(imagePath)
					if err != nil {
						return aiHTTPRequest{}, fmt.Errorf("读取图片失败：%w", err)
					}
					parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURL}})
				}
				messages = append(messages, map[string]any{"role": "user", "content": parts})
				continue
			}
			messages = append(messages, map[string]any{"role": "user", "content": wrappedText})
			continue
		}
		rid0 := strings.TrimSpace(asString(msg["speakerRoleId"]))
		name := roleNameByID[rid0]
		if name == "" {
			name = speakerName
		}
		messages = append(messages, map[string]any{"role": "assistant", "content": strings.TrimRight(fmt.Sprintf("[%s的发言]: %s", name, asString(msg["content"])), " \t\r\n")})
	}
	messages = append(messages, map[string]any{"role": "user", "content": fmt.Sprintf("现在轮到你 %s 发言了。系统已经为大家添加 [xxx的发言]: 这样的标记头，以用于区分不同发言来自谁。大家不用自己再输出自己的发言标记头，也不需要讨论发言标记系统，正常聊天即可。", speakerName)})

	stream := truthy(job["stream"])
	return buildChatCompletionsRequest(baseURL, apiKey, modelID, messages, clampTempGo(role["temperature"]), stream), nil
}

func (svc *service) loadObject(key string) (map[string]any, error) {
	value, err := svc.storageGetByKey(key)
	if err != nil {
		return nil, err
	}
	obj, _ := value.(map[string]any)
	return obj, nil
}

func buildHistory(chat map[string]any, job map[string]any) []map[string]any {
	msgs0 := normalizeObjectList(chat["messages"])
	branchID := strings.TrimSpace(asString(job["branchId"]))
	var history []map[string]any
	if branchID != "" {
		wantBranchID := normalizeBranchID(branchID)
		_ = wantBranchID
		byID := map[string]map[string]any{}
		for _, msg := range msgs0 {
			id := strings.TrimSpace(asString(msg["id"]))
			if id != "" {
				byID[id] = msg
			}
		}
		assistantMid := strings.TrimSpace(asString(job["assistantMid"]))
		assistantMsg := byID[assistantMid]
		tailMid := ""
		if assistantMsg != nil {
			tailMid = strings.TrimSpace(asString(assistantMsg["parentMid"]))
		}
		if tailMid == "" {
			for i := len(msgs0) - 1; i >= 0; i-- {
				if asString(msgs0[i]["role"]) == "user" {
					tailMid = strings.TrimSpace(asString(msgs0[i]["id"]))
					break
				}
			}
		}
		seen := map[string]bool{}
		for tailMid != "" && !seen[tailMid] {
			seen[tailMid] = true
			msg := byID[tailMid]
			if msg == nil {
				break
			}
			if !(asString(msg["role"]) == "assistant" && truthy(msg["pending"])) {
				history = append(history, msg)
			}
			tailMid = strings.TrimSpace(asString(msg["parentMid"]))
		}
		for i, j := 0, len(history)-1; i < j; i, j = i+1, j-1 {
			history[i], history[j] = history[j], history[i]
		}
	} else {
		base := msgs0
		cutoffMid := strings.TrimSpace(asString(job["cutoffMid"]))
		if cutoffMid != "" {
			for i, msg := range msgs0 {
				if asString(msg["id"]) == cutoffMid {
					base = msgs0[:i]
					break
				}
			}
		}
		for _, msg := range base {
			if asString(msg["role"]) == "assistant" && truthy(msg["pending"]) {
				continue
			}
			history = append(history, msg)
		}
	}
	return limitHistoryGo(history, 40)
}

func buildChatCompletionsRequest(baseURL, apiKey, modelID string, messages []map[string]any, temperature float64, stream bool) aiHTTPRequest {
	body, _ := json.Marshal(map[string]any{"model": modelID, "messages": messages, "temperature": temperature, "stream": stream})
	timeoutMs := int64(120000)
	if stream {
		timeoutMs = 15 * 60 * 1000
	}
	return aiHTTPRequest{
		Method: "POST",
		URL:    trimSlashGo(baseURL) + "/chat/completions",
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Authorization": "Bearer " + apiKey,
		},
		Body:      string(body),
		TimeoutMs: timeoutMs,
	}
}

func buildUserTextForOpenAIGo(msg map[string]any) string {
	base := strings.TrimSpace(asString(msg["content"]))
	attachments := normalizeObjectList(msg["attachments"])
	if len(attachments) == 0 {
		return base
	}
	if len(attachments) == 1 {
		name := asString(attachments[0]["name"])
		if name != "" && base == "附件："+name {
			base = ""
		}
	}
	blocks := make([]string, 0, len(attachments))
	for _, att := range attachments {
		name := asString(att["name"])
		if strings.TrimSpace(name) == "" {
			name = "文件"
		}
		fullLen := clampInt64(asInt64(att["fullLen"], 0), 0, 10000000)
		sendLen := clampInt64(asInt64(att["sendLen"], 0), 0, fullLen)
		pct := clampInt64(asInt64(att["sendPct"], 100), 0, 100)
		lang := asString(att["lang"])
		if lang == "" {
			if asString(att["kind"]) == "md" {
				lang = "markdown"
			} else {
				lang = "text"
			}
		}
		raw := strings.TrimSpace(asString(att["text"]))
		if raw == "" {
			continue
		}
		snippet := strings.ReplaceAll(raw, "```", "``\u200b`")
		blocks = append(blocks, fmt.Sprintf("附件：%s（发送 %d%%：%d/%d 字符）\n```%s\n%s\n```", name, pct, sendLen, fullLen, lang, snippet))
		if len(blocks) >= 20 {
			break
		}
	}
	extra := strings.TrimSpace(strings.Join(blocks, "\n\n"))
	if extra == "" {
		return base
	}
	if base == "" {
		return extra
	}
	return strings.TrimSpace(base + "\n\n" + extra)
}

func normalizeChatModelOverrideGo(chat map[string]any) map[string]any {
	override := asMap(chat["modelOverride"])
	providerID := strings.TrimSpace(asString(override["providerId"]))
	modelID := strings.TrimSpace(asString(override["modelId"]))
	if providerID == "" || modelID == "" {
		return nil
	}
	return map[string]any{"providerId": providerID, "modelId": modelID}
}

func providerByID(providers []any, providerID string) map[string]any {
	pid := strings.TrimSpace(providerID)
	for _, item := range providers {
		provider := asMap(item)
		if strings.TrimSpace(asString(provider["id"])) == pid {
			return provider
		}
	}
	return nil
}

func normalizeObjectList(raw any) []map[string]any {
	list := asSlice(raw)
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		obj := asMap(item)
		if obj != nil {
			out = append(out, obj)
		}
	}
	return out
}

func limitHistoryGo(messages []map[string]any, maxTurns int) []map[string]any {
	items := make([]map[string]any, 0, len(messages))
	for _, msg := range messages {
		role := asString(msg["role"])
		if role == "user" || role == "assistant" {
			items = append(items, msg)
		}
	}
	if maxTurns <= 0 || len(items) <= maxTurns {
		return items
	}
	return items[len(items)-maxTurns:]
}

func normalizeStringIDs(raw any) []string {
	list := asSlice(raw)
	items := make([]string, 0, len(list))
	for _, item := range list {
		value := strings.TrimSpace(asString(item))
		if value != "" {
			items = append(items, value)
		}
	}
	sort.Strings(items)
	return items
}

func normImagePathsGo(raw any, maxCount int) []string {
	list := asSlice(raw)
	items := make([]string, 0, len(list))
	for _, item := range list {
		value := strings.TrimSpace(asString(item))
		if value == "" || len(value) > 4096 {
			continue
		}
		items = append(items, value)
		if len(items) >= maxCount {
			break
		}
	}
	return items
}

func normalizeBranchID(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return chatDefaultBranchID
	}
	if len(value) > 60 {
		value = strings.TrimSpace(value[:60])
	}
	b := strings.Builder{}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	value = b.String()
	if value == "" {
		return chatDefaultBranchID
	}
	return value
}

func trimSlashGo(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

func isHTTPBaseURLGo(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func clampTempGo(raw any) float64 {
	n := asFloat64(raw, 0.7)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0.7
	}
	if n < 0 {
		return 0
	}
	if n > 2 {
		return 2
	}
	return n
}

func asMap(raw any) map[string]any {
	value, _ := raw.(map[string]any)
	return value
}

func asSlice(raw any) []any {
	value, _ := raw.([]any)
	return value
}

func asFloat64(raw any, fallback float64) float64 {
	switch v := raw.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		f, err := v.Float64()
		if err == nil {
			return f
		}
	}
	return fallback
}

func clampInt64(value int64, minValue int64, maxValue int64) int64 {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}
