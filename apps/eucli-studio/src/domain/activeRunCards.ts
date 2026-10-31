import { normalizeErrorPayload, type ErrorPayload } from './errorPayload'
import { parseWorkspaceRoleTargetId } from './workspaceRoleTarget'

export type EbRoleRunCard = {
  kind: 'eb-role-run'
  runId: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
  inputMessageId: string
  lastMessageId: string
  anchorMessageId: string
  dependencyMessageIds: string[]
  status: string
  stream: boolean
  retry: EbRoleRunRetryInfo | null
  cancelledByUser: boolean
  createdAt: number
  updatedAt: number
}

export type EbRoleRunRetryInfo = {
  attempt: number
  maxAttempts: number
  retryAt: string
  delayMs: number
  message: string
  failure: ErrorPayload | null
}

function timeNow() {
  return Date.now()
}

function text(value: unknown) {
  return String(value || '').trim()
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object'
}

function textList(value: unknown) {
  const list = Array.isArray(value) ? value : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = text(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function normalizeEbRoleRunRetryInfo(value: unknown): EbRoleRunRetryInfo | null {
  const raw = isObject(value) ? value : null
  if (!raw) return null
  const attempt = Math.max(0, Math.floor(Number(raw.attempt || 0)))
  const maxAttempts = Math.max(0, Math.floor(Number(raw.maxAttempts || 0)))
  if (!attempt || !maxAttempts) return null
  return {
    attempt,
    maxAttempts,
    retryAt: text(raw.retryAt),
    delayMs: Math.max(0, Math.floor(Number(raw.delayMs || 0))),
    message: text(raw.message),
    failure: normalizeErrorPayload(raw.failure),
  }
}

export function isTerminalEbRunStatus(value: unknown) {
  const status = text(value)
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'canceled'
}

function normalizeEbRoleRunCard(value: unknown): EbRoleRunCard | null {
  const raw = isObject(value) ? value : null
  if (!raw || text(raw.kind) !== 'eb-role-run') return null
  const runId = text(raw.runId)
  if (!runId) return null
  const t = timeNow()
  const createdAt = Number(raw.createdAt || 0)
  const updatedAt = Number(raw.updatedAt || 0)
  return {
    kind: 'eb-role-run',
    runId,
    roleId: text(raw.roleId),
    groupId: text(raw.groupId),
    workspaceId: text(raw.workspaceId),
    sessionId: text(raw.sessionId),
    inputMessageId: text(raw.inputMessageId),
    lastMessageId: text(raw.lastMessageId),
    anchorMessageId: text(raw.anchorMessageId),
    dependencyMessageIds: textList(raw.dependencyMessageIds),
    status: text(raw.status) || 'running',
    stream: !!raw.stream,
    retry: normalizeEbRoleRunRetryInfo(raw.retry),
    cancelledByUser: !!raw.cancelledByUser,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : t,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : t,
  }
}

// 运行终态台账：runId 一旦被权威地判定为终态，就再也不允许重新登记为活动运行。
//
// 为什么需要它：终态事实有多个来源（事件、探针、写路径收尾），彼此可能乱序。
// 没有这条单向闩锁时，「终态已移除 → 迟到的运行中事件/启动登记」会把卡片复活，
// 于是停止按钮永远不消失、占位永远不清除。台账同时记住「第一条终态」，
// 后续到达的不同终态措辞（completed vs failed）不得翻案。
// 台账是有界的内存事实：超出时间窗口或条数上限即惰性回收。
const SETTLED_RUN_TTL_MS = 10 * 60 * 1000
const SETTLED_RUN_LIMIT = 128

type SettledRunEntry = { at: number; status: string }

function settleLedger(state: any): Record<string, SettledRunEntry> {
  if (!state || typeof state !== 'object') return {}
  const raw = state.settledRuns
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    state.settledRuns = {}
    return state.settledRuns
  }
  return raw as Record<string, SettledRunEntry>
}

function pruneSettledRuns(ledger: Record<string, SettledRunEntry>, nowMs: number) {
  const ids = Object.keys(ledger)
  if (!ids.length) return
  for (const id of ids) {
    const at = Number(ledger[id]?.at || 0)
    if (!Number.isFinite(at) || nowMs - at > SETTLED_RUN_TTL_MS) delete ledger[id]
  }
  const rest = Object.keys(ledger)
  if (rest.length <= SETTLED_RUN_LIMIT) return
  rest
    .sort((left, right) => Number(ledger[left]?.at || 0) - Number(ledger[right]?.at || 0))
    .slice(0, rest.length - SETTLED_RUN_LIMIT)
    .forEach((id) => delete ledger[id])
}

function settledEntry(state: any, runIdRaw: unknown): SettledRunEntry | null {
  const runId = text(runIdRaw)
  if (!runId) return null
  const ledger = settleLedger(state)
  const entry = ledger[runId]
  if (!entry) return null
  if (Date.now() - Number(entry.at || 0) > SETTLED_RUN_TTL_MS) {
    delete ledger[runId]
    return null
  }
  return entry
}

export function isRunSettled(state: any, runIdRaw: unknown): boolean {
  return !!settledEntry(state, runIdRaw)
}

// settledRunStatus 是「这条 run 的权威终态」：第一条终态胜出，后续不再改写。
export function settledRunStatus(state: any, runIdRaw: unknown): string {
  return text(settledEntry(state, runIdRaw)?.status)
}

// markRunSettled 返回「本次是否是第一次登记终态」：重复调用幂等。
// 已登记过的 run 保留第一条终态，不被后到的措辞覆盖；
// 唯一例外是首次登记没带状态（例如只摘卡的收尾），后到的真实状态可以补全。
export function markRunSettled(state: any, runIdRaw: unknown, status?: unknown, atMs?: number): boolean {
  const runId = text(runIdRaw)
  if (!runId) return false
  const ledger = settleLedger(state)
  const nowMs = Number.isFinite(Number(atMs)) && Number(atMs) > 0 ? Number(atMs) : timeNow()
  pruneSettledRuns(ledger, nowMs)
  const nextStatus = text(status)
  const existing = ledger[runId]
  if (existing) {
    if (!existing.status && nextStatus) {
      ledger[runId] = { ...existing, status: nextStatus }
    }
    return false
  }
  ledger[runId] = { at: nowMs, status: nextStatus }
  return true
}

export function ensureActiveRunCards(state: any): EbRoleRunCard[] {
  if (!state || typeof state !== 'object') return []
  const source = Array.isArray(state.activeRunCards) ? state.activeRunCards : []
  const cards = source.map(normalizeEbRoleRunCard).filter(Boolean) as EbRoleRunCard[]
  state.activeRunCards = cards
  return cards
}

export function readActiveRunCards(state: any): EbRoleRunCard[] {
  const source = Array.isArray(state?.activeRunCards) ? state.activeRunCards : []
  return source.map(normalizeEbRoleRunCard).filter(Boolean) as EbRoleRunCard[]
}

export function readActiveEbRoleRunCards(state: any) {
  return readActiveRunCards(state).filter((card) => card.kind === 'eb-role-run' && !isTerminalEbRunStatus(card.status))
}

export function readActiveEbRoleRunCardsForSession(state: any, roleIdRaw: unknown, sessionIdRaw: unknown) {
  const roleId = text(roleIdRaw)
  const sessionId = text(sessionIdRaw)
  if (!roleId || !sessionId) return []
  return readActiveEbRoleRunCards(state).filter((card) => !card.groupId && !card.workspaceId && card.roleId === roleId && card.sessionId === sessionId)
}

export function readActiveEbRunCardsForTarget(state: any, targetKindRaw: unknown, targetIdRaw: unknown, sessionIdRaw: unknown) {
  const targetKindText = text(targetKindRaw)
  const targetKind = targetKindText === 'group' ? 'group' : targetKindText === 'workspace' ? 'workspace' : 'role'
  const targetId = text(targetIdRaw)
  const sessionId = text(sessionIdRaw)
  if (!targetId || !sessionId) return []
  return readActiveEbRoleRunCards(state).filter((card) => {
    if (card.sessionId !== sessionId) return false
    if (targetKind === 'group') return card.groupId === targetId
    if (targetKind === 'workspace') {
      const parsed = parseWorkspaceRoleTargetId(targetId)
      if (!parsed.workspaceId || !parsed.roleId) return card.workspaceId === targetId
      return card.workspaceId === parsed.workspaceId && card.roleId === parsed.roleId
    }
    return !card.groupId && card.roleId === targetId
  })
}

export function activeEbRoleRunCards(state: any) {
  return ensureActiveRunCards(state).filter((card) => card.kind === 'eb-role-run' && !isTerminalEbRunStatus(card.status))
}

export function activeEbRoleRunCardsForSession(state: any, roleIdRaw: unknown, sessionIdRaw: unknown) {
  const roleId = text(roleIdRaw)
  const sessionId = text(sessionIdRaw)
  if (!roleId || !sessionId) return []
  return activeEbRoleRunCards(state).filter((card) => !card.groupId && !card.workspaceId && card.roleId === roleId && card.sessionId === sessionId)
}

export function activeEbRunCardsForTarget(state: any, targetKindRaw: unknown, targetIdRaw: unknown, sessionIdRaw: unknown) {
  const targetKindText = text(targetKindRaw)
  const targetKind = targetKindText === 'group' ? 'group' : targetKindText === 'workspace' ? 'workspace' : 'role'
  const targetId = text(targetIdRaw)
  const sessionId = text(sessionIdRaw)
  if (!targetId || !sessionId) return []
  return activeEbRoleRunCards(state).filter((card) => {
    if (card.sessionId !== sessionId) return false
    if (targetKind === 'group') return card.groupId === targetId
    if (targetKind === 'workspace') {
      const parsed = parseWorkspaceRoleTargetId(targetId)
      if (!parsed.workspaceId || !parsed.roleId) return card.workspaceId === targetId
      return card.workspaceId === parsed.workspaceId && card.roleId === parsed.roleId
    }
    return !card.groupId && card.roleId === targetId
  })
}

export function latestEbRoleRunCardForSession(state: any, roleIdRaw: unknown, sessionIdRaw: unknown) {
  const cards = activeEbRoleRunCardsForSession(state, roleIdRaw, sessionIdRaw)
  return cards.length ? cards[cards.length - 1] : null
}

export function latestEbRunCardForTarget(state: any, targetKindRaw: unknown, targetIdRaw: unknown, sessionIdRaw: unknown) {
  const cards = activeEbRunCardsForTarget(state, targetKindRaw, targetIdRaw, sessionIdRaw)
  return cards.length ? cards[cards.length - 1] : null
}

export function ebRoleRunCardIsOnMessagePath(card: Pick<EbRoleRunCard, 'inputMessageId' | 'anchorMessageId' | 'lastMessageId'> | null | undefined, pathIdsRaw: Iterable<unknown> | null | undefined, headIdRaw?: unknown) {
  if (!card || !pathIdsRaw) return false
  const pathIds = new Set<string>()
  for (const item of pathIdsRaw) {
    const id = text(item)
    if (id) pathIds.add(id)
  }
  if (!pathIds.size) return false

  const inputId = text(card.inputMessageId)
  const anchorId = text(card.anchorMessageId)
  const lastId = text(card.lastMessageId)
  const headId = text(headIdRaw)
  if (lastId && pathIds.has(lastId)) {
    if (lastId === inputId || lastId === anchorId) return !!headId && lastId === headId
    return true
  }

  const startId = anchorId || inputId
  return !!startId && !!headId && startId === headId
}

export function filterEbRoleRunCardsOnMessagePath<T extends Pick<EbRoleRunCard, 'inputMessageId' | 'anchorMessageId' | 'lastMessageId'>>(cards: T[], pathIdsRaw: Iterable<unknown> | null | undefined, headIdRaw?: unknown) {
  return cards.filter((card) => ebRoleRunCardIsOnMessagePath(card, pathIdsRaw, headIdRaw))
}

export function findEbRoleRunCard(state: any, runIdRaw: unknown) {
  const runId = text(runIdRaw)
  if (!runId) return null
  return ensureActiveRunCards(state).find((card) => card.runId === runId) || null
}

export function upsertEbRoleRunCard(state: any, patchRaw: Partial<EbRoleRunCard> & { runId?: unknown }) {
  const runId = text(patchRaw?.runId)
  if (!runId) return null
  const patchStatus = text(patchRaw.status)
  // 终态补丁不是「活动运行」：绝不把终态 run 重新登记成卡片。
  // 若此前存在卡片，这里同时摘除它，保证「终态 = 无卡」这一条不变量。
  if (isTerminalEbRunStatus(patchStatus)) {
    markRunSettled(state, runId, patchStatus)
    const existing = Array.isArray(state?.activeRunCards) ? state.activeRunCards : []
    if (existing.some((card: any) => text(card?.runId) === runId)) {
      state.activeRunCards = existing.filter((card: any) => text(card?.runId) !== runId)
    }
    return null
  }
  // 单向闩锁：已收敛到终态的 run 不允许被迟到的运行中事件复活。
  if (isRunSettled(state, runId)) return null
  const cards = ensureActiveRunCards(state)
  const index = cards.findIndex((card) => card.runId === runId)
  const current = index >= 0 ? cards[index] : null
  const t = timeNow()
  const hasRetryPatch = Object.prototype.hasOwnProperty.call(patchRaw, 'retry')
  const next: EbRoleRunCard = {
    kind: 'eb-role-run',
    runId,
    roleId: text(patchRaw.roleId) || current?.roleId || '',
    groupId: text((patchRaw as any).groupId) || current?.groupId || '',
    workspaceId: text((patchRaw as any).workspaceId) || current?.workspaceId || '',
    sessionId: text(patchRaw.sessionId) || current?.sessionId || '',
    inputMessageId: text(patchRaw.inputMessageId) || current?.inputMessageId || '',
    lastMessageId: text(patchRaw.lastMessageId) || current?.lastMessageId || text(patchRaw.inputMessageId) || current?.inputMessageId || '',
    anchorMessageId: text(patchRaw.anchorMessageId) || current?.anchorMessageId || '',
    dependencyMessageIds: textList(patchRaw.dependencyMessageIds).length ? textList(patchRaw.dependencyMessageIds) : current?.dependencyMessageIds || [],
    status: text(patchRaw.status) || current?.status || 'running',
    stream: typeof patchRaw.stream === 'boolean' ? patchRaw.stream : !!current?.stream,
    retry: hasRetryPatch ? normalizeEbRoleRunRetryInfo(patchRaw.retry) : current?.retry || null,
    cancelledByUser: typeof patchRaw.cancelledByUser === 'boolean' ? patchRaw.cancelledByUser : !!current?.cancelledByUser,
    createdAt: current?.createdAt || t,
    updatedAt: t,
  }

  if (index >= 0) cards[index] = next
  else cards.push(next)
  return next
}

export function markEbRoleRunCardCancelled(state: any, runIdRaw: unknown) {
  const runId = text(runIdRaw)
  if (!runId) return null
  const card = findEbRoleRunCard(state, runId)
  if (!card) return null
  return upsertEbRoleRunCard(state, { ...card, cancelledByUser: true })
}

// removeEbRoleRunCard 是「运行进入终态」的唯一收口原语：
// 它同时登记终态闩锁，保证之后任何迟到的运行中补丁都无法复活该 run。
export function removeEbRoleRunCard(state: any, runIdRaw: unknown) {
  const runId = text(runIdRaw)
  if (!runId) return null
  markRunSettled(state, runId)
  const cards = ensureActiveRunCards(state)
  const removed = cards.find((card) => card.runId === runId) || null
  state.activeRunCards = cards.filter((card) => card.runId !== runId)
  return removed
}
