type EbNetRequest = (req: any) => Promise<any>

type RoleSessionInput = {
  roleId: string
  sessionId: string
}

type GroupSessionInput = {
  groupId: string
  sessionId: string
}

type WorkspaceSessionInput = {
  workspaceId: string
  roleId: string
  sessionId: string
}

type SessionTargetKind = 'role' | 'group' | 'workspace'

type SessionTarget = {
  kind: SessionTargetKind
  targetId: string
  sessionId: string
}

export async function updateRoleSessionTitle(netRequest: EbNetRequest, input: RoleSessionInput & { title: string }) {
  return updateSessionTitle(netRequest, normalizeSessionTarget('role', input), input.title)
}

export async function updateGroupSessionTitle(netRequest: EbNetRequest, input: GroupSessionInput & { title: string }) {
  return updateSessionTitle(netRequest, normalizeSessionTarget('group', input), input.title)
}

export async function updateWorkspaceSessionTitle(netRequest: EbNetRequest, input: WorkspaceSessionInput & { title: string }) {
  return updateSessionTitle(netRequest, normalizeSessionTarget('workspace', input), input.title)
}

export async function updateRoleSessionMessage(netRequest: EbNetRequest, input: RoleSessionInput & { messageId: string; content?: string; parts?: any[] }) {
  return updateSessionMessage(netRequest, normalizeSessionTarget('role', input), input)
}

export async function updateGroupSessionMessage(netRequest: EbNetRequest, input: GroupSessionInput & { messageId: string; content?: string; parts?: any[] }) {
  return updateSessionMessage(netRequest, normalizeSessionTarget('group', input), input)
}

export async function updateWorkspaceSessionMessage(netRequest: EbNetRequest, input: WorkspaceSessionInput & { messageId: string; content?: string; parts?: any[] }) {
  return updateSessionMessage(netRequest, normalizeSessionTarget('workspace', input), input)
}

function serializeSessionMessagePartsForPatch(partsRaw: unknown) {
  const parts = Array.isArray(partsRaw) ? partsRaw : []
  const out: any[] = []
  for (const raw of parts) {
    const part = raw && typeof raw === 'object' ? (raw as any) : null
    if (!part) continue
    const type = String(part.type || '').trim()
    const id = String(part.id || '').trim()
    if (!id || (type !== 'text' && type !== 'tool')) continue
    const next: any = { id, type }
    if (type === 'text') {
      next.text = String(part.text ?? '')
    } else {
      next.raw = String(part.raw || '')
      next.callId = String(part.callId || '').trim()
      next.toolName = String(part.toolName || '').trim()
      next.input = plainObjectCopy(part.input)
      next.state = String(part.state || '').trim()
      const decision = serializeToolDecisionForPatch(part.decision)
      if (decision) next.decision = decision
      const result = serializeToolResultForPatch(part.result)
      if (result) next.result = result
      const display = plainObjectCopy(part.display)
      if (Object.keys(display).length) next.display = display
    }
    assignTimeForPatch(next, 'createdAt', part.createdAt)
    assignTimeForPatch(next, 'updatedAt', part.updatedAt)
    out.push(next)
  }
  return out
}

function serializeToolDecisionForPatch(raw: unknown) {
  const decision = raw && typeof raw === 'object' ? (raw as any) : null
  if (!decision) return null
  const out: any = {
    id: String(decision.id || '').trim(),
    actionId: String(decision.actionId || '').trim(),
    toolName: String(decision.toolName || '').trim(),
    status: String(decision.status || '').trim(),
    reason: String(decision.reason || '').trim(),
  }
  assignTimeForPatch(out, 'createdAt', decision.createdAt)
  return out
}

function serializeToolResultForPatch(raw: unknown) {
  const result = raw && typeof raw === 'object' ? (raw as any) : null
  if (!result) return null
  const out: any = {
    id: String(result.id || '').trim(),
    actionId: String(result.actionId || '').trim(),
    toolName: String(result.toolName || '').trim(),
    status: String(result.status || '').trim(),
    content: String(result.content || ''),
    metadata: plainObjectCopy(result.metadata),
    error: String(result.error || '').trim(),
  }
  assignTimeForPatch(out, 'createdAt', result.createdAt)
  return out
}

function assignTimeForPatch(target: any, key: string, value: unknown) {
  const iso = isoTimeForPatch(value)
  if (iso) target[key] = iso
}

function isoTimeForPatch(value: unknown) {
  let time = 0
  if (value instanceof Date) {
    time = value.getTime()
  } else if (typeof value === 'number') {
    time = value
  } else {
    const text = String(value ?? '').trim()
    if (!text) return ''
    const numeric = Number(text)
    time = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(text)
  }
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function plainObjectCopy(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (!key || typeof item === 'undefined') continue
    out[key] = item
  }
  return out
}

export async function deleteRoleSessionMessage(netRequest: EbNetRequest, input: RoleSessionInput & { messageId: string }) {
  return deleteSessionMessage(netRequest, normalizeSessionTarget('role', input), input.messageId)
}

