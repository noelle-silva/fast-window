import { preserveLocalBranchSelection, resolveBranchHeadFact, setChatBranchHeadMid } from './branching'
import { replaceChatMessages } from './chatMessageCollection'
import { resolveChatMessageCollectionFact, shouldPreserveRuntimeOnlyMessage } from './chatBodyPrecedence'
import { readChatRunStatus, normalizeChatSessionRunStatus } from './chatSessionRunStatus'
import { clearRuntimeMarkersConfirmedBySnapshot } from './runtimeMessageMarker'
import { preserveSessionIdentity } from './sessionIdentity'

function serverRunActive(chat: any): boolean {
  const status = readChatRunStatus(chat)
  // 窗口切片可能不带会话状态：未知不算收口，在途临时状态继续保留。
  return !status || normalizeChatSessionRunStatus(status) === 'running'
}

function messageId(value: any) {
  return String(value?.id || '').trim()
}

function messageTime(message: any) {
  const value = Number(message?.updatedAt || message?.createdAt || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

// preserveRuntimeBranchHeads 是视窗偏好的保护，不是消息事实裁决：
// 用户正在看一条「回复生成期间的在途消息」时，后台旧页不得把视图拉回旧节点。
// 分支头只写在内存视图里，不参与消息存留、顺序或父子拓扑的判定。
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
    // 分支头只前进：服务端头部更新时以服务端为准，视图偏好不把它拉回去。
    const resolvedHeadMid = resolveBranchHeadFact({
      runtimeHead: headMid,
      serverHead: nextBranch?.headMid,
      isAvailable: (mid) => nextIds.has(mid),
      timeOf: (mid, side) => messageTime(side === 'runtime' ? currentById.get(mid) : nextById.get(mid)),
    })
    if (resolvedHeadMid !== headMid) continue
    setChatBranchHeadMid(nextChat, branchId, headMid)
  }
}

function mergeMessagesFromStorage(nextChat: any, currentChat: any) {
  const nextMessages = Array.isArray(nextChat?.messages) ? nextChat.messages : null
  const currentMessages = Array.isArray(currentChat?.messages) ? currentChat.messages : null
  if (!nextMessages || !currentMessages || !currentMessages.length) return

  // 后台快照是消息事实的唯一权威：集合成员资格与顺序整体由快照决定，
  // 同 id 消息直接以后台版本覆盖前端视图。
  // 前端只保留回复生成期间的在途临时状态作为最上层遮罩：
  // 后台仍在生成时，旧页不得提前终结遮罩；会话收口后标记立即失效。
  clearRuntimeMarkersConfirmedBySnapshot(currentMessages, nextMessages, { serverRunActive: serverRunActive(nextChat) })
  replaceChatMessages(nextChat, resolveChatMessageCollectionFact({
    serverMessages: nextMessages,
    localMessages: currentMessages,
  }))
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
