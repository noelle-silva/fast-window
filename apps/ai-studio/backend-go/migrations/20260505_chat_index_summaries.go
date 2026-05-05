package migrations

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

const chatIndexSummariesID = "2026-05-05-chat-index-summaries"

func ChatIndexSummaries() Migration {
	return Migration{
		ID:          chatIndexSummariesID,
		FromVersion: 6,
		ToVersion:   7,
		Description: "为聊天索引补充轻量摘要，支持前端按需加载聊天正文",
		Recovery: recoverySpec([]string{
			"chats/*/index.json",
			"groups/*/chats/index.json",
		}, "updates role and group chat index files with chatMetas summaries"),
		Apply:       applyChatIndexSummaries,
	}
}

func applyChatIndexSummaries(ctx Context) error {
	chatsIndex, err := readObjectByKeyForSummary(ctx.DataDir, splitChatsIndexKey())
	if err != nil {
		return err
	}
	roleOrder := normalizeStringList(chatsIndex["roleOrder"])
	roleFolders := normalizeStringMap(chatsIndex["roleFolders"])
	for _, roleID := range roleOrder {
		folder := strings.TrimSpace(roleFolders[roleID])
		if folder == "" {
			continue
		}
		key := splitRoleChatIndexKey(folder)
		idx, err := readObjectByKeyForSummary(ctx.DataDir, key)
		if err != nil {
			return err
		}
		if idx == nil {
			continue
		}
		metas, err := buildChatMetasForIndex(ctx.DataDir, idx, folder, false)
		if err != nil {
			return err
		}
		idx["chatMetas"] = metas
		idx["chatIds"] = chatMetaIDsForMigration(metas)
		idx["chatUpdatedAt"] = chatMetaUpdatedAtForMigration(metas)
		idx["updatedAt"] = nowMsForMigration()
		if err := writeJSONReplace(ctx.DataDir, key, idx); err != nil {
			return err
		}
	}

	groupsIndex, err := readObjectByKeyForSummary(ctx.DataDir, splitGroupsIndexKey())
	if err != nil {
		return err
	}
	groupOrder := normalizeStringList(groupsIndex["groupOrder"])
	groupFolders := normalizeStringMap(groupsIndex["groupFolders"])
	for _, groupID := range groupOrder {
		folder := strings.TrimSpace(groupFolders[groupID])
		if folder == "" {
			continue
		}
		key := splitGroupChatIndexKey(folder)
		idx, err := readObjectByKeyForSummary(ctx.DataDir, key)
		if err != nil {
			return err
		}
		if idx == nil {
			continue
		}
		metas, err := buildChatMetasForIndex(ctx.DataDir, idx, folder, true)
		if err != nil {
			return err
		}
		idx["chatMetas"] = metas
		idx["chatIds"] = chatMetaIDsForMigration(metas)
		idx["chatUpdatedAt"] = chatMetaUpdatedAtForMigration(metas)
		idx["updatedAt"] = nowMsForMigration()
		if err := writeJSONReplace(ctx.DataDir, key, idx); err != nil {
			return err
		}
	}
	return nil
}

func buildChatMetasForIndex(dataDir string, idx map[string]any, folder string, group bool) ([]any, error) {
	chatIDs := normalizeStringList(idx["chatIds"])
	updatedAt := asMapOrEmpty(idx["chatUpdatedAt"])
	metas := make([]any, 0, len(chatIDs))
	for _, chatID := range chatIDs {
		key := ""
		fallbackTitle := "新聊天"
		if group {
			key = splitGroupChatKeyForMigration(folder, chatID)
			fallbackTitle = "群聊"
		} else {
			key = "chats/" + strings.TrimSpace(folder) + "/" + strings.TrimSpace(chatID) + "/chat"
		}
		chat, err := readObjectByKeyForSummary(dataDir, key)
		if err != nil {
			return nil, err
		}
		if chat == nil {
			metas = append(metas, map[string]any{
				"id":                 chatID,
				"title":              fallbackTitle,
				"createdAt":          asInt64ForMigration(updatedAt[chatID], nowMsForMigration()),
				"updatedAt":          asInt64ForMigration(updatedAt[chatID], nowMsForMigration()),
				"lastMessagePreview": "",
				"messageCount":       0,
				"hasPending":         false,
			})
			continue
		}
		metas = append(metas, chatMetaForMigration(chat, chatID, fallbackTitle, asInt64ForMigration(updatedAt[chatID], 0)))
	}
	return metas, nil
}

func chatMetaForMigration(chat map[string]any, fallbackID string, fallbackTitle string, fallbackUpdatedAt int64) map[string]any {
	chatID := strings.TrimSpace(asString(chat["id"]))
	if chatID == "" {
		chatID = fallbackID
	}
	createdAt := asInt64ForMigration(chat["createdAt"], fallbackUpdatedAt)
	if createdAt <= 0 {
		createdAt = nowMsForMigration()
	}
	updatedAt := asInt64ForMigration(chat["updatedAt"], fallbackUpdatedAt)
	if updatedAt <= 0 {
		updatedAt = createdAt
	}
	messages := normalizeObjectList(chat["messages"])
	preview := ""
	hasPending := false
	if len(messages) > 0 {
		preview = messagePreviewForMigration(messages[len(messages)-1])
	}
	for _, msg := range messages {
		if strings.TrimSpace(asString(msg["role"])) == "assistant" {
			if v, ok := msg["pending"].(bool); ok && v {
				hasPending = true
				break
			}
		}
	}
	title := strings.Join(strings.Fields(asString(chat["title"])), " ")
	if title == "" {
		title = fallbackTitle
	}
	return map[string]any{
		"id":                 chatID,
		"title":              title,
		"createdAt":          createdAt,
		"updatedAt":          updatedAt,
		"lastMessagePreview": preview,
		"messageCount":       len(messages),
		"hasPending":         hasPending,
	}
}

func messagePreviewForMigration(msg map[string]any) string {
	text := strings.Join(strings.Fields(asString(msg["content"])), " ")
	if text != "" {
		return trimRunesForMigration(text, 80)
	}
	if len(asSlice(msg["images"])) > 0 {
		return "图片"
	}
	if len(asSlice(msg["attachments"])) > 0 {
		return "文件"
	}
	return ""
}

func trimRunesForMigration(value string, max int) string {
	items := []rune(strings.TrimSpace(value))
	if len(items) <= max {
		return string(items)
	}
	return strings.TrimSpace(string(items[:max])) + "..."
}

func chatMetaIDsForMigration(metas []any) []string {
	out := make([]string, 0, len(metas))
	for _, item := range metas {
		id := strings.TrimSpace(asString(asMap(item)["id"]))
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}

func chatMetaUpdatedAtForMigration(metas []any) map[string]any {
	out := map[string]any{}
	for _, item := range metas {
		meta := asMap(item)
		id := strings.TrimSpace(asString(meta["id"]))
		if id != "" {
			out[id] = asInt64ForMigration(meta["updatedAt"], 0)
		}
	}
	return out
}

func readObjectByKeyForSummary(dataDir string, key string) (map[string]any, error) {
	path, err := storagePathForKey(dataDir, key)
	if err != nil {
		return nil, err
	}
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(payload)) == "" {
		return nil, nil
	}
	var value map[string]any
	if err := json.Unmarshal(payload, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func writeJSONReplace(dataDir string, key string, value any) error {
	path, err := storagePathForKey(dataDir, key)
	if err != nil {
		return err
	}
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return atomicWriteFile(path, payload, 0o644)
}

func asInt64ForMigration(raw any, fallback int64) int64 {
	switch v := raw.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return n
		}
	}
	return fallback
}
