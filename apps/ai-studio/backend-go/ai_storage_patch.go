package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func (svc *service) patchAssistantMessageFinal(target aiRunTarget, status string, finalText string) error {
	meta, err := svc.loadSplitMeta()
	if err != nil {
		return err
	}
	kind := "role"
	if target.Kind == "group" {
		kind = "group"
	}
	roleID := strings.TrimSpace(target.RoleID)
	groupID := strings.TrimSpace(target.GroupID)
	chatID := strings.TrimSpace(target.ChatID)
	assistantMid := strings.TrimSpace(target.AssistantMid)
	if roleID == "" || chatID == "" || assistantMid == "" {
		return errors.New("patch final: target 参数不完整")
	}
	if kind == "group" && groupID == "" {
		return errors.New("patch final: groupId is required")
	}

	folder := ""
	key := ""
	if kind == "group" {
		folder = strings.TrimSpace(asString(asMap(meta["groupFolders"])[groupID]))
		key = splitGroupChatKeyGo(folder, chatID)
	} else {
		folder = strings.TrimSpace(asString(asMap(meta["roleFolders"])[roleID]))
		key = splitChatKeyGo(folder, chatID)
	}
	if folder == "" {
		return errors.New("patch final: chat folder not found")
	}

	chat, err := svc.loadObject(key)
	if err != nil {
		return err
	}
	if chat == nil {
		return errors.New("patch final: chat not found")
	}
	messages := normalizeObjectList(chat["messages"])
	for _, msg := range messages {
		if strings.TrimSpace(asString(msg["id"])) != assistantMid {
			continue
		}
		msg["content"] = finalText
		msg["pending"] = false
		msg["streaming"] = false
		if status != "succeeded" {
			msg["error"] = status
		}
		chat["updatedAt"] = nowMs()
		chat["messages"] = objectListAsAny(messages)
		if err := svc.storageSetByKey(key, chat); err != nil {
			return err
		}
		return svc.touchChatIndexMeta(meta, kind, roleID, groupID, chatID, chat)
	}
	return fmt.Errorf("patch final: assistant message not found: %s", assistantMid)
}

func (svc *service) touchChatUpdatedAt(meta map[string]any, kind string, roleID string, groupID string, chatID string, updatedAt int64) error {
	if meta == nil {
		return errors.New("meta is nil")
	}
	if updatedAt <= 0 {
		updatedAt = nowMs()
	}
	if kind == "group" {
		folder := strings.TrimSpace(asString(asMap(meta["groupFolders"])[groupID]))
		if folder == "" {
			return nil
		}
		idx, err := svc.loadObject(splitGroupChatIndexKeyGo(folder))
		if err != nil {
			return err
		}
		if idx == nil {
			return nil
		}
		updated := asMap(idx["chatUpdatedAt"])
		if updated == nil {
			updated = map[string]any{}
			idx["chatUpdatedAt"] = updated
		}
		updated[chatID] = updatedAt
		idx["updatedAt"] = nowMs()
		if err := svc.storageSetByKey(splitGroupChatIndexKeyGo(folder), idx); err != nil {
			return err
		}
	} else {
		folder := strings.TrimSpace(asString(asMap(meta["roleFolders"])[roleID]))
		if folder == "" {
			return nil
		}
		idx, err := svc.loadObject(splitRoleChatIndexKeyGo(folder))
		if err != nil {
			return err
		}
		if idx == nil {
			return nil
		}
		updated := asMap(idx["chatUpdatedAt"])
		if updated == nil {
			updated = map[string]any{}
			idx["chatUpdatedAt"] = updated
		}
		updated[chatID] = updatedAt
		idx["updatedAt"] = nowMs()
		if err := svc.storageSetByKey(splitRoleChatIndexKeyGo(folder), idx); err != nil {
			return err
		}
	}
	noticeKind := "role"
	targetID := roleID
	if kind == "group" {
		noticeKind = "group"
		targetID = groupID
	}
	notice := map[string]any{
		"id":         fmt.Sprintf("n_%d", nowMs()),
		"targetKind": noticeKind,
		"targetId":   targetID,
		"chatId":     chatID,
		"updatedAt":  updatedAt,
		"at":         nowMs(),
	}
	_ = svc.storageSetByKey(uiChatUpdatedNoticeStorageKey(), notice)
	return nil
}

