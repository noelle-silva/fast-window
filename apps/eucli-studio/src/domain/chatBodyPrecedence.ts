// 「会话正文」的事实优先级规则。
//
// 会话正文有两层事实：
//   1. 单条消息：同 id 的存储快照（server-fact）与本地运行期消息
//      （runtime-transient）冲突时，谁代表更新的事实；
//   2. 消息集合：哪些消息允许存在，删除的消息不能被旧快照复活。
//
// 字段层（content / parts / assistantRun ...）没有独立的跨来源优先级：
// 整条消息的归属先在这里裁定，写入统一走 chatMessageFields。
// 因此本模块不提供「字段级 LWW」，字段写入只允许幂等补丁。

import {
  hasAssistantVisibleOutput,
  isAssistantGenerating,
  resolveAssistantMessageForMerge,
} from './assistantRunState'
import { CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT, chatMessageMaterialKind, isAssistantTextChatMessage } from './message'

function messageIdOf(message: any): string {
  return String(message?.id || '').trim()
}

function hasSameMaterialKind(left: any, right: any) {
  return chatMessageMaterialKind(left) === chatMessageMaterialKind(right)
}

// 材料身份冲突（普通消息 vs 异步工具结果）只有一个方向：
// 双方谁都不是对方可替代的投影，异步工具结果是更强的产物，保留它；
// 否则以服务端快照为准。
function resolveMaterialIdentityConflict(currentMessage: any, storedMessage: any) {
  const currentKind = chatMessageMaterialKind(currentMessage)
  const storedKind = chatMessageMaterialKind(storedMessage)
  if (currentKind === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return currentMessage
  if (storedKind === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return storedMessage
  return storedMessage
}

// shouldPreserveRuntimeOnlyMessage 判断一条本地消息是否必须保留。
//
// 「运行期独占」消息 = 由运行事件就地创建、存储快照里还没有的消息。
// 判定必须基于这个显式身份（runtimeOnly），而不是「是否还在生成」：
//   - 用 generating 判定：终态一收敛标记就关掉，窗口刷新若拿到落盘前的旧页，
//     已显示的最终回复会凭空消失，只剩占位；
//   - 用「有可见产出」判定：已删除的消息会被重新捞回来（复活）。
export function shouldPreserveRuntimeOnlyMessage(message: any): boolean {
  const kind = chatMessageMaterialKind(message)
  if (kind === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return true
  if (!isAssistantTextChatMessage(message)) return false
  if (message?.runtimeOnly !== true) return false
  if (hasAssistantVisibleOutput(message)) return true
  return !!(message?.error && typeof message.error === 'object')
}

export type ChatMessageFactInput = {
  // 存储快照里的同一 id 消息（server-fact）。
  serverMessage: any
  // 本地内存里的同一 id 消息（可能是 runtime-transient）。
  localMessage: any
  // 存储会话的原始状态，用于判断服务端是否已经收口。
  storedChatStatus?: unknown
}

// resolveChatMessageFact 是「同 id 单条消息」的唯一裁决规则。
//
// 顺序与例外：
//   - 材料身份冲突：异步工具结果优先，其余以服务端为准；
//   - 非助手文本消息：以服务端为准；
//   - 本地运行期独占消息：服务端若只是旧占位，本地保留；
//     服务端已完整且本地更旧，则服务端胜出；
//   - 双方都已收敛：服务端胜出（落盘事实）；
//   - 仍有一方在生成：交给运行态合并规则（同一 run 取更新者）。
export function resolveChatMessageFact(input: ChatMessageFactInput): any {
  const currentMessage = input.localMessage
  const storedMessage = input.serverMessage
  if (!currentMessage) return storedMessage
  if (!storedMessage) return currentMessage
  if (!hasSameMaterialKind(currentMessage, storedMessage)) {
    return resolveMaterialIdentityConflict(currentMessage, storedMessage)
  }
  if (!isAssistantTextChatMessage(currentMessage) || !isAssistantTextChatMessage(storedMessage)) return storedMessage

  if (currentMessage.runtimeOnly === true) {
    const currentAt = Number(currentMessage.updatedAt || 0)
    const storedAt = Number(storedMessage.updatedAt || 0)
    // 服务端快照是否已经包含可用的最终产出。
    const storedComplete =
      hasAssistantVisibleOutput(storedMessage) || !!(storedMessage?.error && typeof storedMessage.error === 'object')
    if (!storedComplete) return currentMessage
    if (currentAt > storedAt) return currentMessage
  }

  if (!isAssistantGenerating(currentMessage) && !isAssistantGenerating(storedMessage)) return storedMessage
  return resolveAssistantMessageForMerge(currentMessage, storedMessage, {
    storedChatStatus: input.storedChatStatus,
  })
}

export type ChatMessageCollectionFactInput = {
  // 服务端快照消息（集合成员资格的权威来源）。
  serverMessages: any[]
  // 本地已知消息（运行期合并时会包含尚未落盘的消息）。
  localMessages: any[]
  // 同 id 消息的裁决函数；缺省走 resolveChatMessageFact。
  resolveMessage?: (serverMessage: any, localMessage: any) => any
  // 本地独有消息是否允许补入集合；缺省不允许。
  shouldKeepLocalMessage?: (message: any) => boolean
}

// resolveChatMessageCollectionFact 是「消息集合」的唯一裁决规则。
//
//   - 集合成员资格以服务端为准：本地有、服务端没有的消息默认不保留
//     （删除不会因为一份旧本地文档而复活）；
//   - 只有显式运行期独占的消息才允许补入集合；
//   - 顺序以服务端快照为主，补入的本地消息追加在末尾。
export function resolveChatMessageCollectionFact(input: ChatMessageCollectionFactInput): any[] {
  const serverMessages = Array.isArray(input.serverMessages) ? input.serverMessages : []
  const localMessages = Array.isArray(input.localMessages) ? input.localMessages : []
  const localById = new Map<string, any>()
  for (const message of localMessages) {
    const id = messageIdOf(message)
    if (id && !localById.has(id)) localById.set(id, message)
  }

  const resolveMessage = input.resolveMessage
    || ((serverMessage: any, localMessage: any) => resolveChatMessageFact({ serverMessage, localMessage }))

  const merged = serverMessages.map((serverMessage: any) => {
    const localMessage = localById.get(messageIdOf(serverMessage)) || null
    return localMessage ? resolveMessage(serverMessage, localMessage) : serverMessage
  })

  const ids = new Set(merged.map(messageIdOf).filter(Boolean))
  for (const localMessage of localMessages) {
    const id = messageIdOf(localMessage)
    if (!id || ids.has(id)) continue
    if (input.shouldKeepLocalMessage && !input.shouldKeepLocalMessage(localMessage)) continue
    merged.push(localMessage)
    ids.add(id)
  }
  return merged
}

export type ChatMessageUnionFactInput = {
  // 权威一侧（例如新取回的服务端窗口页）。
  authoritative: any[]
  // 次级一侧（例如本地已加载的历史）。
  secondary: any[]
}

// resolveChatMessageUnionFact 是「窗口分页拼装」的唯一裁决规则：
// 同一 id 以权威一侧为准，次级一侧只补权威一侧没有的消息。
// 返回值保持权威一侧的顺序，再追加次级独有项。
export function resolveChatMessageUnionFact(input: ChatMessageUnionFactInput): any[] {
  const out: any[] = []
  const seen = new Set<string>()
  for (const message of [...(input.authoritative || []), ...(input.secondary || [])]) {
    const id = messageIdOf(message)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(message)
  }
  return out
}
