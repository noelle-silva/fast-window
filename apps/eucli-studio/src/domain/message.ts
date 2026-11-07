import { now, uid, normImagePaths, normalizeTimeMs } from '../core/utils'
import { CHAT_DEFAULT_BRANCH_ID, CHAT_MSG_GROUP_ROLES } from './constants'
import { normalizeBranchId } from './branching'
import { normalizeMessageModelRef } from './modelRefUtils'
import { normalizeDurationMs } from './messageTiming'
import { normalizeCacheRate } from './sessionCacheRate'
import { normalizeErrorPayload } from './errorPayload'

export function normalizeMessageError(input: any) {
  return normalizeErrorPayload(input)
}

export const CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT = 'async_tool_result'

const CHAT_MESSAGE_TYPES = new Set([
  'assistant',
  'tool',
  'tool_request',
  'tool_confirmation',
  'failure',
  'system_control',
  CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT,
])

export type ChatMessageMaterialKind = 'user' | 'assistant' | 'async_tool_result' | 'system'

export function normalizeChatMessageType(input: unknown) {
  const value = String(input || '').trim()
  return CHAT_MESSAGE_TYPES.has(value) ? value : 'user'
}

export function chatMessageMaterialKind(message: any): ChatMessageMaterialKind {
  const type = normalizeChatMessageType(message?.type)
  const role = String(message?.role || '').trim()
  if (type === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT) return 'async_tool_result'
  if (type === 'system_control' || role === 'system') return 'system'
  if (role === 'assistant' || type === 'assistant') return 'assistant'
  return 'user'
}

export function isAssistantTextChatMessage(message: any) {
  const kind = chatMessageMaterialKind(message)
  return kind === 'assistant' && normalizeChatMessageType(message?.type || message?.role) === 'assistant'
}

export function normalizeMessageGroup(m: any) {
  const g = m && typeof m === 'object' ? m : null
  const groupId = String(g?.groupId || '').trim()
  const groupRole0 = String(g?.groupRole || '').trim()
  const groupRole = CHAT_MSG_GROUP_ROLES.has(groupRole0) ? groupRole0 : ''
  const groupParentMid = String(g?.groupParentMid || '').trim()
  if (!groupId || !groupRole) return { groupId: '', groupRole: '', groupParentMid: '' }
  return { groupId, groupRole, groupParentMid }
}

export function normalizeMessageParentMid(message: any) {
  return String(message?.parentMid || message?.parentMessageId || '').trim()
}

export function normalizeChatMessage(input: any, options?: { activeBranchId?: unknown; toolMessagesAsAssistant?: boolean }) {
  const m = input && typeof input === 'object' ? input : {}
  const messageType = normalizeChatMessageType((m as any).type || (m as any).role)
  const role0 = String((m as any).role || '').trim()
  const toolMessagesAsAssistant = options?.toolMessagesAsAssistant !== false
  const role =
    messageType === 'system_control' || role0 === 'system'
      ? 'system'
      : role0 === 'assistant'
      ? 'assistant'
      : messageType === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT
        ? 'assistant'
      : messageType === 'assistant'
        ? 'assistant'
        : toolMessagesAsAssistant && (messageType === 'tool' || messageType === 'tool_request' || messageType === 'tool_confirmation')
          ? 'assistant'
          : 'user'
  const createdAt = normalizeTimeMs((m as any).createdAt, normalizeTimeMs((m as any).updatedAt, 0) || now())
  const updatedAt = normalizeTimeMs((m as any).updatedAt, createdAt)
  // 运行中消息是原始快照：附件要按角色分流——助手消息的附件是工具产物图，
  // 进 toolImages；其他消息的附件照旧进 images。
  const rawAttachmentImages = attachmentImagePaths((m as any).attachments)
  const isAssistantRole = role === 'assistant'
  const toolImages = isAssistantRole
    ? (normImagePaths((m as any).toolImages).length ? normImagePaths((m as any).toolImages) : rawAttachmentImages)
    : normImagePaths((m as any).toolImages)
  const images = isAssistantRole
    ? normImagePaths((m as any).images)
    : (normImagePaths((m as any).images).length ? normImagePaths((m as any).images) : rawAttachmentImages)
  const out: any = {
    id: String((m as any).id || uid('m')),
    type: messageType,
    role,
    speakerRoleId: String((m as any).speakerRoleId || '').trim(),
    content: String((m as any).content || ''),
    parts: normalizeMessageParts((m as any).parts),
    images,
    // toolImages 是工具产物图的独立通道：与用户素材图分开，单独渲染。
    toolImages,
    tokenEstimate: normalizeMessageTokenEstimate((m as any).tokenEstimate),
    modelDurationMs: normalizeDurationMs((m as any).modelDurationMs),
    contextTokens: normalizeMessageContextTokens((m as any).contextTokens),
    ...normalizeMessageGroup(m),
    branchId: normalizeBranchId((m as any).branchId || options?.activeBranchId || CHAT_DEFAULT_BRANCH_ID),
    parentMid: normalizeMessageParentMid(m),
    createdAt,
    updatedAt,
    modelRef: normalizeMessageModelRef(m),
  }
  // 缓存率是上游真值：拿不到真值时整项不落地，展示层按「无值」显示问号，绝不补 0。
  const cacheRate = normalizeCacheRate((m as any).cacheRate)
  if (cacheRate !== null) out.cacheRate = cacheRate
  if (typeof (m as any).pending === 'boolean') out.pending = !!(m as any).pending
  if (typeof (m as any).streaming === 'boolean') out.streaming = !!(m as any).streaming
  const control = normalizeMessageControl((m as any).control)
  if (control) out.control = control
  const error = normalizeMessageError((m as any).error)
  if (error) out.error = error
  if ((m as any).assistantRun && typeof (m as any).assistantRun === 'object') out.assistantRun = { ...(m as any).assistantRun }
  return out
}

