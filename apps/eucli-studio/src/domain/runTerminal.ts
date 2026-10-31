import { finishAssistantRun, isAssistantGenerating, normalizeAssistantRunState, type AssistantRunStatus } from './assistantRunState'
import { markRunSettled, removeEbRoleRunCard, settledRunStatus, type EbRoleRunCard } from './activeRunCards'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

// 运行终态的单一收敛点。
//
// 「这次运行结束了吗」只有一个权威来源：box 的 run 状态（终态事件 / 探针快照）。
// 但界面依赖的派生事实不止一处：
//   - activeRunCards      → 停止按钮、尾部占位
//   - message.assistantRun → 该条消息的「生成中」标记与加载圈
//   - chat.status          → 会话列表运行指示
// 过去只有 run 卡被收敛，消息状态依赖另一条 `assistant_message_update` 事件。
// 该事件不是终态事件（事件队列只按顶层 type 判定终态），背压下允许被丢弃，
// 于是 run 卡没了、消息却永远停在「生成中」——这就是「停止按钮/占位常转」与
// 「消息只剩占位」的结构性来源。
//
// 因此这里把「终态事实」一次性投影到全部派生事实：任何终态来源（事件、探针、
// 写路径收尾、启动恢复）都只调用本模块，禁止各自再写一份。

export type RunTargetKind = 'role' | 'group' | 'workspace'

export type RunTerminalInput = {
  runId: string
  status: string
  roleId?: string
  groupId?: string
  workspaceId?: string
  sessionId?: string
  // 已知归属消息（run 卡的 lastMessageId / 事件消息 id）。
  // 即使消息缺少 assistantRun 元数据，也按它收敛。
  messageIds?: Iterable<string>
  atMs?: number
}

export function assistantRunStatusFromRunStatus(value: unknown): AssistantRunStatus | null {
  const status = String(value || '').trim()
  if (status === 'completed' || status === 'succeeded') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled' || status === 'canceled') return 'canceled'
  return null
}

export function resolveRunTarget(roleIdRaw: unknown, groupIdRaw: unknown, workspaceIdRaw: unknown): { targetKind: RunTargetKind; targetId: string } {
  const roleId = String(roleIdRaw || '').trim()
  const groupId = String(groupIdRaw || '').trim()
  const workspaceId = String(workspaceIdRaw || '').trim()
  if (workspaceId) return { targetKind: 'workspace', targetId: workspaceRoleTargetId(workspaceId, roleId) || workspaceId }
  if (groupId) return { targetKind: 'group', targetId: groupId }
  return { targetKind: 'role', targetId: roleId }
}

function chatBoxFor(state: any, targetKind: RunTargetKind, targetId: string) {
  if (!state?.data || !targetId) return null
  if (targetKind === 'group') return state.data.chatsByGroup?.[targetId] || null
  if (targetKind === 'workspace') return (state.data as any).chatsByWorkspace?.[targetId] || null
  return state.data.chatsByRole?.[targetId] || null
}

// settleAssistantMessagesForRun 把一条 run 的全部助手消息收敛到终态。
//
// 归属判定有两个独立证据，任一命中即收敛：
//   1. message.assistantRun.generationId === runId（运行期写入的身份）；
//   2. 消息 id 在调用方给出的归属集合里（run 卡的 lastMessageId）。
// 只收敛「仍在生成中」的消息：已落定的消息保持原样，绝不改写已终态事实。
// 这让本函数天然幂等——重复调用不会产生第二次变化。
export function settleAssistantMessagesForRun(
  chat: any,
  input: Pick<RunTerminalInput, 'runId' | 'status' | 'messageIds' | 'atMs'>,
): boolean {
  const messages = Array.isArray(chat?.messages) ? chat.messages : null
  if (!messages) return false
  const runId = String(input.runId || '').trim()
  if (!runId) return false
  const runStatus = assistantRunStatusFromRunStatus(input.status)
  if (!runStatus) return false
  const owned = new Set<string>()
  for (const id of input.messageIds || []) {
    const mid = String(id || '').trim()
    if (mid) owned.add(mid)
  }
  const at = Number(input.atMs || 0)
  let changed = false
  for (const message of messages) {
    if (!message || message.role !== 'assistant') continue
    const generationId = normalizeAssistantRunState(message.assistantRun)?.generationId || ''
    const mid = String(message.id || '').trim()
    const belongs = generationId === runId || (!!mid && owned.has(mid))
    if (!belongs) continue
    // 已落定：不改写。后到的终态（探针与事件措辞可能不同）不得翻案。
    if (!isAssistantGenerating(message)) continue
    if (finishAssistantRun(message, message.content, runStatus, at > 0 ? at : undefined)) changed = true
  }
  return changed
}

