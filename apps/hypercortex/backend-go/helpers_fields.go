package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// requireScope 校验客户端作用域：只允许应用设置域或合法仓库 ID。
func requireScope(raw json.RawMessage) string {
	scope := strings.TrimSpace(stringField(raw, "scope"))
	if scope == "data" || isRepoID(scope) {
		return scope
	}
	panic(fmt.Errorf("非法 scope：%s", scope))
}

// repoScopeOrError 用于只允许仓库数据的操作（如回收站、仓库状态）。
func repoScopeOrError(scope string) error {
	if !isRepoID(scope) {
		return fmt.Errorf("该操作仅支持仓库数据：%s", scope)
	}
	return nil
}

func rawField(raw json.RawMessage, key string) json.RawMessage {
	payload := map[string]json.RawMessage{}
	_ = json.Unmarshal(raw, &payload)
	return payload[key]
}

func stringField(raw json.RawMessage, key string) string {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	return strings.TrimSpace(asString(payload[key]))
}

func optionalStringField(raw json.RawMessage, key string) string {
	return stringField(raw, key)
}

func numberField(raw json.RawMessage, key string) float64 {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	return asFloat(payload[key])
}

func boolField(raw json.RawMessage, key string) bool {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	value, _ := payload[key].(bool)
	return value
}

// checkVersionConflict 是写入侧统一的防覆盖保险丝：期望版本非零时必须与当前版本一致；
// 不一致说明读取后目标已被其他修改更新，拒绝写入并回报当前版本。
func checkVersionConflict(subject string, expectedVersion float64, currentVersion float64) error {
	if expectedVersion > 0 && currentVersion != expectedVersion {
		return coded(codeVersionConflict, "%s版本不匹配：期望版本 %.0f，当前版本 %.0f；%s已被其他修改更新，请重新读取后再写入", subject, expectedVersion, currentVersion, subject)
	}
	return nil
}

// rawStringField 原样提取字符串字段（不做修剪）：替换类操作的文本必须保持逐字一致。
func rawStringField(raw json.RawMessage, key string) string {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	return asString(payload[key])
}

func intField(raw json.RawMessage, key string) int {
	value := numberField(raw, key)
	if value <= 0 {
		return 0
	}
	return int(value)
}

// optionalPositiveIntField 读取可选正整数参数：缺省或空值返回 present=false；
// 显式提供时必须是不小于 1 的整数，否则快速失败。
func optionalPositiveIntField(raw json.RawMessage, key string) (int, bool, error) {
	payload := map[string]any{}
	_ = json.Unmarshal(raw, &payload)
	value, ok := payload[key]
	if !ok || value == nil {
		return 0, false, nil
	}
	number := asFloat(value)
	if number != math.Trunc(number) || number < 1 {
		return 0, false, fmt.Errorf("参数 %s 必须是大于零的整数", key)
	}
	return int(number), true, nil
}

func nonZeroFloat(value float64, fallback float64) float64 {
	if value > 0 {
		return value
	}
	return fallback
}

func nonZeroInt64(value int64, fallback int64) int64 {
	if value > 0 {
		return value
	}
	return fallback
}

func nonEmpty(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
