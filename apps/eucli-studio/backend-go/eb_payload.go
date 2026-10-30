package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// ebEnvelope 只声明业务端 HTTP 响应信封里的 data 字段。
// 用 RawMessage 承接意味着解码器只扫描一次、只保留 data 的字节区间，
// 不重建任何对象图：会话载荷在 studio 侧永远不进入 map[string]any。
type ebEnvelope struct {
	Data json.RawMessage `json:"data"`
}

// extractEnvelopeData 定位信封里的 data 字节区间。
// 业务端返回非对象载荷（数组 / 字符串 / 数字）时原样透传，
// 这与旧实现「没有 data 字段就用整个响应」的语义一致。
func extractEnvelopeData(payload []byte) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 {
		return json.RawMessage("{}"), nil
	}
	if trimmed[0] != '{' {
		return json.RawMessage(trimmed), nil
	}
	var envelope ebEnvelope
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return nil, err
	}
	if envelope.Data == nil {
		return json.RawMessage(trimmed), nil
	}
	return envelope.Data, nil
}

// decodeJSONObjectList 把字节载荷解码成对象列表；null / 空载荷视为空列表。
func decodeJSONObjectList(payload json.RawMessage) ([]map[string]any, error) {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return []map[string]any{}, nil
	}
	var items []map[string]any
	if err := json.Unmarshal(trimmed, &items); err != nil {
		return nil, err
	}
	if items == nil {
		return []map[string]any{}, nil
	}
	return items, nil
}

// decodeJSONValue 解码成具体类型：只用于小体量结构化响应（发布资料等）。
func decodeJSONValue[T any](payload json.RawMessage) (T, error) {
	var value T
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return value, nil
	}
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return value, err
	}
	return value, nil
}

// truncateText 把错误体收敛到固定上限，避免一次超大错误响应撑爆帧。
// 按 rune 边界截断，不产生非法 UTF-8。
func truncateText(payload []byte, limit int) string {
	text := strings.TrimSpace(string(payload))
	if limit <= 0 || len(text) <= limit {
		return text
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut] + "…（已截断）"
}