// settleRunInState 是终态收敛的唯一入口：
//   1. 摘除 run 卡（同时登记终态闩锁，迟到事件不能复活它）；
//   2. 收敛该 run 的助手消息；
//   3. 重算会话运行状态。
//
// 第一条终态胜出：同一条 run 的后续终态（探针与事件措辞可能不同）不得翻案，
// 一律以已登记的终态为准。重复调用仍然安全：每一步都只改「还没收敛」的事实，
// 因此对已收敛的界面是空操作（返回 false）。
export function settleRunInState(state: any, input: RunTerminalInput, card?: EbRoleRunCard | null): boolean {
  const runId = String(input.runId || '').trim()
  if (!runId || !state?.data) return false
  // 非终态不得登记终态台账：先校验，再落闩锁，避免把运行中的 run 永久锁死。
  if (!assistantRunStatusFromRunStatus(input.status)) return false
  markRunSettled(state, runId, input.status, input.atMs)
  // 第一条终态胜出：后到的措辞不得翻案，一律以已登记的终态为准。
  const status = settledRunStatus(state, runId) || String(input.status || '').trim()
  const roleId = String(input.roleId || card?.roleId || '').trim()
  const groupId = String(input.groupId || card?.groupId || '').trim()
  const workspaceId = String(input.workspaceId || card?.workspaceId || '').trim()
  const sessionId = String(input.sessionId || card?.sessionId || '').trim()
  const messageIds = new Set<string>()
  for (const id of input.messageIds || []) {
    const mid = String(id || '').trim()
    if (mid) messageIds.add(mid)
  }
  for (const id of [card?.lastMessageId, card?.anchorMessageId, card?.inputMessageId]) {
    const mid = String(id || '').trim()
    if (mid) messageIds.add(mid)
  }

  const removed = removeEbRoleRunCard(state, runId) || card || null

  const { targetKind, targetId } = resolveRunTarget(roleId, groupId, workspaceId)
  const box = chatBoxFor(state, targetKind, targetId)
  const chats = Array.isArray(box?.chats) ? box.chats : []
  let changed = !!removed
  for (const chat of chats) {
    if (sessionId && String(chat?.id || '').trim() !== sessionId) continue
    if (settleAssistantMessagesForRun(chat, { runId, status, messageIds, atMs: input.atMs })) changed = true
    // 会话运行状态：仍有活动卡就是 running，否则以本次终态收口。
    const remaining = Array.isArray(state.activeRunCards) ? state.activeRunCards.filter((item: any) => String(item?.sessionId || '') === String(chat?.id || '')) : []
    const nextStatus = remaining.length ? String(remaining[remaining.length - 1]?.status || 'running').trim() || 'running' : status
    if (nextStatus && String(chat?.status || '') !== nextStatus) {
      chat.status = nextStatus
      changed = true
    }
  }
  return changed
}

// settleRunByCard 供「只有 run 卡、没有完整 run 状态」的收尾路径使用
// （例如发送流程的 finally）。它用卡上已有归属信息完成收敛。
export function settleRunByCard(state: any, card: EbRoleRunCard | null | undefined, status: string): boolean {
  if (!card) return false
  return settleRunInState(state, {
    runId: card.runId,
    status,
    roleId: card.roleId,
    groupId: card.groupId,
    workspaceId: card.workspaceId,
    sessionId: card.sessionId,
    messageIds: [card.lastMessageId, card.anchorMessageId, card.inputMessageId],
  }, card)
}