// attachmentImagePaths 从原始附件列表提取图片路径：只认 kind=image 且有 path 的项。
function attachmentImagePaths(input: any): string[] {
  const list = Array.isArray(input) ? input : []
  const out: string[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (String((item as any).kind || '').trim().toLowerCase() !== 'image') continue
    const path = String((item as any).path || '').trim()
    if (path) out.push(path)
  }
  return out
}

export function normalizeMessageControl(input: any) {  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  if (!raw) return null
  const kind = String(raw.kind || '').trim()
  if (!kind) return null
  return {
    kind,
    commandName: String(raw.commandName || '').trim(),
    source: String(raw.source || '').trim(),
    sourceText: String(raw.sourceText || '').trim(),
    retainRecentMessages: Math.max(0, Math.floor(Number(raw.retainRecentMessages || 0))),
    previousSummaryMessageId: String(raw.previousSummaryMessageId || '').trim(),
    compressedUntilMessageId: String(raw.compressedUntilMessageId || '').trim(),
    summaryVersion: Math.max(0, Math.floor(Number(raw.summaryVersion || 0))),
  }
}

export function isSystemControlMessage(message: any) {
  return String(message?.type || '').trim() === 'system_control' || (String(message?.role || '').trim() === 'system' && !!message?.control)
}

export function isAsyncToolResultMessage(message: any) {
  return String(message?.type || '').trim() === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT
}

export function isCompressionSummaryMessage(message: any) {
  return isSystemControlMessage(message) && String(message?.control?.kind || '').trim() === 'compression_summary'
}

// normalizeMessageTokenEstimate / normalizeMessageContextTokens 都是消息上的 token 计数：
// 非负整数，缺失或非法一律归 0，由展示层按「0 即无真值」处理。
export function normalizeMessageTokenEstimate(input: any) {
  return normalizeMessageTokenCount(input)
}

// normalizeMessageContextTokens 归一化「到这条消息为止的上下文规模」真值，0 表示上游没给。
export function normalizeMessageContextTokens(input: any) {
  return normalizeMessageTokenCount(input)
}

// latestContextTokens 返回会话当前的上下文规模：取最后一条带真值的消息。
// 消息行与输入框都读这一份，两处数字必然一致。
export function latestContextTokens(messages: any[]) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const value = normalizeMessageContextTokens(list[index]?.contextTokens)
    if (value > 0) return value
  }
  return 0
}

function normalizeMessageTokenCount(input: any) {
  const value = Math.max(0, Math.floor(Number(input || 0)))
  return Number.isFinite(value) ? value : 0
}