func (svc *service) touchChatIndexMeta(meta map[string]any, kind string, roleID string, groupID string, chatID string, chat map[string]any) error {
	updatedAt := asInt64(chat["updatedAt"], nowMs())
	if err := svc.touchChatUpdatedAt(meta, kind, roleID, groupID, chatID, updatedAt); err != nil {
		return err
	}
	folder := ""
	indexKey := ""
	fallbackTitle := "新聊天"
	if kind == "group" {
		folder = strings.TrimSpace(asString(asMap(meta["groupFolders"])[groupID]))
		indexKey = splitGroupChatIndexKeyGo(folder)
		fallbackTitle = "群聊"
	} else {
		folder = strings.TrimSpace(asString(asMap(meta["roleFolders"])[roleID]))
		indexKey = splitRoleChatIndexKeyGo(folder)
	}
	if folder == "" {
		return nil
	}
	idx, err := svc.loadObject(indexKey)
	if err != nil || idx == nil {
		return err
	}
	metas := upsertChatMetaGo(chatMetasFromIndexGo(idx), chatMetaFromChatGo(chat, chatID, fallbackTitle))
	idx["chatMetas"] = metas
	idx["chatIds"] = chatMetaIDsGo(metas)
	idx["chatUpdatedAt"] = chatMetaUpdatedAtGo(metas)
	idx["updatedAt"] = nowMs()
	return svc.storageSetByKey(indexKey, idx)
}

func chatMetaFromChatGo(chat map[string]any, fallbackID string, fallbackTitle string) map[string]any {
	chatID := strings.TrimSpace(asString(chat["id"]))
	if chatID == "" {
		chatID = fallbackID
	}
	createdAt := asInt64(chat["createdAt"], nowMs())
	updatedAt := asInt64(chat["updatedAt"], createdAt)
	messages := normalizeObjectList(chat["messages"])
	preview := ""
	if len(messages) > 0 {
		preview = messagePreviewGo(messages[len(messages)-1])
	}
	hasPending := false
	for _, msg := range messages {
		if strings.TrimSpace(asString(msg["role"])) == "assistant" && truthy(msg["pending"]) {
			hasPending = true
			break
		}
	}
	title := strings.Join(strings.Fields(asString(chat["title"])), " ")
	if title == "" {
		title = fallbackTitle
	}
	return map[string]any{"id": chatID, "title": title, "createdAt": createdAt, "updatedAt": updatedAt, "lastMessagePreview": preview, "messageCount": len(messages), "hasPending": hasPending}
}

func messagePreviewGo(msg map[string]any) string {
	text := strings.Join(strings.Fields(asString(msg["content"])), " ")
	if text != "" {
		items := []rune(text)
		if len(items) > 80 {
			return strings.TrimSpace(string(items[:80])) + "..."
		}
		return text
	}
	if len(asSlice(msg["images"])) > 0 {
		return "图片"
	}
	if len(asSlice(msg["attachments"])) > 0 {
		return "文件"
	}
	return ""
}

func chatMetasFromIndexGo(idx map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, item := range asSlice(idx["chatMetas"]) {
		meta := asMap(item)
		if strings.TrimSpace(asString(meta["id"])) != "" {
			out = append(out, meta)
		}
	}
	if len(out) > 0 {
		return out
	}
	updated := asMap(idx["chatUpdatedAt"])
	for _, id := range normalizeStringIDsKeepOrder(idx["chatIds"]) {
		out = append(out, map[string]any{"id": id, "title": "", "createdAt": asInt64(updated[id], 0), "updatedAt": asInt64(updated[id], 0), "lastMessagePreview": "", "messageCount": 0, "hasPending": false})
	}
	return out
}

func upsertChatMetaGo(items []map[string]any, meta map[string]any) []any {
	out := make([]any, 0, len(items)+1)
	wantedID := strings.TrimSpace(asString(meta["id"]))
	updated := false
	for _, item := range items {
		if strings.TrimSpace(asString(item["id"])) == wantedID {
			out = append(out, meta)
			updated = true
		} else {
			out = append(out, item)
		}
	}
	if !updated && wantedID != "" {
		out = append([]any{meta}, out...)
	}
	return out
}

func chatMetaIDsGo(items []any) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		id := strings.TrimSpace(asString(asMap(item)["id"]))
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}

func chatMetaUpdatedAtGo(items []any) map[string]any {
	out := map[string]any{}
	for _, item := range items {
		meta := asMap(item)
		id := strings.TrimSpace(asString(meta["id"]))
		if id != "" {
			out[id] = asInt64(meta["updatedAt"], nowMs())
		}
	}
	return out
}

func objectListAsAny(items []map[string]any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func splitRoleKeyGo(folder string) string {
	return "roles/" + strings.TrimSpace(folder) + "/role"
}

func splitChatKeyGo(folder string, chatID string) string {
	return "chats/" + strings.TrimSpace(folder) + "/" + strings.TrimSpace(chatID) + "/chat"
}

func splitChatLegacyKeyGo(folder string, chatID string) string {
	return "chats/" + strings.TrimSpace(folder) + "/" + strings.TrimSpace(chatID)
}

func splitGroupKeyGo(folder string) string {
	return "groups/" + strings.TrimSpace(folder) + "/group"
}

func splitGroupChatKeyGo(folder string, chatID string) string {
	return "groups/" + strings.TrimSpace(folder) + "/chats/" + strings.TrimSpace(chatID)
}

func debugJSON(value any) string {
	payload, _ := json.Marshal(value)
	return string(payload)
}
