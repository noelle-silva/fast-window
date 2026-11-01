package main

import (
	"encoding/json"
	"strings"
)

// 会话索引缓存跟随运行生命周期失效。
//
// 索引缓存只在「删除会话 / 连接重建」时失效；而一次新会话的诞生与定稿
// 恰好发生在运行生命周期里。不在这条路径上失效，新会话就会一直缺席
// 侧边栏，直到下一次删除或重连——表现为「发完消息会话不见了」。
//
// 只认生命周期事件（开始 / 终态）：内容事件（正文增量、工具输出）每帧都来，
// 在这些帧上失效等于把读模型变成事件驱动的全量重拉，代价不可接受。

const (
	runEventTypeStarted   = "run_started"
	runEventTypeCompleted = "run_completed"
	runEventTypeFailed    = "run_failed"
	runEventTypeCancelled = "run_cancelled"
	runEventTypeCanceled  = "run_canceled"
)

type runIndexEnvelope struct {
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

// runSessionIndexScope 从运行事件解析出需要失效的会话索引 scope。
// 群聊优先（群会话归属群 scope），否则按角色；两者都没有则不是索引信号。
func runSessionIndexScope(raw json.RawMessage) (sessionScope, bool) {
	var envelope runIndexEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return sessionScope{}, false
	}
	if !isSessionIndexRunEvent(envelope.Type) {
		return sessionScope{}, false
	}
	if groupID := strings.TrimSpace(stringField(envelope.Payload, "groupId")); groupID != "" {
		return groupScope(groupID), true
	}
	if roleID := strings.TrimSpace(stringField(envelope.Payload, "roleId")); roleID != "" {
		return roleScope(roleID), true
	}
	return sessionScope{}, false
}

func isSessionIndexRunEvent(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case runEventTypeStarted, runEventTypeCompleted, runEventTypeFailed, runEventTypeCancelled, runEventTypeCanceled:
		return true
	default:
		return false
	}
}

// noteRunLifecycleForSessionIndex 是「运行事件 → 会话索引失效」的唯一出口。
// 帧仍是字节透传：这里只读取判断 scope 所需的最小字段，不改写事件载荷。
func (s *service) noteRunLifecycleForSessionIndex(raw json.RawMessage) {
	if s == nil || s.projection == nil {
		return
	}
	scope, ok := runSessionIndexScope(raw)
	if !ok {
		return
	}
	s.projection.model.sessions.invalidate(scope)
}
