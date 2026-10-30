package main

import (
	"strconv"
	"strings"
)

// 会话 wire 契约的两个正交维度：
//
//	profile = view | edit | full   决定「发哪些字段」
//	window  = head + before + 限额 决定「发多少条消息」
//
// 两者都只是「同一份权威数据的投影参数」，不改变事实，只改变形状。
// cursor 的语义与编码归业务端所有：studio 原样透传，绝不另造第二套游标方言。

const (
	sessionProfileView = "view"
	sessionProfileEdit = "edit"
	sessionProfileFull = "full"

	sessionWindowDefaultLimit    = 24
	sessionWindowMaxLimit        = 200
	sessionWindowDefaultMaxBytes = 512 * 1024
	sessionWindowMinMaxBytes     = 64 * 1024
	sessionWindowMaxMaxBytes     = 8 * 1024 * 1024
)

// sessionWireProfile 归一化 profile：非法值快速失败，绝不静默回落。
func sessionWireProfile(raw string) (string, error) {
	switch strings.TrimSpace(raw) {
	case "":
		return sessionProfileView, nil
	case sessionProfileView, sessionProfileEdit, sessionProfileFull:
		return strings.TrimSpace(raw), nil
	default:
		return "", newError("BAD_REQUEST", "会话 profile 无效："+strings.TrimSpace(raw))
	}
}

// sessionWindowParams 是一次窗口请求的规范化参数。
type sessionWindowParams struct {
	Head     string
	Before   string
	Limit    int
	MaxBytes int
	Profile  string
	Cursor   string
}

// normalizeSessionWindowParams 只做区间收敛与缺省填充，不解释 cursor 内容。
func normalizeSessionWindowParams(raw sessionWindowParams) (sessionWindowParams, error) {
	next := sessionWindowParams{
		Head:    strings.TrimSpace(raw.Head),
		Before:  strings.TrimSpace(raw.Before),
		Profile: raw.Profile,
		Cursor:  strings.TrimSpace(raw.Cursor),
	}
	limit := raw.Limit
	if limit <= 0 {
		limit = sessionWindowDefaultLimit
	}
	if limit > sessionWindowMaxLimit {
		limit = sessionWindowMaxLimit
	}
	next.Limit = limit

	maxBytes := raw.MaxBytes
	if maxBytes == 0 {
		maxBytes = sessionWindowDefaultMaxBytes
	}
	if maxBytes < sessionWindowMinMaxBytes || maxBytes > sessionWindowMaxMaxBytes {
		return sessionWindowParams{}, newError("BAD_REQUEST", "会话窗口 maxBytes 超出允许范围")
	}
	next.MaxBytes = maxBytes
	return next, nil
}

// query 组装转发给业务端的查询参数（扁平字符串值）。
// cursor 与显式锚点同时出现时全部保留：业务端按自己的优先级解释，
// studio 不替它做取舍。
func (p sessionWindowParams) query() map[string]any {
	query := map[string]any{
		"limit":    strconv.Itoa(p.Limit),
		"maxBytes": strconv.Itoa(p.MaxBytes),
		"profile":  p.Profile,
	}
	if p.Cursor != "" {
		query["cursor"] = p.Cursor
	}
	if p.Head != "" {
		query["head"] = p.Head
	}
	if p.Before != "" {
		query["before"] = p.Before
	}
	return query
}

// sessionRoutePath 是 scope → 业务端会话路由的唯一映射点。
// 会话正文与窗口共用它，避免两条路径各拼一遍。
func sessionRoutePath(scope sessionScope, chatID string) (string, error) {
	if !scope.valid() {
		return "", newError("BAD_REQUEST", "会话 scope 无效")
	}
	if strings.TrimSpace(chatID) == "" {
		return "", newError("BAD_REQUEST", "会话 id 不能为空")
	}
	if scope.Kind == sessionScopeKindGroup {
		return "/api/groups/" + scope.TargetID + "/sessions/" + chatID, nil
	}
	return "/api/roles/" + scope.TargetID + "/sessions/" + chatID, nil
}
