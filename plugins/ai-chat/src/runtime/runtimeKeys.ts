export const ASSISTANT_STREAM_KEY_PREFIX = 'bg.stream.'
export const ENGINE_FINAL_KEY_PREFIX = 'engine.v1/final/'
export const ENGINE_MID_RUN_KEY_PREFIX = 'engine.v1/mid-run/'
export const ENGINE_PROGRESS_KEY_PREFIX = 'engine.v1/progress/'
export const UI_CHAT_UPDATED_NOTICE_KEY = 'ui/notice/chat-updated'

function requireRuntimeId(value: unknown, label: string) {
  const id = String(value || '').trim()
  if (!id) throw new Error(`${label} 不能为空`)
  return id
}

export function assistantStreamKey(assistantMid: unknown) {
  return `${ASSISTANT_STREAM_KEY_PREFIX}${String(assistantMid || '')}`
}

export function assistantFinalKey(assistantMid: unknown) {
  return `${ENGINE_FINAL_KEY_PREFIX}${requireRuntimeId(assistantMid, 'assistantMid')}`
}

export function assistantMidRunKey(assistantMid: unknown) {
  return `${ENGINE_MID_RUN_KEY_PREFIX}${requireRuntimeId(assistantMid, 'assistantMid')}`
}

export function isStrongConsistencyRuntimeKey(key: unknown) {
  const value = String(key || '')
  return value.startsWith('engine.v1/') && !value.startsWith(ENGINE_PROGRESS_KEY_PREFIX)
}
