import { assignErrorPayload, normalizeErrorPayload, type ErrorPayload } from '../domain/errorPayload'

type EbNetRequest = (req: any) => Promise<any>

export type EbRunState = {
  id: string
  roleId: string
  groupId: string
  workspaceId: string
  sessionId: string
  inputMessageId: string
  lastMessageId: string
  dependencyMessageIds: string[]
  stream: boolean
  status: string
  reason: string
  retry: EbRunRetryInfo | null
  error: ErrorPayload | null
}

export type EbRunRetryInfo = {
  attempt: number
  maxAttempts: number
  retryAt: string
  delayMs: number
  message: string
  failure: ErrorPayload | null
}

function normalizeTextList(value: unknown) {
  const list = Array.isArray(value) ? value : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function isTerminalRunStatus(status: unknown) {
  const value = String(status || '').trim()
  return value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'canceled'
}

export async function startRoleRun(netRequest: EbNetRequest, input: { roleId: string; groupId?: string; workspaceId?: string; sessionId?: string; message?: string; attachments?: any[]; parentMessageId?: string; userMessageId?: string; contextMessageId?: string; reasoningEffort?: string; modelOverride?: any; hookPromptMode?: string; hookPromptPresetId?: string; stream?: boolean }) {
  const body = {
    roleId: String(input.roleId || '').trim(),
    groupId: String(input.groupId || '').trim(),
    workspaceId: String(input.workspaceId || '').trim(),
    sessionId: String(input.sessionId || '').trim(),
    message: String(input.message || '').trim(),
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    parentMessageId: String(input.parentMessageId || '').trim(),
    userMessageId: String(input.userMessageId || '').trim(),
    contextMessageId: String(input.contextMessageId || '').trim(),
    modelOverride: input.modelOverride && typeof input.modelOverride === 'object' ? input.modelOverride : null,
    reasoningEffort: String(input.reasoningEffort || '').trim(),
    hookPromptMode: String(input.hookPromptMode || '').trim(),
    hookPromptPresetId: String(input.hookPromptPresetId || '').trim(),
    stream: input.stream,
  }
  if (!body.roleId) throw new Error('角色无效')
  const hasAttachments = body.attachments.length > 0
  const hasMessage = !!body.message || hasAttachments
  const hasUserMessageId = !!body.userMessageId
  const hasContextMessageId = !!body.contextMessageId
  if ([hasMessage, hasUserMessageId, hasContextMessageId].filter(Boolean).length !== 1) throw new Error('必须且只能指定输入内容、用户消息或上下文消息')
  if (body.parentMessageId && (hasUserMessageId || hasContextMessageId)) throw new Error('父消息不能和用户消息或上下文消息同时指定')
  if ((hasUserMessageId || hasContextMessageId) && hasAttachments) throw new Error('从已有消息继续生成时不能携带新附件')
  if (body.parentMessageId && !body.sessionId) throw new Error('会话无效')
  if ((hasUserMessageId || hasContextMessageId) && !body.sessionId) throw new Error('会话无效')
  if (!body.parentMessageId) delete (body as any).parentMessageId
  if (!body.userMessageId) delete (body as any).userMessageId
  if (!body.contextMessageId) delete (body as any).contextMessageId
  if (!body.modelOverride) delete (body as any).modelOverride
  if (!body.message) delete (body as any).message
  if (!body.attachments.length) delete (body as any).attachments
  if (!body.groupId) delete (body as any).groupId
  if (!body.workspaceId) delete (body as any).workspaceId
  if (!body.sessionId) delete (body as any).sessionId
  if (!body.reasoningEffort) delete (body as any).reasoningEffort
  if (!body.hookPromptMode) delete (body as any).hookPromptMode
  if (!body.hookPromptPresetId) delete (body as any).hookPromptPresetId
  if (typeof body.stream !== 'boolean') delete (body as any).stream
  const response = await netRequest({ method: 'POST', path: '/api/runs', body, timeoutMs: 30000 })
  return normalizeRunState(response?.body)
}

export async function getRunState(netRequest: EbNetRequest, runId: string) {
  const id = String(runId || '').trim()
  if (!id) throw new Error('run id 无效')
  const response = await netRequest({ method: 'GET', path: `/api/runs/${encodeURIComponent(id)}`, timeoutMs: 15000 })
  return normalizeRunState(response?.body)
}

export async function listActiveRoleRuns(netRequest: EbNetRequest) {
  const response = await netRequest({ method: 'GET', path: '/api/runs', timeoutMs: 15000 })
  const runs = Array.isArray(response?.body) ? response.body : []
  return runs.map(normalizeRunState).filter((run: EbRunState) => run.id && !isTerminalRunStatus(run.status))
}

export async function cancelRoleRun(netRequest: EbNetRequest, runId: string) {
  const id = String(runId || '').trim()
  if (!id) throw new Error('run id 无效')
  await netRequest({ method: 'POST', path: `/api/runs/${encodeURIComponent(id)}/cancel`, timeoutMs: 15000 })
}

export async function submitToolConfirmation(netRequest: EbNetRequest, input: { decisionId: string; approved: boolean; reason?: string }) {
  const decisionId = String(input.decisionId || '').trim()
  if (!decisionId) throw new Error('确认项无效')
  const body: any = {
    decisionId,
    approved: !!input.approved,
  }
  const reason = String(input.reason || '').trim()
  if (reason) body.reason = reason
  await netRequest({ method: 'POST', path: '/api/tool-confirmations', body, timeoutMs: 15000 })
}

export async function pollRunUntilTerminal(
  netRequest: EbNetRequest,
  initialRun: EbRunState,
  onState?: (run: EbRunState) => void | Promise<void>,
  options?: { shouldContinue?: () => boolean },
) {
  let state = initialRun
  const runId = String(state?.id || '').trim()
  if (!runId) throw new Error('run id 无效')
  while (!isTerminalRunStatus(state.status)) {
    if (options?.shouldContinue && !options.shouldContinue()) return state
    await sleepMs(450)
    if (options?.shouldContinue && !options.shouldContinue()) return state
    state = await getRunState(netRequest, runId)
    await onState?.(state)
  }
  return state
}

export function normalizeRunState(value: any): EbRunState {
  const state = value && typeof value === 'object' ? value : {}
  const error = normalizeErrorPayload(state.error)
  return {
    id: String(state.id || '').trim(),
    roleId: String(state.roleId || '').trim(),
    groupId: String(state.groupId || '').trim(),
    workspaceId: String(state.workspaceId || '').trim(),
    sessionId: String(state.sessionId || '').trim(),
    inputMessageId: String(state.inputMessageId || '').trim(),
    lastMessageId: String(state.lastMessageId || '').trim(),
    dependencyMessageIds: normalizeTextList(state.dependencyMessageIds),
    stream: !!state.stream,
    status: String(state.status || '').trim(),
    reason: String(state.reason || '').trim(),
    retry: normalizeRunRetryInfo(state.retry),
    error,
  }
}

function normalizeRunRetryInfo(value: any): EbRunRetryInfo | null {
  const raw = value && typeof value === 'object' ? value : null
  if (!raw) return null
  const attempt = Math.max(0, Math.floor(Number(raw.attempt || 0)))
  const maxAttempts = Math.max(0, Math.floor(Number(raw.maxAttempts || 0)))
  if (!attempt || !maxAttempts) return null
  return {
    attempt,
    maxAttempts,
    retryAt: String(raw.retryAt || '').trim(),
    delayMs: Math.max(0, Math.floor(Number(raw.delayMs || 0))),
    message: String(raw.message || '').trim(),
    failure: normalizeErrorPayload(raw.failure),
  }
}

export function runStateFailureError(state: EbRunState) {
  const payload = state.error
  const err: any = new Error(String(payload?.message || state.reason || `e-b run ${state.status}`))
  return assignErrorPayload(err, payload)
}

export function sleepMs(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, Math.floor(Number(ms || 0)))))
}