export async function deleteGroupSessionMessage(netRequest: EbNetRequest, input: GroupSessionInput & { messageId: string }) {
  return deleteSessionMessage(netRequest, normalizeSessionTarget('group', input), input.messageId)
}

export async function deleteWorkspaceSessionMessage(netRequest: EbNetRequest, input: WorkspaceSessionInput & { messageId: string }) {
  return deleteSessionMessage(netRequest, normalizeSessionTarget('workspace', input), input.messageId)
}

export async function deleteRoleSessionMessageSubtree(netRequest: EbNetRequest, input: RoleSessionInput & { messageId: string }) {
  return deleteSessionMessageSubtree(netRequest, normalizeSessionTarget('role', input), input.messageId)
}

export async function deleteGroupSessionMessageSubtree(netRequest: EbNetRequest, input: GroupSessionInput & { messageId: string }) {
  return deleteSessionMessageSubtree(netRequest, normalizeSessionTarget('group', input), input.messageId)
}

export async function deleteWorkspaceSessionMessageSubtree(netRequest: EbNetRequest, input: WorkspaceSessionInput & { messageId: string }) {
  return deleteSessionMessageSubtree(netRequest, normalizeSessionTarget('workspace', input), input.messageId)
}

function normalizeSessionTarget(kind: SessionTargetKind, input: Partial<RoleSessionInput & GroupSessionInput & WorkspaceSessionInput>) {
  const sessionId = String(input.sessionId || '').trim()
  if (!sessionId) throw new Error('会话无效')
  const targetId = kind === 'group'
    ? String(input.groupId || '').trim()
    : kind === 'workspace'
      ? [String(input.workspaceId || '').trim(), String(input.roleId || '').trim()].filter(Boolean).join('::')
      : String(input.roleId || '').trim()
  if (!targetId) throw new Error(kind === 'group' ? '群组无效' : kind === 'workspace' ? '工作区无效' : '角色无效')
  return { kind, targetId, sessionId }
}

function sessionRouteBasePath(target: SessionTarget) {
  const targetId = encodeURIComponent(target.targetId)
  const sessionId = encodeURIComponent(target.sessionId)
  if (target.kind === 'group') return `/api/groups/${targetId}/sessions/${sessionId}`
  if (target.kind === 'workspace') {
    const [workspaceId, roleId] = String(target.targetId || '').split('::')
    if (!workspaceId || !roleId) throw new Error('工作区会话无效')
    return `/api/workspaces/${encodeURIComponent(workspaceId)}/roles/${encodeURIComponent(roleId)}/sessions/${sessionId}`
  }
  return `/api/roles/${targetId}/sessions/${sessionId}`
}

function defaultSessionTitle(target: SessionTarget) {
  if (target.kind === 'group') return '群聊'
  if (target.kind === 'workspace') return '工作区会话'
  return '新聊天'
}

async function updateSessionTitle(netRequest: EbNetRequest, target: SessionTarget, title: string) {
  const response = await netRequest({
    method: 'PATCH',
    path: `${sessionRouteBasePath(target)}/title`,
    body: { title: String(title || '').trim() || defaultSessionTitle(target) },
    timeoutMs: 15000,
  })
  return response?.body
}

async function updateSessionMessage(netRequest: EbNetRequest, target: SessionTarget, input: { messageId: string; content?: string; parts?: any[] }) {
  const messageId = String(input.messageId || '').trim()
  if (!messageId) throw new Error('消息无效')
  const body: any = {}
  if (Object.prototype.hasOwnProperty.call(input, 'content')) body.content = String(input.content ?? '')
  if (Object.prototype.hasOwnProperty.call(input, 'parts')) body.parts = serializeSessionMessagePartsForPatch(input.parts)
  const response = await netRequest({
    method: 'PATCH',
    path: `${sessionRouteBasePath(target)}/messages/${encodeURIComponent(messageId)}`,
    body,
    timeoutMs: 15000,
  })
  return response?.body
}

async function deleteSessionMessage(netRequest: EbNetRequest, target: SessionTarget, messageIdRaw: string) {
  const messageId = String(messageIdRaw || '').trim()
  if (!messageId) throw new Error('消息无效')
  const response = await netRequest({
    method: 'DELETE',
    path: `${sessionRouteBasePath(target)}/messages/${encodeURIComponent(messageId)}`,
    timeoutMs: 15000,
  })
  return response?.body
}

async function deleteSessionMessageSubtree(netRequest: EbNetRequest, target: SessionTarget, messageIdRaw: string) {
  const messageId = String(messageIdRaw || '').trim()
  if (!messageId) throw new Error('消息无效')
  const response = await netRequest({
    method: 'DELETE',
    path: `${sessionRouteBasePath(target)}/messages/${encodeURIComponent(messageId)}/subtree`,
    timeoutMs: 15000,
  })
  return response?.body
}
