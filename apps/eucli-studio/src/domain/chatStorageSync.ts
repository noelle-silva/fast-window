import { preserveLocalBranchSelection, resolveBranchHeadFact, setChatBranchHeadMid } from './branching'
import { replaceChatMessages } from './chatMessageCollection'
import {
  resolveChatMessageCollectionFact,
  resolveChatMessageFact,
  shouldPreserveRuntimeOnlyMessage,
} from './chatBodyPrecedence'
import { readChatRunStatus } from './chatSessionRunStatus'
import { clearRuntimeMarkersConfirmedBySnapshot } from './runtimeMessageMarker'
import { preserveSessionIdentity } from './sessionIdentity'

function messageId(value: any) {
  return String(value?.id || '').trim()
}

function setBranchHeadMid(chat: any, branchId: string, headMid: string) {
  const branches = Array.isArray(chat?.branching?.branches) ? chat.branching.branches : []
  const branch = branches.find((item: any) => String(item?.id || '').trim() === branchId) || null
  if (!branch) return
  setChatBranchHeadMid(chat, branchId, headMid, { updatedAt: Number(chat?.updatedAt || branch.updatedAt || 0) })
}

function messageTime(message: any) {
  const value = Number(message?.updatedAt || message?.createdAt || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function preserveRuntimeBranchHeads(nextChat: any, currentChat: any) {
  const nextMessages = Array.isArray(nextChat?.messages) ? nextChat.messages : []
  const nextIds = new Set(nextMessages.map((message: any) => messageId(message)).filter(Boolean))
  const nextById = new Map<string, any>()
  for (const message of nextMessages) {
    const id = messageId(message)
    if (id && !nextById.has(id)) nextById.set(id, message)
  }
  const branches = Array.isArray(currentChat?.branching?.branches) ? currentChat.branching.branches : []
  const currentMessages = Array.isArray(currentChat?.messages) ? currentChat.messages : []
  const currentById = new Map<string, any>()
  for (const message of currentMessages) {
    const id = messageId(message)
    if (id && !currentById.has(id)) currentById.set(id, message)
  }
  for (const branch of branches) {
    const branchId = String(branch?.id || '').trim()
    const headMid = String(branch?.headMid || '').trim()
    if (!branchId || !headMid || !nextIds.has(headMid)) continue
    const currentHead = currentById.get(headMid) || null
    if (!shouldPreserveRuntimeOnlyMessage(currentHead)) continue
    const nextBranch = (Array.isArray(nextChat?.branching?.branches) ? nextChat.branching.branches : []).find(
      (item: any) => String(item?.id || '').trim() === branchId,
    ) || null
    // 分支头规则统一裁决「运行期旧头 vs 服务端新头」：
    // 默认运行期优先，但服务端头部更新时只能前进、不能回退。
    const resolvedHeadMid = resolveBranchHeadFact({
      runtimeHead: headMid,
      serverHead: nextBranch?.headMid,
      isAvailable: (mid) => nextIds.has(mid),
      // 运行期头的时间取本地对象，服务端头的时间取快照对象：
      // 同一个 id 在两边可能有不同的 updatedAt。
      timeOf: (mid, side) => messageTime(side === 'runtime' ? currentById.get(mid) : nextById.get(mid)),
    })
    if (resolvedHeadMid !== headMid) continue
    setBranchHeadMid(nextChat, branchId, headMid)
  }
}

function mergeMessagesFromStorage(nextChat: any, currentChat: any) {
  const nextMessages = Array.isArray(nextChat?.messages) ? nextChat.messages : null
  const currentMessages = Array.isArray(currentChat?.messages) ? currentChat.messages : null
  if (!nextMessages || !currentMessages || !currentMessages.length) return

  // 裁决全部交给会话正文的规则：服务端快照决定集合成员资格，
  // 同 id 消息按「运行期独占 / 落盘事实 / 运行态合并」判定；
  // 本地独有消息只有显式运行期独占才允许补入（删除不复活）。
  // 后台快照一旦包含对应消息，运行期独占标记立即失效。
  clearRuntimeMarkersConfirmedBySnapshot(currentMessages, nextMessages)
  const mergedMessages = resolveChatMessageCollectionFact({
    serverMessages: nextMessages,
    localMessages: currentMessages,
    resolveMessage: (storedMessage: any, currentMessage: any) =>
      resolveChatMessageFact({
        serverMessage: storedMessage,
        localMessage: currentMessage,
        storedChatStatus: readChatRunStatus(nextChat),
      }),
    shouldKeepLocalMessage: shouldPreserveRuntimeOnlyMessage,
  })
  replaceChatMessages(nextChat, mergedMessages)
  preserveRuntimeBranchHeads(nextChat, currentChat)
}

export function mergeChatFromStorage(nextChat: any, currentChat: any) {
  const next = preserveLocalBranchSelection(nextChat, currentChat)
  if (!next || !currentChat || typeof next !== 'object' || typeof currentChat !== 'object') return next
  mergeMessagesFromStorage(next, currentChat)
  // 窗口切片不承担会话级事实：标题与创建时间以已加载会话为准（它来自索引事实），
  // 更新时间只能前进（写路径刚产生的更新不能被稍旧的切片回退）。
  // 这样即便切片被归一化时填了「新聊天」/now() 兜底，也覆盖不掉已有真实事实。
  if ((next as any).windowPartial === true) preserveSessionIdentity(next, currentChat)
  if ((next as any).runtimePartial) delete (next as any).runtimePartial
  return next
}

export function isStoredChatNewerThanCurrent(storedUpdatedAtRaw: any, currentUpdatedAtRaw: any) {
  const storedUpdatedAt = Number(storedUpdatedAtRaw || 0)
  const currentUpdatedAt = Number(currentUpdatedAtRaw || 0)
  if (!Number.isFinite(storedUpdatedAt) || storedUpdatedAt <= 0) return false
  if (!Number.isFinite(currentUpdatedAt) || currentUpdatedAt <= 0) return true
  return storedUpdatedAt > currentUpdatedAt
}
