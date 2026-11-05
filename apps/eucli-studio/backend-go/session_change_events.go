package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
)

// 会话变更广播的客户端契约。
//
// eucli-box 在 /ws/events 上同时推送运行事件与会话变更事件：
//   - 运行事件：{type, runId, payload, ...}，身份由 type/runId 表达；
//   - 会话变更：{targetKind, location, changeType, version, occurredAt}。
//
// 两类事件必须在这里分开：会话变更不是运行事件，转发时必须保留它自己的
// 事件名与完整载荷，前端才能用 version 判定事实新旧。

const (
	sessionChangeTargetSession = "session"
	sessionChangeTargetMessage = "message"

	sessionLocationRole      = "role"
	sessionLocationGroup     = "group"
	sessionLocationWorkspace = "workspace"

	sessionChangeMessageAdded          = "message_added"
	sessionChangeMessageDeleted        = "message_deleted"
	sessionChangeMessageSubtreeDeleted = "message_subtree_deleted"
	sessionChangeMessageEdited         = "message_edited"
	sessionChangeSessionPersisted      = "session_persisted"
)

type sessionChangeLocation struct {
	Kind        string `json:"kind"`
	RoleID      string `json:"roleId,omitempty"`
	GroupID     string `json:"groupId,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	SessionID   string `json:"sessionId"`
}

// sessionChangeEvent 是会话变更广播的固定五项契约。
type sessionChangeEvent struct {
	TargetKind string                `json:"targetKind"`
	Location   sessionChangeLocation `json:"location"`
	ChangeType string                `json:"changeType"`
	Version    uint64                `json:"version"`
	OccurredAt time.Time             `json:"occurredAt"`
}

func (location sessionChangeLocation) valid() bool {
	if strings.TrimSpace(location.SessionID) == "" {
		return false
	}
	switch location.Kind {
	case sessionLocationRole:
		return strings.TrimSpace(location.RoleID) != "" && location.GroupID == "" && location.WorkspaceID == ""
	case sessionLocationGroup:
		return strings.TrimSpace(location.GroupID) != "" && location.RoleID == "" && location.WorkspaceID == ""
	case sessionLocationWorkspace:
		return strings.TrimSpace(location.WorkspaceID) != "" && strings.TrimSpace(location.RoleID) != "" && location.GroupID == ""
	default:
		return false
	}
}

func (event sessionChangeEvent) valid() bool {
	switch event.TargetKind {
	case sessionChangeTargetSession, sessionChangeTargetMessage:
	default:
		return false
	}
	switch event.ChangeType {
	case sessionChangeMessageAdded, sessionChangeMessageDeleted, sessionChangeMessageSubtreeDeleted, sessionChangeMessageEdited:
		if event.TargetKind != sessionChangeTargetMessage {
			return false
		}
	case sessionChangeSessionPersisted:
		if event.TargetKind != sessionChangeTargetSession {
			return false
		}
	default:
		return false
	}
	if event.Version == 0 || event.OccurredAt.IsZero() {
		return false
	}
	return event.Location.valid()
}

// indexScope 把事件定位映射成会话索引 scope。
// 只有角色 / 群聊有 studio 侧索引；工作区会话不属于当前索引模型。
func (event sessionChangeEvent) indexScope() (sessionScope, bool) {
	switch event.Location.Kind {
	case sessionLocationRole:
		return roleScope(strings.TrimSpace(event.Location.RoleID)), true
	case sessionLocationGroup:
		return groupScope(strings.TrimSpace(event.Location.GroupID)), true
	default:
		return sessionScope{}, false
	}
}

// readSessionChangeFrame 判断一帧是否为会话变更事件，并解析契约。
//
// 返回值 isSession 只表示「帧的形态属于会话变更」：解析失败但形态匹配时
// 仍然返回 true，调用方必须丢弃它，绝不能把畸形会话变更当运行事件透传。
func readSessionChangeFrame(raw json.RawMessage) (event sessionChangeEvent, isSession bool) {
	if len(bytes.TrimSpace(raw)) == 0 || !bytes.Contains(raw, []byte(`"changeType"`)) {
		return sessionChangeEvent{}, false
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return sessionChangeEvent{}, false
	}
	if _, ok := fields["changeType"]; !ok {
		return sessionChangeEvent{}, false
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		return sessionChangeEvent{}, true
	}
	return event, true
}

// invalidateSessionIndexesAfterEventGap 在事件通道断开时清空索引快照：
// 断线期间的会话变更已经丢失，下一次版本核对必须从业务端重新读取事实。
func (s *service) invalidateSessionIndexesAfterEventGap() {
	if s == nil || s.projection == nil {
		return
	}
	s.projection.model.sessions.invalidateScopes()
}

// noteSessionChangeForSessionIndex 是「会话变更 → 会话索引失效」的唯一出口。
// 索引缓存必须跟随写入失效，否则版本核对会读到旧 summary，控制不了视图新旧。
func (s *service) noteSessionChangeForSessionIndex(event sessionChangeEvent) {
	if s == nil || s.projection == nil {
		return
	}
	scope, ok := event.indexScope()
	if !ok {
		return
	}
	s.projection.model.sessions.invalidate(scope)
}
