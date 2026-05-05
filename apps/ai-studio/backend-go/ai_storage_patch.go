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
		return svc.touchChatUpdatedAt(meta, kind, roleID, groupID, chatID, asInt64(chat["updatedAt"], nowMs()))
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
