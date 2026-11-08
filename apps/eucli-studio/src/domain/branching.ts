import { now, uid } from '../core/utils'
import { CHAT_BRANCHING_SCHEMA_VERSION, CHAT_DEFAULT_BRANCH_ID, CHAT_DEFAULT_BRANCH_NAME } from './constants'

export function normalizeBranchId(input: any) {
  let s = String(input || '').trim()
  if (!s) return CHAT_DEFAULT_BRANCH_ID
  if (s.length > 60) s = s.slice(0, 60).trim()
  s = s.replace(/[^a-zA-Z0-9._-]/g, '_')
  return s || CHAT_DEFAULT_BRANCH_ID
}

export function normalizeBranchName(input: any) {
  let s = String(input || '').replace(/\s+/g, ' ').trim()
  if (!s) return CHAT_DEFAULT_BRANCH_NAME
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s || CHAT_DEFAULT_BRANCH_NAME
}

export function createDefaultChatBranching(headMid: string, createdAt: number, updatedAt: number) {
  const hid = String(headMid || '').trim()
  const ca = Number(createdAt || now())
  const ua = Number(updatedAt || ca || now())
  return {
    schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION,
    activeBranchId: CHAT_DEFAULT_BRANCH_ID,
    branches: [{ id: CHAT_DEFAULT_BRANCH_ID, name: CHAT_DEFAULT_BRANCH_NAME, headMid: hid, createdAt: ca, updatedAt: ua, forkFromMid: '' }],
  }
}

export function normalizeChatBranching(raw: any, fallbackHeadMid: string, createdAt: number, updatedAt: number) {
  const r = raw && typeof raw === 'object' ? raw : null
  if (!r || Number((r as any).schemaVersion || 0) !== CHAT_BRANCHING_SCHEMA_VERSION) {
    return createDefaultChatBranching(fallbackHeadMid, createdAt, updatedAt)
  }

  const activeBranchId = normalizeBranchId((r as any).activeBranchId)
  const branches0 = Array.isArray((r as any).branches) ? (r as any).branches : []
  const branches = branches0
    .filter((b: any) => b && typeof b === 'object')
    .map((b: any) => ({
      id: normalizeBranchId(b.id),
      name: normalizeBranchName(b.name),
      headMid: String(b.headMid || '').trim(),
      createdAt: Number(b.createdAt || createdAt || now()),
      updatedAt: Number(b.updatedAt || updatedAt || b.createdAt || now()),
      forkFromMid: String(b.forkFromMid || '').trim(),
    }))

  const byId = new Map<string, any>()
  for (const b of branches) {
    if (!b?.id || byId.has(b.id)) continue
    byId.set(b.id, b)
  }

  if (!byId.has(activeBranchId)) {
    byId.set(activeBranchId, {
      id: activeBranchId,
      name: activeBranchId === CHAT_DEFAULT_BRANCH_ID ? CHAT_DEFAULT_BRANCH_NAME : '分支',
      headMid: String(fallbackHeadMid || '').trim(),
      createdAt: Number(createdAt || now()),
      updatedAt: Number(updatedAt || createdAt || now()),
      forkFromMid: '',
    })
  }

  return { schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION, activeBranchId, branches: Array.from(byId.values()).slice(0, 200) }
}

type ChatBranchHeadWrite = {
  branchId: string
  headMid: string
  updatedAt?: number
}

type ChatBranchingWrite = {
  activeBranchId?: string
  heads?: ChatBranchHeadWrite[]
}

function ensureBranchInBranching(branching: any, branchId: string) {
  const bid = normalizeBranchId(branchId)
  const branches = Array.isArray(branching?.branches) ? branching.branches : []
  let branch = branches.find((item: any) => String(item?.id || '') === bid) || null
  if (!branch) {
    const t = now()
    branch = { id: bid, name: bid === CHAT_DEFAULT_BRANCH_ID ? CHAT_DEFAULT_BRANCH_NAME : '分支', headMid: '', createdAt: t, updatedAt: t, forkFromMid: '' }
    branches.push(branch)
    ;(branching as any).branches = branches.slice(0, 200)
  }
  return branch
}

