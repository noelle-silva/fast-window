import { readActiveEbRoleRunCards, type EbRoleRunCard } from './activeRunCards'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

export type RunningSessionTargetKind = 'role' | 'group' | 'workspace'

export type RunningSessionStatusKey = 'queued' | 'running' | 'waiting_confirmation' | 'retrying' | 'active'

export type RunningSessionEntry = {
  key: string
  targetKind: RunningSessionTargetKind
  targetId: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
  title: string
  targetName: string
  avatarImage: string
  statusKey: RunningSessionStatusKey
  statusLabel: string
  updatedAt: number
}

type RunningSessionTarget = {
  targetKind: RunningSessionTargetKind
  targetId: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

export function runningSessionKey(targetKindRaw: unknown, targetIdRaw: unknown, sessionIdRaw: unknown) {
  const targetKind = text(targetKindRaw)
  const targetId = text(targetIdRaw)
  const sessionId = text(sessionIdRaw)
  if (!targetKind || !targetId || !sessionId) return ''
  return `${targetKind}:${targetId}:${sessionId}`
}

export function normalizeRunningSessionStatus(value: unknown): { key: RunningSessionStatusKey; label: string } {
  const status = text(value).toLowerCase()
  if (status === 'queued') return { key: 'queued', label: '排队中' }
  if (status === 'waiting_confirmation' || status === 'waiting') return { key: 'waiting_confirmation', label: '等待确认' }
  if (status === 'retrying' || status === 'waiting_retry') return { key: 'retrying', label: '等待重试' }
  if (status === 'running') return { key: 'running', label: '生成中' }
  return { key: 'active', label: '运行中' }
}

function targetFromCard(card: EbRoleRunCard): RunningSessionTarget | null {
  const roleId = text(card.roleId)
  const groupId = text(card.groupId)
  const workspaceId = text(card.workspaceId)
  const sessionId = text(card.sessionId)
  if (!sessionId) return null

  if (workspaceId) {
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    if (!targetId) return null
    return { targetKind: 'workspace', targetId, roleId, groupId: '', workspaceId, sessionId }
  }

  if (groupId) {
    return { targetKind: 'group', targetId: groupId, roleId, groupId, workspaceId: '', sessionId }
  }

  if (!roleId) return null
  return { targetKind: 'role', targetId: roleId, roleId, groupId: '', workspaceId: '', sessionId }
}

function findById(listRaw: unknown, id: unknown) {
  const list = Array.isArray(listRaw) ? listRaw : []
  const targetId = text(id)
  if (!targetId) return null
  return list.find((item: any) => text(item?.id) === targetId) || null
}

function chatBoxFor(data: any, targetKind: RunningSessionTargetKind, targetId: string) {
  if (targetKind === 'group') return data?.chatsByGroup?.[targetId]
  if (targetKind === 'workspace') return data?.chatsByWorkspace?.[targetId]
  return data?.chatsByRole?.[targetId]
}

function chatTitleFromBox(box: any, sessionId: string) {
  const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
  const meta = metas.find((item: any) => text(item?.id) === sessionId)
  if (meta && text(meta.title)) return text(meta.title)
  const chats = Array.isArray(box?.chats) ? box.chats : []
  const chat = chats.find((item: any) => text(item?.id) === sessionId)
  return chat ? text(chat.title) : ''
}

function shortSessionId(sessionId: string) {
  return sessionId.length > 8 ? sessionId.slice(-8) : sessionId
}

function titleFor(data: any, target: RunningSessionTarget) {
  const box = chatBoxFor(data, target.targetKind, target.targetId)
  const title = chatTitleFromBox(box, target.sessionId)
  return title || `会话 ${shortSessionId(target.sessionId)}`
}

function targetFacts(data: any, target: RunningSessionTarget) {
  const role = findById(data?.roles, target.roleId)
  const group = findById(data?.groups, target.groupId)
  const workspace = findById(data?.workspaces, target.workspaceId)

  if (target.targetKind === 'group') {
    return {
      targetName: text(group?.name) || '群组',
      avatarImage: text(group?.avatarImage),
    }
  }

  if (target.targetKind === 'workspace') {
    const workspaceName = text(workspace?.name) || '工作区'
    const roleName = text(role?.name) || '角色'
    return {
      targetName: `${workspaceName} / ${roleName}`,
      avatarImage: text(role?.avatarImage),
    }
  }

  return {
    targetName: text(role?.name) || '角色',
    avatarImage: text(role?.avatarImage),
  }
}

export function collectRunningSessions(input: {
  state: any
  data: any
  includeGroups?: boolean
}): RunningSessionEntry[] {
  const includeGroups = input.includeGroups !== false
  const byKey = new Map<string, RunningSessionEntry>()

  for (const card of readActiveEbRoleRunCards(input.state)) {
    const target = targetFromCard(card)
    if (!target) continue
    if (target.targetKind === 'group' && !includeGroups) continue

    const key = runningSessionKey(target.targetKind, target.targetId, target.sessionId)
    if (!key) continue

    const previous = byKey.get(key)
    const updatedAt = Number(card.updatedAt || 0)
    if (previous && previous.updatedAt >= updatedAt) continue

    const status = normalizeRunningSessionStatus(card.status)
    const facts = targetFacts(input.data, target)
    byKey.set(key, {
      key,
      targetKind: target.targetKind,
      targetId: target.targetId,
      roleId: target.roleId,
      groupId: target.groupId,
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      title: titleFor(input.data, target),
      targetName: facts.targetName,
      avatarImage: facts.avatarImage,
      statusKey: status.key,
      statusLabel: status.label,
      updatedAt,
    })
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.title.localeCompare(b.title)
  })
}
