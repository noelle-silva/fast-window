// 「当前选中会话」的唯一事实入口。
//
// activeChatId 是用户偏好，不是索引数据：它只回答「用户在看哪一条会话」。
// 任何模块需要读取或修改这个事实，都必须经过本模块，禁止在其他位置直接
// 给 holder.activeChatId 赋值——否则同一个事实会出现多套写路径，
// 后写覆盖先写、失效判断各写一遍，最终无法解释「到底谁选中了谁」。
//
// 本模块是「选择事实」的写入边界：
//   - 归一化（空值 / 空白 / 非字符串）；
//   - 写入（幂等，值相同不产生变更）；
//   - 不可变副本（供投影快照等只读模型使用）；
//   - 「候选 → 合法选择」的解析（存在性判定 + 顺序优先）。
//
// 读取也优先使用 readActiveChatSelection，保证全仓对「空值 / 空白」的理解一致；
// 但只有本模块允许真正修改 holder.activeChatId。

import { pickFactCandidate } from './factPrecedence'

export type ActiveChatHolder = {
  activeChatId?: unknown
}

export type ChatBoxIdSource = 'chatMetas' | 'chats'

export function normalizeActiveChatId(value: unknown): string {
  return String(value ?? '').trim()
}

export function readActiveChatSelection(holder: ActiveChatHolder | null | undefined): string {
  if (!holder || typeof holder !== 'object') return ''
  return normalizeActiveChatId(holder.activeChatId)
}

// 唯一写入口。
//
// 返回值表示这一次是否真的改变了事实：调用方可以据此决定是否需要 emit，
// 但不得据此推断命令是否成功（持久化由 ActiveSelectionWriter 负责）。
export function writeActiveChatSelection(holder: ActiveChatHolder | null | undefined, chatId: unknown): boolean {
  if (!holder || typeof holder !== 'object') return false
  const next = normalizeActiveChatId(chatId)
  if (String(holder.activeChatId ?? '') === next) return false
  holder.activeChatId = next
  return true
}

// 不可变副本：投影快照 / 只读模型不能就地修改，但事实仍必须来自同一入口。
export function withActiveChatSelection<T extends ActiveChatHolder>(holder: T, chatId: unknown): T {
  const next = { ...holder } as T
  writeActiveChatSelection(next, chatId)
  return next
}

export function activeChatIdExistsInBox(box: any, chatIdRaw: unknown): boolean {
  const chatId = normalizeActiveChatId(chatIdRaw)
  if (!chatId) return false
  const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
  if (metas.some((meta: any) => normalizeActiveChatId(meta?.id) === chatId)) return true
  const chats = Array.isArray(box?.chats) ? box.chats : []
  return chats.some((chat: any) => normalizeActiveChatId(chat?.id) === chatId)
}

export function firstChatIdInBox(box: any, prefer: ChatBoxIdSource = 'chatMetas'): string {
  if (!box || typeof box !== 'object') return ''
  const metas = Array.isArray(box.chatMetas) ? box.chatMetas : []
  const chats = Array.isArray(box.chats) ? box.chats : []
  const firstFrom = (list: any[]) => {
    for (const item of list) {
      const id = normalizeActiveChatId(item?.id)
      if (id) return id
    }
    return ''
  }
  if (prefer === 'chats') return firstFrom(chats) || firstFrom(metas)
  return firstFrom(metas) || firstFrom(chats)
}

export type ActiveChatSelectionFactInput = {
  // 用户刚发起 / 已保存的选择。本地 activeChatId 是用户意图的持久记录，
  // 不是索引投影：多窗口下另一窗口的索引偏好不能覆盖本窗口用户的选择。
  userIntent?: unknown
  // 运行期临时选择（例如草稿会话被激活）。当前没有独立来源，
  // 预留给「运行期已成立、尚未落盘」的选择事实。
  runtimeTransient?: unknown
  // 服务端索引快照里的 activeChatId（派生事实）。
  serverFact?: unknown
  // 本地列表顺序 / 首条兜底。
  localProjection?: unknown
  // 额外兜底候选，按调用方给出的顺序尝试。
  fallbackCandidates?: unknown[]
  // 额外「已存在」集合。索引快照里的会话可能还没进入本地 chats，
  // 但仍是可加载的合法选择，调用方必须显式传入，不能靠本地列表猜。
  availableChatIds?: Iterable<unknown>
  // 两个列表都为空时，首条从哪个列表取。
  prefer?: ChatBoxIdSource
}

