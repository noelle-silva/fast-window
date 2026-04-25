export const DEFAULT_TASK_HISTORY_LIMIT = 100
export const MAX_TASK_HISTORY_LIMIT = 500

export type AiDrawTaskHistoryStatus = 'pending' | 'succeeded' | 'failed' | 'canceled' | 'canceling'

export type AiDrawTaskHistoryItem = {
  id: string
  taskId: string
  mode: 'normal' | 'local-edit'
  requestAt: number
  updatedAt: number
  providerId: string
  providerName: string
  model: string
  prompt: string
  status: AiDrawTaskHistoryStatus
  success: boolean | null
  failureReason: string
}

export function normalizeTaskHistoryLimit(raw: any) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TASK_HISTORY_LIMIT
  const v = Math.floor(n)
  if (v < 1) return 1
  if (v > MAX_TASK_HISTORY_LIMIT) return MAX_TASK_HISTORY_LIMIT
  return v
}

export function normalizeTaskHistoryStatus(raw: any): AiDrawTaskHistoryStatus {
  const value = String(raw || '').trim()
  if (value === 'succeeded') return 'succeeded'
  if (value === 'failed') return 'failed'
  if (value === 'canceled') return 'canceled'
  if (value === 'canceling') return 'canceling'
  return 'pending'
}

export function taskHistorySuccessFromStatus(statusRaw: any): boolean | null {
  const status = normalizeTaskHistoryStatus(statusRaw)
  if (status === 'succeeded') return true
  if (status === 'failed') return false
  return null
}

function normalizeTaskHistoryItem(raw: any): AiDrawTaskHistoryItem | null {
  if (!raw || typeof raw !== 'object') return null
  const requestAtRaw = Number((raw as any).requestAt)
  const updatedAtRaw = Number((raw as any).updatedAt)
  const status = normalizeTaskHistoryStatus((raw as any).status)
  const successRaw = (raw as any).success

  return {
    id: String((raw as any).id || '').trim(),
    taskId: String((raw as any).taskId || '').trim(),
    mode: String((raw as any).mode || '').trim() === 'local-edit' ? 'local-edit' : 'normal',
    requestAt: Number.isFinite(requestAtRaw) && requestAtRaw > 0 ? requestAtRaw : Date.now(),
    updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Number.isFinite(requestAtRaw) && requestAtRaw > 0 ? requestAtRaw : Date.now(),
    providerId: String((raw as any).providerId || '').trim(),
    providerName: String((raw as any).providerName || '').trim(),
    model: String((raw as any).model || '').trim(),
    prompt: String((raw as any).prompt || ''),
    status,
    success: typeof successRaw === 'boolean' ? successRaw : taskHistorySuccessFromStatus(status),
    failureReason: String((raw as any).failureReason || ''),
  }
}

export function normalizeTaskHistory(list: any, limitRaw: any): AiDrawTaskHistoryItem[] {
  const limit = normalizeTaskHistoryLimit(limitRaw)
  const raw = Array.isArray(list) ? list : []
  const out: AiDrawTaskHistoryItem[] = []
  for (const item of raw) {
    const normalized = normalizeTaskHistoryItem(item)
    if (!normalized) continue
    out.push(normalized)
  }
  out.sort((a, b) => {
    if (b.requestAt !== a.requestAt) return b.requestAt - a.requestAt
    return b.updatedAt - a.updatedAt
  })
  return out.slice(0, limit)
}