// writeChatBranchingState 是 chat.branching 中「活动分支 + 分支头」的唯一写入口。
// 其它领域函数只负责计算目标状态，最终都必须经过这里落盘到会话对象。
function writeChatBranchingState(chat: any, write: ChatBranchingWrite) {
  const c = chat && typeof chat === 'object' ? chat : null
  if (!c) return false
  const branching = ensureChatBranching(c)
  if (!branching) return false

  if (write.activeBranchId !== undefined) {
    const activeBranchId = normalizeBranchId(write.activeBranchId)
    ensureBranchInBranching(branching, activeBranchId)
    ;(branching as any).activeBranchId = activeBranchId
  }

  for (const head of write.heads || []) {
    const branch = ensureBranchInBranching(branching, head.branchId)
    if (!branch) continue
    ;(branch as any).headMid = String(head.headMid || '').trim()
    if (head.updatedAt !== undefined) (branch as any).updatedAt = Number(head.updatedAt)
  }

  return true
}

export function touchActiveBranchHead(chat: any) {
  const c = chat && typeof chat === 'object' ? chat : null
  if (!c) return
  const msgs = Array.isArray((c as any).messages) ? (c as any).messages : []
  const lastMid = msgs.length ? String((msgs[msgs.length - 1] as any)?.id || '') : ''
  const createdAt = Number((c as any).createdAt || now())
  const updatedAt = Number((c as any).updatedAt || createdAt || now())
  const branching = normalizeChatBranching((c as any).branching, lastMid, createdAt, updatedAt)
  const bid = normalizeBranchId((branching as any).activeBranchId)
  writeChatBranchingState(c, { heads: [{ branchId: bid, headMid: lastMid, updatedAt }] })
}

export function ensureChatBranching(chat: any) {
  const c = chat && typeof chat === 'object' ? chat : null
  if (!c) return null
  const msgs = Array.isArray((c as any).messages) ? (c as any).messages : []
  const createdAt = Number((c as any).createdAt || now())
  const updatedAt = Number((c as any).updatedAt || createdAt || now())
  const lastMid = msgs.length ? String((msgs[msgs.length - 1] as any)?.id || '') : ''
  const branching = normalizeChatBranching((c as any).branching, lastMid, createdAt, updatedAt)
  ;(c as any).branching = branching
  return branching
}

export function findChatBranch(chat: any, branchId: string) {
  const branching = ensureChatBranching(chat)
  if (!branching) return null
  const bid = normalizeBranchId(branchId)
  const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
  return branches.find((b: any) => String(b?.id || '') === bid) || null
}

// activeBranchHeadMid 是“当前活动分支头部节点”的唯一读取定义。
// 只回答“活动分支记的头部是谁”，不做任何回落；缺失即返回空串。
export function activeBranchHeadMid(chat: any): string {
  const branching = chat && typeof chat === 'object' ? (chat as any).branching : null
  if (!branching || typeof branching !== 'object') return ''
  const bid = normalizeBranchId((branching as any).activeBranchId)
  const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
  const branch = branches.find((b: any) => String(b?.id || '') === bid) || null
  return String((branch as any)?.headMid || '').trim()
}

// activeBranchHeadMidOrLast 是“活动分支头部，缺失时回落最后一条消息”的读取定义。
export function activeBranchHeadMidOrLast(chat: any): string {
  const headMid = activeBranchHeadMid(chat)
  if (headMid) return headMid
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  return messages.length ? String(messages[messages.length - 1]?.id || '').trim() : ''
}

export type BranchHeadFactInput = {
  // 运行期已经前推、但可能尚未落盘的头部（runtime-transient）。
  runtimeHead?: unknown
  // 服务端快照里的头部（server-fact）。
  serverHead?: unknown
  // 本地投影兜底（例如消息列表末端）。
  localProjectionHead?: unknown
  // 头部必须仍然存在于当前消息集合里。
  isAvailable?: (mid: string) => boolean
  // 头部消息的时间，用于「分支头只前进」约束。
  // 必须按来源分别取时间：运行期头来自本地对象，服务端头来自快照对象，
  // 同一个 id 在两边的 updatedAt 可能不同。
  timeOf?: (mid: string, side: 'runtime' | 'server') => number
}

