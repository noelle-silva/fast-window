export const MESSAGE_BATCH_INITIAL_SIZE = 5
export const MESSAGE_BATCH_SIZE = 10
export const MESSAGE_BATCH_YIELD_MS = 80

export type MessageBatch = {
  key: string
  ids: string[]
}

export type MessageBatchGroup = {
  key: string
  messages: any[]
  revealed: boolean
}

export type MessageBatchPlan = {
  anchorId: string
  anchorIndex: number
  batches: MessageBatch[]
}

function messageId(message: any) {
  return String(message?.id || '').trim()
}

export function planMessageBatchMount(
  messages: any[],
  options?: { initialSize?: number; batchSize?: number },
): MessageBatchPlan {
  const total = Array.isArray(messages) ? messages.length : 0
  const initialSize = Math.max(1, Math.floor(Number(options?.initialSize ?? MESSAGE_BATCH_INITIAL_SIZE) || 1))
  const batchSize = Math.max(1, Math.floor(Number(options?.batchSize ?? MESSAGE_BATCH_SIZE) || 1))
  const anchorIndex = Math.max(0, total - initialSize)
  const anchorId = total ? messageId(messages[anchorIndex]) : ''
  const batches: MessageBatch[] = []

  for (let end = anchorIndex; end > 0; end -= batchSize) {
    const start = Math.max(0, end - batchSize)
    const ids: string[] = []
    for (let i = start; i < end; i++) {
      const id = messageId(messages[i])
      if (id) ids.push(id)
    }
    if (!ids.length) continue
    batches.push({ key: `message-batch:${start}:${end}`, ids })
  }

  return { anchorId, anchorIndex, batches }
}
