package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func assistModelCoordinate(kind string, providerID string, groupID string, modelID string) map[string]any {
	if strings.TrimSpace(kind) == "model_group" || strings.TrimSpace(groupID) != "" {
		return map[string]any{"kind": "model_group", "groupId": strings.TrimSpace(groupID), "modelId": strings.TrimSpace(modelID)}
	}
	return map[string]any{"kind": "provider", "providerId": strings.TrimSpace(providerID), "modelId": strings.TrimSpace(modelID)}
}

var dedicatedProjectionSettingKeys = map[string]struct{}{
	"stickers": {},
}

var derivedProjectionSettingKeys = map[string]struct{}{
	"providers": {},
}

var assistProjectionSettingKeys = map[string]struct{}{
	"stickerNaming":      {},
	"mermaidFix":         {},
	"chatTitleNaming":    {},
	"contextCompression": {},
}

func mergeProjectionSettingsForMetaSave(existing map[string]any, incoming map[string]any) map[string]any {
	settings := stripAssistSettings(copyObjectMap(incoming))
	for key := range derivedProjectionSettingKeys {
		delete(settings, key)
	}
	for key := range dedicatedProjectionSettingKeys {
		delete(settings, key)
	}

	existing = objectMap(existing)
	for key := range dedicatedProjectionSettingKeys {
		if value, ok := existing[key]; ok {
			settings[key] = value
		}
	}
	return settings
}

func stripAssistSettings(settings map[string]any) map[string]any {
	settings = copyObjectMap(settings)
	services, ok := settings["aiServices"].(map[string]any)
	if !ok || len(services) == 0 {
		return settings
	}
	services = copyObjectMap(services)
	for key := range assistProjectionSettingKeys {
		delete(services, key)
	}
	settings["aiServices"] = services
	return settings
}

func objectMap(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func copyObjectMap(value any) map[string]any {
	src := objectMap(value)
	out := make(map[string]any, len(src))
	for key, item := range src {
		out[key] = item
	}
	return out
}

func anyList(items []map[string]any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func objectList(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]map[string]any); ok {
			return typed
		}
		return nil
	}
	out := []map[string]any{}
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return append([]string(nil), typed...)
		}
		return []string{}
	}
	out := []string{}
	seen := map[string]struct{}{}
	for _, item := range items {
		id := strings.TrimSpace(fmt.Sprint(item))
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func mapKeys[T any](value map[string]T) []string {
	out := make([]string, 0, len(value))
	for key := range value {
		out = append(out, key)
	}
	return out
}

func orderedIDs(preferred []string, actual []string) []string {
	actualSet := map[string]struct{}{}
	for _, id := range actual {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		actualSet[id] = struct{}{}
	}
	out := []string{}
	seen := map[string]struct{}{}
	for _, id := range preferred {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := actualSet[id]; !ok {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, id := range actual {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func stringField(m map[string]any, key string) string {
	if m == nil || m[key] == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(m[key]))
}
func numberField(m map[string]any, key string, fallback float64) float64 {
	if n, ok := m[key].(float64); ok {
		return n
	}
	return fallback
}
func intField(m map[string]any, key string, fallback int) int {
	switch value := m[key].(type) {
	case float64:
		return int(value)
	case int64:
		return int(value)
	case int:
		return value
	default:
		return fallback
	}
}
func boolField(m map[string]any, key string, fallback bool) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return fallback
}
func normalizeReasoningEffort(value string) string {
	switch strings.TrimSpace(value) {
	case "very_low", "low", "medium", "high", "very_high":
		return strings.TrimSpace(value)
	default:
		return ""
	}
}
func fallback(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
func nowMillis() int64 { return time.Now().UnixMilli() }
func stableUpdatedAt(values ...int64) int64 {
	out := int64(0)
	for _, value := range values {
		if value > out {
			out = value
		}
	}
	if out <= 0 {
		return 1
	}
	return out
}
func millisFromAny(value any) int64 {
	if s, ok := value.(string); ok {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UnixMilli()
		}
	}
	if n, ok := value.(float64); ok {
		return int64(n)
	}
	if n, ok := value.(int64); ok {
		return n
	}
	if n, ok := value.(int); ok {
		return int64(n)
	}
	return nowMillis()
}
func millisFromAnyOrZero(value any) int64 {
	if s, ok := value.(string); ok {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UnixMilli()
		}
	}
	if n, ok := value.(float64); ok {
		return int64(n)
	}
	if n, ok := value.(int64); ok {
		return n
	}
	if n, ok := value.(int); ok {
		return int64(n)
	}
	return 0
}
func timeFromMillis(value any) string {
	ms := millisFromAny(value)
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}
func mustJSON(value any) json.RawMessage { payload, _ := json.Marshal(value); return payload }
func folderFor(existing map[string]string, id string, name string, fallbackName string) string {
	if existing[id] != "" {
		return existing[id]
	}
	return safeFolderName(fallback(name, fallbackName))
}
func safeFolderName(value string) string {
	return strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_").Replace(value)
}
func promptText(prompts []map[string]any) string {
	for _, prompt := range prompts {
		if stringField(prompt, "role") == "system" {
			return stringField(prompt, "content")
		}
	}
	return ""
}

func messageRole(message map[string]any) string {
	switch messageStorageType(message) {
	case "system_control":
		return "system"
	case "assistant", "tool", "tool_request", "tool_confirmation", "async_tool_result":
		return "assistant"
	}
	return "user"
}

func messageStorageType(message map[string]any) string {
	messageType := stringField(message, "type")
	if messageType == "" {
		messageType = stringField(message, "role")
	}
	switch messageType {
	case "assistant", "tool", "tool_request", "tool_confirmation", "failure", "system_control", "async_tool_result":
		return messageType
	default:
		return "user"
	}
}

func isNotFoundError(err error) bool { return err != nil && strings.Contains(err.Error(), "不存在") }