// resolveBranchHeadFact 是「分支头」的唯一优先级规则。
//
// 默认顺序仍是 运行期临时态 > 服务端事实 > 本地投影，但分支头额外带一条
// 只前进约束：服务端已经给出更新的头时，运行期旧头不能把视图拉回去。
// 这条时间例外必须在这里显式表达，调用点不得再各写一遍。
export function resolveBranchHeadFact(input: BranchHeadFactInput): string {
  const available = (mid: string) => !!mid && (typeof input.isAvailable !== 'function' || input.isAvailable(mid))
  const timeOf = (mid: string, side: 'runtime' | 'server') => {
    const value = Number(input.timeOf?.(mid, side) || 0)
    return Number.isFinite(value) ? value : 0
  }
  const runtimeHead = String(input.runtimeHead || '').trim()
  const serverHead = String(input.serverHead || '').trim()
  const localHead = String(input.localProjectionHead || '').trim()

  if (available(runtimeHead)) {
    // 分支头只前进：服务端头部更新时，以服务端为准。
    if (!available(serverHead) || timeOf(serverHead, 'server') <= timeOf(runtimeHead, 'runtime')) return runtimeHead
  }
  if (available(serverHead)) return serverHead
  if (available(localHead)) return localHead
  return ''
}

export function ensureChatBranch(chat: any, branchId: string) {
  const branching = ensureChatBranching(chat)
  if (!branching) return null
  return ensureBranchInBranching(branching, branchId)
}

export function setChatActiveBranchId(chat: any, branchId: string) {
  writeChatBranchingState(chat, { activeBranchId: branchId })
}

// activateChatBranch 在切换活动分支的同时，仅当目标分支还没有头部时补齐头部。
// 用于“切到某条兄弟回复”的场景：已有头部不能被切换动作回退。
export function activateChatBranch(chat: any, branchId: string, options?: { headIfEmptyMid?: string }) {
  const bid = normalizeBranchId(branchId)
  const branching = ensureChatBranching(chat)
  if (!branching) return false
  const branch = ensureBranchInBranching(branching, bid)
  const existingHeadMid = String((branch as any)?.headMid || '').trim()
  const resolvedHeadMid = resolveBranchHeadFact({
    serverHead: existingHeadMid,
    localProjectionHead: options?.headIfEmptyMid,
  })
  const heads =
    branch && resolvedHeadMid && resolvedHeadMid !== existingHeadMid
      ? [{ branchId: bid, headMid: resolvedHeadMid }]
      : undefined
  return writeChatBranchingState(chat, { activeBranchId: bid, heads })
}

export function setChatBranchHeadMid(
  chat: any,
  branchId: string,
  headMid: string,
  options?: { updatedAt?: number; touchUpdatedAt?: boolean },
) {
  const updatedAt =
    options?.updatedAt !== undefined
      ? Number(options.updatedAt)
      : options?.touchUpdatedAt === false
        ? undefined
        : Number((chat as any)?.updatedAt || now())
  writeChatBranchingState(chat, { heads: [{ branchId, headMid, updatedAt }] })
}

export function collectChatMessageIds(chat: any) {
  const ids = new Set<string>()
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  for (const message of messages) {
    const id = String(message?.id || '').trim()
    if (id) ids.add(id)
  }
  return ids
}

function chatMessageTree(chat: any) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  const byId = new Map<string, any>()
  const children = new Map<string, string[]>()
  for (const message of messages) {
    const id = String(message?.id || '').trim()
    if (!id || byId.has(id)) continue
    byId.set(id, message)
  }
  for (const message of messages) {
    const id = String(message?.id || '').trim()
    const parentMid = String((message as any)?.parentMid || '').trim()
    if (!id || !parentMid || !byId.has(parentMid)) continue
    const list = children.get(parentMid) || []
    list.push(id)
    children.set(parentMid, list)
  }
  return { messages, byId, children }
}

function messagePathContains(byId: Map<string, any>, headMid: any, targetMid: any) {
  const target = String(targetMid || '').trim()
  let cur = String(headMid || '').trim()
  if (!target || !cur) return false
  const seen = new Set<string>()
  let guard = 0
  while (cur && !seen.has(cur) && guard < 6000) {
    guard++
    if (cur === target) return true
    seen.add(cur)
    const message = byId.get(cur) || null
    if (!message) return false
    cur = String((message as any)?.parentMid || '').trim()
  }
  return false
}

function messageIsOnPathFrom(byId: Map<string, any>, messageMid: any, ancestorMid: any) {
  const ancestor = String(ancestorMid || '').trim()
  if (!ancestor) return true
  return messagePathContains(byId, messageMid, ancestor)
}

function messageSortValue(message: any) {
  const createdAt = Number(message?.createdAt || 0)
  const updatedAt = Number(message?.updatedAt || 0)
  return { createdAt: isFinite(createdAt) ? createdAt : 0, updatedAt: isFinite(updatedAt) ? updatedAt : 0, id: String(message?.id || '') }
}

