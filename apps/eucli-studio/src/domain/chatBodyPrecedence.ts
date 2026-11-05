// 「会话正文」的事实优先级规则。
//
// 消息事实只有一个权威来源：后台快照（server-fact）。
// 前端视图 = 后台快照整体覆盖 + 最上层「回复生成期间的临时遮罩」。
//
//   - 同 id 冲突：后台消息整体覆盖本地消息，不逐字段对账、不做本地胜负裁决；
//   - 临时遮罩：仅当本地消息仍处于回复生成期间（runtimeOnly），才允许覆盖显示字段；
//     消息身份、顺序与父子拓扑字段仍取后台消息；
//   - 消息集合：成员资格与顺序只由后台快照决定；后台还没有的在途消息
//     只是遮罩补入显示，不构成事实（删除不会因为本地在途而复活）。
//
// 字段层（content / parts / assistantRun ...）没有独立的跨来源优先级：
// 整条消息的归属先在这里裁定，写入统一走 chatMessageFields。

import { isRuntimeMessageInFlight } from './runtimeMessageMarker'

function messageIdOf(message: any): string {
  return String(message?.id || '').trim()
}

// 临时遮罩不得改写后台事实里的身份、顺序与父子拓扑。
const RUNTIME_OVERLAY_TOPOLOGY_FIELDS = new Set(['id', 'parentMid', 'branchId', 'createdAt'])

// applyRuntimeMessageOverlay 把在途临时状态叠到后台消息之上：
// 显示字段取本地在途值，身份 / 顺序 / 拓扑仍取后台快照。
function applyRuntimeMessageOverlay(serverMessage: any, localMessage: any): any {
  const out = { ...serverMessage }
  const source = localMessage && typeof localMessage === 'object' ? localMessage : {}
  for (const key of Object.keys(source)) {
    if (RUNTIME_OVERLAY_TOPOLOGY_FIELDS.has(key)) continue
    out[key] = source[key]
  }
  return out
}

// shouldPreserveRuntimeOnlyMessage 判断一条本地消息能否作为临时遮罩补入视图。
//
// 判据只有「回复生成期间」这一条：在途标记在终态收敛与后台快照确认时清除。
// 遮罩不构成事实，因此不按来源、材料类型或可见产出另设保留条件。
export function shouldPreserveRuntimeOnlyMessage(message: any): boolean {
  return isRuntimeMessageInFlight(message)
}

export type ChatMessageFactInput = {
  // 存储快照里的同一 id 消息（server-fact）。
  serverMessage: any
  // 本地内存里的同一 id 消息（可能是 runtime-transient）。
  localMessage: any
}

// resolveChatMessageFact 是「同 id 单条消息」的唯一裁决规则：
// 后台消息整体覆盖本地视图；唯一例外是在途临时遮罩。
export function resolveChatMessageFact(input: ChatMessageFactInput): any {
  const serverMessage = input.serverMessage
  const localMessage = input.localMessage
  if (!localMessage) return serverMessage
  if (!serverMessage) return localMessage
  if (!isRuntimeMessageInFlight(localMessage)) return serverMessage
  return applyRuntimeMessageOverlay(serverMessage, localMessage)
}

export type ChatMessageCollectionFactInput = {
  // 服务端快照消息（集合成员资格与顺序的权威来源）。
  serverMessages: any[]
  // 本地已知消息（可能包含尚未落盘的在途临时状态）。
  localMessages: any[]
}

// resolveChatMessageCollectionFact 是「消息集合」的唯一裁决规则：
//   - 成员资格与顺序以服务端快照为准；
//   - 同 id 消息按 resolveChatMessageFact 裁决（后台覆盖 / 在途遮罩）；
//   - 服务端还没有的在途消息才允许遮罩补入，追加在末尾。
export function resolveChatMessageCollectionFact(input: ChatMessageCollectionFactInput): any[] {
  const serverMessages = Array.isArray(input.serverMessages) ? input.serverMessages : []
  const localMessages = Array.isArray(input.localMessages) ? input.localMessages : []
  const localById = new Map<string, any>()
  for (const message of localMessages) {
    const id = messageIdOf(message)
    if (id && !localById.has(id)) localById.set(id, message)
  }

  const merged = serverMessages.map((serverMessage: any) => {
    const localMessage = localById.get(messageIdOf(serverMessage)) || null
    return localMessage ? resolveChatMessageFact({ serverMessage, localMessage }) : serverMessage
  })

  const ids = new Set(merged.map(messageIdOf).filter(Boolean))
  for (const localMessage of localMessages) {
    const id = messageIdOf(localMessage)
    if (!id || ids.has(id)) continue
    if (!shouldPreserveRuntimeOnlyMessage(localMessage)) continue
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
