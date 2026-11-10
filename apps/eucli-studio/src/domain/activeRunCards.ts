import { normalizeErrorPayload, type ErrorPayload } from './errorPayload'
import { parseWorkspaceRoleTargetId } from './workspaceRoleTarget'

// ============================================================================
// 运行卡：对象身份 = 结构版本
//
// 一张卡片有两类字段：
//   - 结构字段：决定界面要不要重新计算（身份、归属、目标消息、状态、重试、取消）。
//   - updatedAt：最后一次「结构变化」的时间戳，不是心跳。
//
// 三条不变量（改本文件前先读）：
//   1. 读路径不重建对象：ensureActiveRunCards 正常情况返回原数组与原对象，
//      只有集合形状损坏时才整表归一化修复一次。
//   2. 写路径结构等价即不落地：register / update 构造出的下一张卡若结构签名
//      与当前卡相同，直接丢弃本次构造，卡片对象与集合元素保持原样。
//   3. 通知只认身份：控制器比较写入前后的卡片对象身份，变了才广播。
//      因此「对象身份」就是唯一的结构版本，禁止在别处另建一套字段比较。
//
// 结构签名的定义只在本文件的 ebRoleRunCardShapeKey：控制器通知与 UI 失效共用它。
// ============================================================================

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

// 结构签名的分隔符使用不可打印字符：卡片里的正文字段（id / 状态 / 消息）不会包含它们，
// 拼接因此没有歧义，也不需要额外的转义层。
const SHAPE_FIELD_SEP = '\u0001'
const SHAPE_ITEM_SEP = '\u0002'

// retryShapeKey 只表达「重试这件事的结构」。
// 进入卡片集合的 retry 都由 normalizeEbRoleRunRetryInfo 产出，字段与顺序固定，
// 因此直接序列化即可得到稳定签名；retry 常为 null，这条路径基本零开销。
function retryShapeKey(value: unknown): string {
  return isObject(value) ? JSON.stringify(value) : ''
}

// ebRoleRunCardShapeKey 是「什么算结构变化」的唯一答案。
//
// 约定：
//   - 只收录会影响界面派生结果的字段，不收录 updatedAt（心跳不是版本）。
//   - 参数接受 unknown：UI 侧可能拿到尚未经过本模块归一化的读取结果。
//   - 返回值只用于相等比较，不参与反解析。
export function ebRoleRunCardShapeKey(card: unknown): string {
  const raw = isObject(card) ? card : {}
  return [
    text(raw.runId),
    text(raw.roleId),
    text(raw.groupId),
    text(raw.workspaceId),
    text(raw.sessionId),
    text(raw.inputMessageId),
    text(raw.lastMessageId),
    text(raw.anchorMessageId),
    textList(raw.dependencyMessageIds).join(SHAPE_ITEM_SEP),
    text(raw.status),
    raw.stream ? '1' : '0',
    retryShapeKey(raw.retry),
    raw.cancelledByUser ? '1' : '0',
    String(Number(raw.createdAt || 0) || 0),
  ].join(SHAPE_FIELD_SEP)
}