function existingChatIds(box: any): Set<string> {
  const ids = new Set<string>()
  const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
  for (const meta of metas) {
    const id = normalizeActiveChatId(meta?.id)
    if (id) ids.add(id)
  }
  const chats = Array.isArray(box?.chats) ? box.chats : []
  for (const chat of chats) {
    const id = normalizeActiveChatId(chat?.id)
    if (id) ids.add(id)
  }
  return ids
}

// resolveActiveChatSelectionFact 是「当前选中会话」的唯一优先级规则。
//
// 顺序：用户意图 > 运行期临时态 > 服务端事实 > 本地投影。
// 任何一个来源给出的 id 必须真实存在才算数；不存在就继续看下一来源，
// 绝不把失效 id 写回。
export function resolveActiveChatSelectionFact(box: any, input: ActiveChatSelectionFactInput = {}): string {
  const existing = existingChatIds(box)
  for (const raw of input.availableChatIds || []) {
    const id = normalizeActiveChatId(raw)
    if (id) existing.add(id)
  }
  const chosen = pickFactCandidate(
    [
      { source: 'user-intent' as const, value: normalizeActiveChatId(input.userIntent) },
      { source: 'runtime-transient' as const, value: normalizeActiveChatId(input.runtimeTransient) },
      { source: 'server-fact' as const, value: normalizeActiveChatId(input.serverFact) },
      { source: 'local-projection' as const, value: normalizeActiveChatId(input.localProjection) },
    ],
    (id) => !!id && existing.has(id),
  )
  if (chosen) return chosen.value

  for (const candidate of input.fallbackCandidates || []) {
    const id = normalizeActiveChatId(candidate)
    if (id && existing.has(id)) return id
  }
  return ''
}

// reconcileActiveChatSelectionFact 用规则解析并落盘当前选择。
// 所有「多来源合并后选中谁」的调用点都必须走这里，禁止先 || 再写。
export function reconcileActiveChatSelectionFact(box: any, input: ActiveChatSelectionFactInput = {}): string {
  const next = resolveActiveChatSelectionFact(box, input) || firstChatIdInBox(box, input.prefer)
  writeActiveChatSelection(box, next)
  return next
}

// resolveActiveChatSelection 按候选顺序返回第一条「在盒子里真实存在」的会话。
// 候选本身就是优先级：调用方只表达意图，存在性判断统一由这里负责。
export function resolveActiveChatSelection(box: any, candidates: unknown[] = []): string {
  const existing = new Set<string>()
  const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
  for (const meta of metas) {
    const id = normalizeActiveChatId(meta?.id)
    if (id) existing.add(id)
  }
  const chats = Array.isArray(box?.chats) ? box.chats : []
  for (const chat of chats) {
    const id = normalizeActiveChatId(chat?.id)
    if (id) existing.add(id)
  }
  for (const candidate of candidates) {
    const id = normalizeActiveChatId(candidate)
    if (id && existing.has(id)) return id
  }
  return ''
}

// reconcileActiveChatSelection 是「兜底到第一条」的唯一实现：
// 候选都失效时，按调用方指定的列表顺序取第一条真实存在的会话。
// prefer 只表达「两个列表谁优先」，不改变任何数据事实。
export function reconcileActiveChatSelection(
  box: any,
  candidates: unknown[] = [readActiveChatSelection(box)],
  prefer: ChatBoxIdSource = 'chatMetas',
): string {
  const [userIntent, ...fallbackCandidates] = candidates
  return reconcileActiveChatSelectionFact(box, { userIntent, fallbackCandidates, prefer })
}
