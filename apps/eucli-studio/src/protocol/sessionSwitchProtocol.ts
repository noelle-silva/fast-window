import type { AI_CHAT_DIRECT_FEATURE } from '../protocol/aiChatProtocol'

export type SessionScopeKind = 'role' | 'group'

// scope 是 scope 化协议的寻址单位：{kind,targetId}，与 storage key 无关。
export type SessionScope = {
  kind: SessionScopeKind
  targetId: string
}

export type SessionIndexSnapshot = {
  scope: string
  activeChatId: string
  chatIds: string[]
  chatUpdatedAt: Record<string, number>
  chatMetas: any[]
  updatedAt: number
  revision: number
}

export type SessionIndexBundle = {
  schemaVersion: number
  dataRevision: number
  preferenceRevision: number
  epoch: number
  indexes: SessionIndexSnapshot[]
}

export type SessionSummaryPage = {
  scope: string
  items: any[]
  nextCursor: string
  revision: number
  updatedAt: number
}

export type ActiveChatCommandResult = {
  applied: boolean
  preferenceRevision: number
  activeChatId: string
  reason?: string
}

// 会话 wire 的两个正交维度：profile 决定「发哪些字段」，window 决定「发多少条」。
export type SessionWireProfile = 'view' | 'edit' | 'full'

export type SessionWindowRequest = {
  cursor?: string
  head?: string
  before?: string
  limit?: number
  maxBytes?: number
  profile?: SessionWireProfile
  // switchId 是纯观测关联键：与偏好命令同一个值，让前端→studio→box 三跳同源。
  switchId?: string
}

export type SessionReadOptions = {
  profile?: SessionWireProfile
  switchId?: string
}

export type SessionSwitchClient = {
  // 只读快照：每次读取都返回「当前」能力集合（bootstrap 后可能已刷新）。
  readonly healthCheckFeatures: string[]
  hasFeature: (feature: string) => boolean
  sessionIndexGet: (scopes: SessionScope[]) => Promise<SessionIndexBundle>
  sessionSummaryList: (scope: SessionScope, options?: { cursor?: string; limit?: number }) => Promise<SessionSummaryPage>
  sessionGet: (scope: SessionScope, chatId: string, options?: SessionReadOptions) => Promise<any>
  sessionWindow: (scope: SessionScope, chatId: string, options?: SessionWindowRequest) => Promise<any>
  // 树视图的结构投影：只回节点结构，不回正文（与 window 正交）。
  sessionGraph: (scope: SessionScope, chatId: string, options?: { switchId?: string }) => Promise<import('./sessionGraphContract').SessionGraph>
  // 视图回写：把「用户在看哪条路径」变成服务端事实（design-4 决策 3）。
  // 只改视图，不改任何消息内容。
  setSessionView: (scope: SessionScope, chatId: string, head: string, options?: { branchId?: string; switchId?: string }) => Promise<any>
  setActiveChat: (scope: SessionScope, chatId: string, options?: { expectedRevision?: number; switchId?: string }) => Promise<ActiveChatCommandResult>
}

export function scopeKey(scope: SessionScope): string {
  return `${scope.kind}:${scope.targetId}`
}

export function scopeFromKey(key: unknown): SessionScope | null {
  const raw = String(key || '').trim()
  const separator = raw.indexOf(':')
  if (separator <= 0) return null
  const kind = raw.slice(0, separator) === 'group' ? 'group' : raw.slice(0, separator) === 'role' ? 'role' : ''
  const targetId = raw.slice(separator + 1).trim()
  if (!kind || !targetId) return null
  return { kind, targetId }
}

export function normalizeSessionIndexSnapshot(raw: any, fallbackScope = ''): SessionIndexSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const scope = String((raw as any).scope || fallbackScope || '').trim()
  if (!scope) return null
  const chatIds = Array.isArray((raw as any).chatIds)
    ? (raw as any).chatIds.map((x: any) => String(x || '').trim()).filter(Boolean)
    : []
  const updatedRaw = (raw as any).chatUpdatedAt && typeof (raw as any).chatUpdatedAt === 'object' ? (raw as any).chatUpdatedAt : {}
  const chatUpdatedAt: Record<string, number> = {}
  for (const [id, value] of Object.entries(updatedRaw)) {
    const key = String(id || '').trim()
    const number = Number(value || 0)
    if (key && Number.isFinite(number)) chatUpdatedAt[key] = number
  }
  return {
    scope,
    activeChatId: String((raw as any).activeChatId || ''),
    chatIds,
    chatUpdatedAt,
    chatMetas: Array.isArray((raw as any).chatMetas) ? (raw as any).chatMetas : [],
    updatedAt: Number((raw as any).updatedAt || 0),
    revision: Number((raw as any).revision || 0),
  }
}

export function normalizeSessionIndexBundle(raw: any): SessionIndexBundle {
  const source = raw && typeof raw === 'object' ? raw : {}
  const indexes = Array.isArray((source as any).indexes)
    ? (source as any).indexes.map((item: any) => normalizeSessionIndexSnapshot(item)).filter(Boolean)
    : []
  return {
    schemaVersion: Number((source as any).schemaVersion || 0),
    dataRevision: Number((source as any).dataRevision || 0),
    preferenceRevision: Number((source as any).preferenceRevision || 0),
    epoch: Number((source as any).epoch || 0),
    indexes: indexes as SessionIndexSnapshot[],
  }
}

export function normalizeSessionSummaryPage(raw: any): SessionSummaryPage {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    scope: String((source as any).scope || ''),
    items: Array.isArray((source as any).items) ? (source as any).items : [],
    nextCursor: String((source as any).nextCursor || ''),
    revision: Number((source as any).revision || 0),
    updatedAt: Number((source as any).updatedAt || 0),
  }
}

export function normalizeActiveChatCommandResult(raw: any): ActiveChatCommandResult {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    applied: (source as any).applied === true,
    preferenceRevision: Number((source as any).preferenceRevision || 0),
    activeChatId: String((source as any).activeChatId || ''),
    reason: String((source as any).reason || ''),
  }
}

export type DirectFeatureName = (typeof AI_CHAT_DIRECT_FEATURE)[keyof typeof AI_CHAT_DIRECT_FEATURE]
