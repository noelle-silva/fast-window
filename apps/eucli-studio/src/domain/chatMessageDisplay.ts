import { ASSISTANT_RUNNING_CONTENT, assistantRunGenerationId } from './assistantRunState'

export function messageVisibleText(message: any) {
  const raw = String(message?.content || '')
  if (String(message?.role || '') === 'assistant' && raw.trim() === ASSISTANT_RUNNING_CONTENT) return ''
  return raw
}

export function isStaleAssistantPlaceholder(message: any, hasActiveRun: boolean) {
  if (hasActiveRun) return false
  if (String(message?.role || '') !== 'assistant') return false
  if (String(message?.content || '').trim() !== ASSISTANT_RUNNING_CONTENT) return false
  if (Array.isArray(message?.parts) && message.parts.length) return false
  return !(message?.error && typeof message.error === 'object')
}

export function activeRunCardForAssistantMessage(cards: any[], message: any) {
  const mid = String(message?.id || '').trim()
  const generationId = assistantRunGenerationId(message)
  if (!mid && !generationId) return null
  return (Array.isArray(cards) ? cards : []).find((card: any) => String(card?.lastMessageId || '').trim() === mid || (generationId && String(card?.runId || '').trim() === generationId)) || null
}