export function normalizeMessageParts(input: any) {
  const list = Array.isArray(input) ? input : []
  const out: any[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const type = String((raw as any).type || '').trim()
    const id = String((raw as any).id || uid('part')).trim()
    if (!id) continue
    if (type === 'text') {
      const text = String((raw as any).text || '')
      if (!text) continue
      out.push({ id, type: 'text', text, durationMs: normalizeDurationMs((raw as any).durationMs), createdAt: normalizeTimeMs((raw as any).createdAt, 0), updatedAt: normalizeTimeMs((raw as any).updatedAt, normalizeTimeMs((raw as any).createdAt, 0)) })
      continue
    }
    if (type === 'reasoning') {
      const text = String((raw as any).text || '')
      const signature = String((raw as any).signature || '').trim()
      const data = String((raw as any).data || '').trim()
      if (!text && !signature && !data) continue
      const part: any = {
        id,
        type: 'reasoning',
        text,
        source: String((raw as any).source || '').trim(),
        signature,
        data,
        durationMs: normalizeDurationMs((raw as any).durationMs),
        createdAt: normalizeTimeMs((raw as any).createdAt, 0),
        updatedAt: normalizeTimeMs((raw as any).updatedAt, normalizeTimeMs((raw as any).createdAt, 0)),
      }
      const display = (raw as any).display && typeof (raw as any).display === 'object' && !Array.isArray((raw as any).display) ? (raw as any).display : null
      if (display) part.display = { ...display }
      out.push(part)
      continue
    }
    if (type !== 'tool') continue
    const callId = String((raw as any).callId || '').trim()
    const toolName = String((raw as any).toolName || '').trim()
    const rawText = String((raw as any).raw || '')
    const state = String((raw as any).state || '').trim()
    const inputValue = (raw as any).input && typeof (raw as any).input === 'object' && !Array.isArray((raw as any).input) ? (raw as any).input : {}
    const part: any = { id, type: 'tool', raw: rawText, callId, toolName, state, input: inputValue, createdAt: normalizeTimeMs((raw as any).createdAt, 0), updatedAt: normalizeTimeMs((raw as any).updatedAt, normalizeTimeMs((raw as any).createdAt, 0)) }
    const display = (raw as any).display && typeof (raw as any).display === 'object' && !Array.isArray((raw as any).display) ? (raw as any).display : null
    if (display) part.display = { ...display }
    const decision = (raw as any).decision && typeof (raw as any).decision === 'object' ? (raw as any).decision : null
    if (decision) {
      part.decision = {
        id: String((decision as any).id || '').trim(),
        actionId: String((decision as any).actionId || '').trim(),
        toolName: String((decision as any).toolName || '').trim(),
        status: String((decision as any).status || '').trim(),
        reason: String((decision as any).reason || '').trim(),
        createdAt: normalizeTimeMs((decision as any).createdAt, 0),
      }
    }
    const result = (raw as any).result && typeof (raw as any).result === 'object' ? (raw as any).result : null
    if (result) {
      part.result = {
        id: String((result as any).id || '').trim(),
        actionId: String((result as any).actionId || '').trim(),
        toolName: String((result as any).toolName || '').trim(),
        status: String((result as any).status || '').trim(),
        content: String((result as any).content || ''),
        error: String((result as any).error || '').trim(),
        metadata: (result as any).metadata && typeof (result as any).metadata === 'object' && !Array.isArray((result as any).metadata) ? (result as any).metadata : {},
        durationMs: normalizeDurationMs((result as any).durationMs),
        createdAt: normalizeTimeMs((result as any).createdAt, 0),
      }
    }
    out.push(part)
  }
  return out
}

// partsWithSyncedText 返回「正文已经同步进 text part」的 parts 新数组。
// 纯计算：不改入参、不写消息字段，最终由 chatMessageFields 的统一入口落地。
export function partsWithSyncedText(partsRaw: unknown, contentRaw: unknown): any[] {
  const content = String(contentRaw ?? '')
  const parts = Array.isArray(partsRaw) ? partsRaw : []
  const index = parts.findIndex((part: any) => String(part?.type || '') === 'text')
  if (!content) {
    return index >= 0 ? parts.slice(0, index).concat(parts.slice(index + 1)) : parts.slice()
  }
  if (index >= 0) {
    return parts.map((part: any, partIndex: number) => (partIndex === index ? { ...part, type: 'text', text: content } : part))
  }
  return [{ id: uid('part'), type: 'text', text: content }].concat(parts)
}
