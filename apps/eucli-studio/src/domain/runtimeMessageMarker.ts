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

export function clearRuntimeMarkersConfirmedBySnapshot(
  localMessages: readonly any[],
  serverMessages: readonly any[],
): boolean {
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
