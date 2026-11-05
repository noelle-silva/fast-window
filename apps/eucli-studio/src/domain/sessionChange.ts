// 会话变更广播的客户端契约。
//
// 广播事实由业务端写出，五项字段是固定契约：
//   targetKind / location / changeType / version / occurredAt。
//
// version 是「会话事实版本号」：每次会话写入严格递增。
// 客户端只比较版本，不用时间推断新旧——时间只能辅助排序，不能证明事实更新。

import { workspaceRoleTargetId } from './workspaceRoleTarget'

export type SessionChangeTargetKind = 'session' | 'message'
export type SessionChangeLocationKind = 'role' | 'group' | 'workspace'

export type SessionChangeType =
  | 'message_added'
  | 'message_deleted'
  | 'message_subtree_deleted'
  | 'message_edited'
  | 'session_persisted'

export type SessionChangeLocation = {
  kind: SessionChangeLocationKind
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
}

export type SessionChange = {
  targetKind: SessionChangeTargetKind
  location: SessionChangeLocation
  changeType: SessionChangeType
  version: number
  occurredAt: number
}

// 三种会话目标都必须能落到客户端视窗：
// 角色 / 群聊以 targetId 寻址，工作区以 workspaceId + roleId 的组合寻址。
export type SessionChangeViewTarget =
  | {
      kind: 'role' | 'group'
      targetId: string
      chatId: string
    }
  | {
      kind: 'workspace'
      targetId: string
      workspaceId: string
      roleId: string
      chatId: string
    }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function positiveVersion(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function validTargetKind(value: string): value is SessionChangeTargetKind {
  return value === 'session' || value === 'message'
}

const MESSAGE_CHANGE_TYPES = new Set<SessionChangeType>([
  'message_added',
  'message_deleted',
  'message_subtree_deleted',
  'message_edited',
])

function validChangeType(value: string): value is SessionChangeType {
  return value === 'session_persisted' || MESSAGE_CHANGE_TYPES.has(value as SessionChangeType)
}

function normalizeLocation(raw: unknown): SessionChangeLocation | null {
  const source = objectValue(raw)
  const kind = text(source.kind)
  const location: SessionChangeLocation = {
    kind: kind === 'role' || kind === 'group' || kind === 'workspace' ? kind : 'role',
    roleId: text(source.roleId),
    groupId: text(source.groupId),
    workspaceId: text(source.workspaceId),
    sessionId: text(source.sessionId),
  }
  if (!location.sessionId) return null
  if (kind === 'role') {
    return location.roleId && !location.groupId && !location.workspaceId ? location : null
  }
  if (kind === 'group') {
    return location.groupId && !location.roleId && !location.workspaceId ? location : null
  }
  if (kind === 'workspace') {
    return location.workspaceId && location.roleId && !location.groupId ? location : null
  }
  return null
}

function occurredAtMillis(value: unknown): number {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return number
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

// normalizeSessionChange 只接受完整且自洽的事件；畸形事件直接丢弃，
// 绝不把它降级成「没有版本的事实」继续参与视图更新。
export function normalizeSessionChange(raw: unknown): SessionChange | null {
  const source = objectValue(raw)
  const targetKind = text(source.targetKind)
  const changeType = text(source.changeType)
  const version = positiveVersion(source.version)
  const occurredAt = occurredAtMillis(source.occurredAt)
  if (!validTargetKind(targetKind) || !validChangeType(changeType) || !version || !occurredAt) return null
  const wantsMessage = MESSAGE_CHANGE_TYPES.has(changeType)
  if ((targetKind === 'message') !== wantsMessage) return null
  const location = normalizeLocation(source.location)
  if (!location) return null
  return { targetKind, location, changeType, version, occurredAt }
}

// sessionChangeViewTarget 把事件定位映射成客户端视窗地址。
// 工作区会话与角色 / 群聊共享同一条事实路径，只是目标身份由 workspaceId + roleId 组成。
export function sessionChangeViewTarget(change: SessionChange): SessionChangeViewTarget | null {
  const { location } = change
  if (location.kind === 'role') {
    return { kind: 'role', targetId: location.roleId, chatId: location.sessionId }
  }
  if (location.kind === 'group') {
    return { kind: 'group', targetId: location.groupId, chatId: location.sessionId }
  }
  if (location.kind === 'workspace') {
    const targetId = workspaceRoleTargetId(location.workspaceId, location.roleId)
    if (!targetId) return null
    return {
      kind: 'workspace',
      targetId,
      workspaceId: location.workspaceId,
      roleId: location.roleId,
      chatId: location.sessionId,
    }
  }
  return null
}