// newestLeafDescendantMid 求“锚点之下最新的叶子节点”：即路径末端的规范定义。
// 它不关心“哪些是新消息”，只回答“从锚点往下，当前最末端在哪”。
// 运行产出节点、视图跟随目标都以此为准，避免多处各扫一遍。
// exclude：需要排除的节点集合（例如本次运行前就存在的旧消息）。
export function newestLeafDescendantMid(chat: any, ancestorMessageId?: any, preferredMessageId?: any, exclude?: Set<string>) {
  const { messages, byId, children } = chatMessageTree(chat)
  const ancestor = String(ancestorMessageId || '').trim()
  const skip = exclude instanceof Set ? exclude : null
  const candidates = messages.filter((message: any) => {
    const id = String(message?.id || '').trim()
    if (!id || (skip && skip.has(id))) return false
    if (!ancestor) return true
    return messageIsOnPathFrom(byId, id, ancestor)
  })
  if (!candidates.length) return ''

  const preferred = String(preferredMessageId || '').trim()
  const leaves = candidates.filter((message: any) => {
    const id = String(message?.id || '').trim()
    return id && !(children.get(id) || []).length
  })
  if (preferred && leaves.some((message: any) => String(message?.id || '').trim() === preferred)) return preferred

  const pool = leaves.length ? leaves : candidates
  pool.sort((left: any, right: any) => {
    const l = messageSortValue(left)
    const r = messageSortValue(right)
    if (l.createdAt !== r.createdAt) return l.createdAt - r.createdAt
    if (l.updatedAt !== r.updatedAt) return l.updatedAt - r.updatedAt
    return l.id.localeCompare(r.id)
  })
  return String(pool[pool.length - 1]?.id || '').trim()
}

// resolveRunFocusMid 是“一次运行的产出当前落在哪个节点”的唯一规范定义。
// 视图跟随目标与控制器分支激活都调用它，消除两处各算一遍的分歧。
// 运行记录里的 outputMid（最新产出消息）若是叶子则优先采纳；
// 否则回落到锚点之下的最新叶子（可排除运行前就存在的旧节点）。
export function resolveRunFocusMid(chat: any, run: { anchorMid?: any; outputMid?: any } | null | undefined, exclude?: Set<string>): string {
  if (!chat || !run) return ''
  const skip = exclude instanceof Set ? exclude : null
  const anchorMid = String(run.anchorMid || '').trim()
  const outputMid = String(run.outputMid || '').trim()
  // 产出必须长在这条运行的输入下面（输入本身，或输入的后代）。
  // 少了这条约束，后端把「会话最后一条」填进产出字段时，视线会被拽到别的分支末尾。
  const outputBelongs = !!outputMid && !(skip && skip.has(outputMid)) && isMessageUnder(chat, outputMid, anchorMid)
  if (outputBelongs && isLeafMessage(chat, outputMid)) return outputMid
  return newestLeafDescendantMid(chat, anchorMid, outputBelongs ? outputMid : '', exclude)
}

// isMessageUnder 判断 mid 是不是 ancestor 本身或它的后代；ancestor 为空表示不限制。
function isMessageUnder(chat: any, midRaw: any, ancestorRaw: any) {
  const mid = String(midRaw || '').trim()
  const ancestor = String(ancestorRaw || '').trim()
  if (!mid) return false
  if (!ancestor) return true
  if (mid === ancestor) return true
  const { byId } = chatMessageTree(chat)
  let current = String((byId.get(mid) as any)?.parentMid || '').trim()
  let guard = 0
  while (current && guard++ < 6000) {
    if (current === ancestor) return true
    current = String((byId.get(current) as any)?.parentMid || '').trim()
  }
  return false
}

// isLeafMessage 判断某节点是否存在且没有任何子节点。
export function isLeafMessage(chat: any, midRaw: any) {
  const mid = String(midRaw || '').trim()
  if (!mid || !findChatMessageById(chat, mid)) return false
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  for (const message of messages) {
    if (String(message?.parentMid || '').trim() === mid) return false
  }
  return true
}