// isEbRoleRunCardShaped 是读路径的轻量形状闸门：只回答「这张卡能不能直接读」，
// 不做字段归一化。字段规范化由写原语（register / update）在入口完成。
function isEbRoleRunCardShaped(value: unknown): value is EbRoleRunCard {
  const raw = isObject(value) ? value : null
  return !!raw && raw.kind === 'eb-role-run' && !!text(raw.runId)
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

// ensureActiveRunCards 只保证「集合可用」，不重建卡片。
//
// 正常路径（集合由写原语维护）直接返回原数组与原对象：卡片身份就是结构版本，
// 读一次就换一批新对象等于每次读都制造新版本。只有集合形状损坏
// （字段缺失 / 非数组 / 混入其它卡片类型）时才整表修复一次。
export function ensureActiveRunCards(state: any): EbRoleRunCard[] {
  if (!state || typeof state !== 'object') return []
  const source = Array.isArray(state.activeRunCards) ? (state.activeRunCards as unknown[]) : null
  if (source && source.every(isEbRoleRunCardShaped)) return source as EbRoleRunCard[]
  const cards = (source || []).map(normalizeEbRoleRunCard).filter(Boolean) as EbRoleRunCard[]
  state.activeRunCards = cards
  return cards
}

// readActiveRunCards 返回集合副本（调用方不得原地改集合），但不重建卡片对象。
export function readActiveRunCards(state: any): EbRoleRunCard[] {
  return ensureActiveRunCards(state).slice()
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

// 运行卡补丁：生命周期原语接受未归一化的 retry（构造卡时统一归一化），
// 调用方不必先把外部载荷转成领域类型。
export type EbRoleRunCardPatch = Partial<Omit<EbRoleRunCard, 'retry'>> & { runId?: unknown; retry?: unknown }

// 运行卡的三种生命周期原语，职责互斥：
//   register —— 出生：只有「权威运行事实」可以调用（生命周期事件、启动响应、
//                业务端的活动运行快照）。这是 runId 合法进入卡片集合的唯一出口。
//   update   —— 更新：只改已存在的卡。内容事件（消息增量 / 工具输出）没有出生权，
//                卡不存在就丢弃，绝不凭内容里的编号补建一张卡。
//   remove   —— 死亡：摘卡并登记终态闩锁，迟到事件无法复活。
function buildEbRoleRunCard(
  runId: string,
  patchRaw: EbRoleRunCardPatch,
  current: EbRoleRunCard | null,
): EbRoleRunCard {
  const t = timeNow()
  const hasRetryPatch = Object.prototype.hasOwnProperty.call(patchRaw, 'retry')
  // 补丁里的依赖消息只归一化一次（原实现调用了两次 textList）。
  const patchedDependencies = textList(patchRaw.dependencyMessageIds)
  return {
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
}

function removeEbRoleRunCardAt(state: any, index: number) {
  const cards = ensureActiveRunCards(state)
  if (index < 0 || index >= cards.length) return null
  const removed = cards[index]
  cards.splice(index, 1)
  return removed
}

// registerEbRoleRunCard 是运行卡的「出生」唯一原语。
// 终态补丁不是活动运行：登记终态闩锁并确保无卡，维持「终态 = 无卡」不变量。
export function registerEbRoleRunCard(state: any, patchRaw: EbRoleRunCardPatch) {
  const runId = text(patchRaw?.runId)
  if (!runId) return null
  const cards = ensureActiveRunCards(state)
  const index = cards.findIndex((card) => card.runId === runId)
  const patchStatus = text(patchRaw.status)
  if (isTerminalEbRunStatus(patchStatus)) {
    markRunSettled(state, runId, patchStatus)
    removeEbRoleRunCardAt(state, index)
    return null
  }
  // 单向闩锁：已收敛到终态的 run 不允许被迟到的运行中事件复活。
  if (isRunSettled(state, runId)) {
    removeEbRoleRunCardAt(state, index)
    return null
  }
  const current = index >= 0 ? cards[index] : null
  const next = buildEbRoleRunCard(runId, patchRaw, current)
  // 幂等重放：同一份运行事实又到了一次，结构没有任何变化。
  // 保持卡片对象与集合元素原样，界面因此不会被无意义地惊动。
  if (current && ebRoleRunCardShapeKey(next) === ebRoleRunCardShapeKey(current)) return current
  if (index >= 0) cards[index] = next
  else cards.push(next)
  return next
}

// updateEbRoleRunCard 是运行卡的「更新」原语：只改已存在的卡，绝不创造身份。
export function updateEbRoleRunCard(state: any, patchRaw: EbRoleRunCardPatch) {
  const runId = text(patchRaw?.runId)
  if (!runId) return null
  const cards = ensureActiveRunCards(state)
  const index = cards.findIndex((card) => card.runId === runId)
  // 内容事件没有出生权：卡不存在就丢弃，绝不凭内容里的编号补建一张卡。
  if (index < 0) return null
  const patchStatus = text(patchRaw.status)
  if (isTerminalEbRunStatus(patchStatus)) {
    markRunSettled(state, runId, patchStatus)
    removeEbRoleRunCardAt(state, index)
    return null
  }
  if (isRunSettled(state, runId)) {
    removeEbRoleRunCardAt(state, index)
    return null
  }
  const current = cards[index]
  const next = buildEbRoleRunCard(runId, patchRaw, current)
  // 结构等价：正文 / 思考 / 工具输出推进不改变卡片结构，
  // 因此不替换对象、不推进 updatedAt。对象身份就是结构版本。
  if (ebRoleRunCardShapeKey(next) === ebRoleRunCardShapeKey(current)) return current
  cards[index] = next
  return next
}

export function markEbRoleRunCardCancelled(state: any, runIdRaw: unknown) {
  const runId = text(runIdRaw)
  if (!runId) return null
  const card = findEbRoleRunCard(state, runId)
  if (!card) return null
  return updateEbRoleRunCard(state, { ...card, cancelledByUser: true })
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
