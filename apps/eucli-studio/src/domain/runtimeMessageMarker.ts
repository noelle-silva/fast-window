import { writeChatMessageFields } from './chatMessageFields'

export function isRuntimeMessageInFlight(message: any): boolean {
  return message?.runtimeOnly === true
}

export function markRuntimeMessageInFlight(message: any): boolean {
  if (!message || typeof message !== 'object') return false
  return writeChatMessageFields(message, { runtimeOnly: true })
}

export function clearRuntimeMessageMarker(message: any): boolean {
  if (!message || typeof message !== 'object' || !isRuntimeMessageInFlight(message)) return false
  return writeChatMessageFields(message, { runtimeOnly: false })
}

function messageIdOf(message: any): string {
  return String(message?.id || '').trim()
}

// clearRuntimeMarkersConfirmedBySnapshot 让「后台已收口」的在途标记失效。
//
// 在途临时状态只在回复生成期间保留：后台快照的会话仍在生成时，
// 快照里的旧页不得提前终结遮罩；只有会话已收口，标记才退出。
export function clearRuntimeMarkersConfirmedBySnapshot(
  localMessages: readonly any[],
  serverMessages: readonly any[],
  options?: { serverRunActive?: boolean },
): boolean {
  if (options?.serverRunActive) return false
  const serverIds = new Set<string>()
  for (const message of serverMessages || []) {
    const id = messageIdOf(message)
    if (id) serverIds.add(id)
  }
  if (!serverIds.size) return false
  let changed = false
  for (const message of localMessages || []) {
    if (!serverIds.has(messageIdOf(message))) continue
    if (clearRuntimeMessageMarker(message)) changed = true
  }
  return changed
}