export function activateChatBranchByMessage(chat: any, messageId: any) {
  const mid = String(messageId || '').trim()
  if (!chat || !mid) return false
  const { byId } = chatMessageTree(chat)
  const message = byId.get(mid) || null
  if (!message) return false

  const branching = ensureChatBranching(chat)
  if (!branching) return false
  const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
  if (!branches.length) return false

  const messageBranchId = normalizeBranchId((message as any)?.branchId || CHAT_DEFAULT_BRANCH_ID)
  const containingBranches = branches.filter((branch: any) => messagePathContains(byId, branch?.headMid, mid))
  const picked =
    containingBranches.find((branch: any) => normalizeBranchId(branch?.id) === messageBranchId) ||
    containingBranches.sort((left: any, right: any) => {
      const l = messageSortValue(byId.get(String(left?.headMid || '').trim()) || left)
      const r = messageSortValue(byId.get(String(right?.headMid || '').trim()) || right)
      if (l.createdAt !== r.createdAt) return r.createdAt - l.createdAt
      if (l.updatedAt !== r.updatedAt) return r.updatedAt - l.updatedAt
      return r.id.localeCompare(l.id)
    })[0]
  if (!picked) return false

  return writeChatBranchingState(chat, { activeBranchId: normalizeBranchId(picked.id) })
}

export function preserveLocalBranchSelection(nextChat: any, currentChat: any) {
  const next = nextChat && typeof nextChat === 'object' ? nextChat : null
  const current = currentChat && typeof currentChat === 'object' ? currentChat : null
  const currentBranching = current?.branching && typeof current.branching === 'object' ? current.branching : null
  const nextBranching = next?.branching && typeof next.branching === 'object' ? next.branching : null
  if (!next || !currentBranching || !nextBranching) return nextChat

  const activeBranchId = String(currentBranching.activeBranchId || '').trim()
  if (!activeBranchId) return nextChat

  const nextBranches = Array.isArray(nextBranching.branches) ? nextBranching.branches : []
  const currentBranches = Array.isArray(currentBranching.branches) ? currentBranching.branches : []
  const existsInNext = nextBranches.some((branch: any) => String(branch?.id || '').trim() === activeBranchId)
  if (!existsInNext) return nextChat

  const currentBranch = currentBranches.find((branch: any) => String(branch?.id || '').trim() === activeBranchId) || null
  const nextBranch = nextBranches.find((branch: any) => String(branch?.id || '').trim() === activeBranchId) || null
  const nextHeadMid = String(nextBranch?.headMid || '').trim()
  const currentHeadMid = String(currentBranch?.headMid || '').trim()
  // 活动分支是用户意图：本地已选中的分支优先于服务端快照。
  // 分支头则按事实规则：服务端头部优先，只有服务端为空时才由本地补齐。
  const resolvedHeadMid = resolveBranchHeadFact({
    serverHead: nextHeadMid,
    localProjectionHead: currentHeadMid,
  })
  const heads =
    nextBranch && resolvedHeadMid && resolvedHeadMid !== nextHeadMid
      ? [{ branchId: activeBranchId, headMid: resolvedHeadMid }]
      : undefined

  writeChatBranchingState(next, { activeBranchId, heads })
  return next
}

export function genUniqueBranchId(branching: any) {
  const branches = Array.isArray(branching?.branches) ? branching.branches : []
  const used = new Set<string>(branches.map((b: any) => normalizeBranchId(b?.id)))
  for (let i = 0; i < 12; i++) {
    const id = normalizeBranchId(uid('b'))
    if (!used.has(id)) return id
  }
  return normalizeBranchId(uid('b'))
}

export function findChatMessageById(chat: any, messageId: any) {
  const mid = String(messageId || '').trim()
  if (!mid) return null
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  return msgs.find((m: any) => m && typeof m === 'object' && String(m?.id || '') === mid) || null
}

// findPrevAssistantMidForAssistant 只按后台父子拓扑回溯上一轮助手消息：
// assistant.parentMid 指向用户消息，用户消息的 parentMid 才是上一轮助手。
// 绝不按数组顺序推断拓扑。
export function findPrevAssistantMidForAssistant(chat: any, assistantMid: any) {
  const mid = String(assistantMid || '').trim()
  if (!mid) return ''
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  const byId = new Map<string, any>()
  for (const m of msgs) {
    const id = String(m?.id || '').trim()
    if (id && !byId.has(id)) byId.set(id, m)
  }
  const target = byId.get(mid) || null
  if (!target || String(target?.role || '') !== 'assistant') return ''
  const userMid = String((target as any)?.parentMid || '').trim()
  const userMessage = userMid ? byId.get(userMid) || null : null
  if (!userMessage || String(userMessage?.role || '') !== 'user') return ''
  const prevAiMid = String((userMessage as any)?.parentMid || '').trim()
  const prevAi = prevAiMid ? byId.get(prevAiMid) || null : null
  return prevAi && String(prevAi?.role || '') === 'assistant' ? prevAiMid : ''
}

