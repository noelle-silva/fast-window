import { assistantToolPartId, planAssistantMessageBlocks, type AssistantMessageBlockKind } from './assistantMessageBlocks'
import { writeChatMessageFields } from './chatMessageFields'
import { partsWithSyncedText } from './message'

export type AssistantMessageBlockRef = {
  kind: AssistantMessageBlockKind
  blockId?: string
  partId?: string
  start?: number
  end?: number
}

type MutationResult = { ok: true } | { ok: false; error: string }

function plainObject(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stripJsonFence(text: string) {
  const raw = String(text || '').trim()
  const match = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  return match ? String(match[1] || '').trim() : raw
}

function parseJsonObject(text: string): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  let parsed: any = null
  try {
    parsed = JSON.parse(stripJsonFence(text) || '{}')
  } catch (_) {
    return { ok: false, error: '工具调用参数必须是 JSON 对象' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '工具调用参数必须是 JSON 对象' }
  return { ok: true, value: parsed }
}

function normalizeBlockRef(raw: any): AssistantMessageBlockRef | null {
  const kind = String(raw?.kind || '').trim() as AssistantMessageBlockKind
  if (kind !== 'text' && kind !== 'reasoning' && kind !== 'tool_invocation' && kind !== 'tool_result') return null
  const start = typeof raw?.start === 'number' && Number.isFinite(raw.start) ? Math.max(0, Math.floor(raw.start)) : undefined
  const end = typeof raw?.end === 'number' && Number.isFinite(raw.end) ? Math.max(0, Math.floor(raw.end)) : undefined
  return {
    kind,
    blockId: String(raw?.blockId || '').trim(),
    partId: String(raw?.partId || '').trim(),
    start,
    end,
  }
}

function findToolPartIndex(message: any, ref: AssistantMessageBlockRef): number {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  const partId = String(ref.partId || '').trim()
  if (!partId) return -1
  return parts.findIndex((part: any, index: number) => String(part?.type || '') === 'tool' && assistantToolPartId(part, index) === partId)
}

function replaceToolPart(message: any, index: number, nextPart: any): void {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  const nextParts = parts.map((part: any, partIndex: number) => (partIndex === index ? nextPart : part))
  writeChatMessageFields(message, { parts: nextParts })
}

function replaceContentRange(message: any, ref: AssistantMessageBlockRef, replacement: string): MutationResult {
  const content = String(message?.content ?? '')
  const start = Number(ref.start)
  const end = Number(ref.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > content.length) return { ok: false, error: '文本块范围无效' }
  const nextContent = content.slice(0, start) + replacement + content.slice(end)
  writeChatMessageFields(message, { content: nextContent, parts: partsWithSyncedText(message?.parts, nextContent) })
  return { ok: true }
}

export function replaceMessageText(message: any, text: unknown): MutationResult {
  if (!message || typeof message !== 'object') return { ok: false, error: '消息无效' }
  const content = String(text ?? '')
  writeChatMessageFields(message, { content, parts: partsWithSyncedText(message?.parts, content) })
  return { ok: true }
}

function editTextBlock(message: any, ref: AssistantMessageBlockRef, text: string): MutationResult {
  const blocks = planAssistantMessageBlocks(message?.content, message?.parts)
  const block = blocks.find((item) => item.kind === 'text' && item.id === ref.blockId)
  if (!block || block.kind !== 'text') return { ok: false, error: '文本块不存在' }
  return replaceContentRange(message, { ...ref, start: block.start, end: block.end }, text)
}

function editInvocationBlock(message: any, ref: AssistantMessageBlockRef, text: string): MutationResult {
  const index = findToolPartIndex(message, ref)
  if (index < 0) return { ok: false, error: '工具调用块不存在' }

  const parsed = parseJsonObject(String(text || '{}'))
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const input = plainObject(parsed.value)
  replaceToolPart(message, index, { ...message.parts[index], input, raw: JSON.stringify(input) })
  return { ok: true }
}

function editResultBlock(message: any, ref: AssistantMessageBlockRef, text: string): MutationResult {
  const index = findToolPartIndex(message, ref)
  const part = index >= 0 ? message.parts[index] : null
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  if (!part || !result) return { ok: false, error: '工具返回块不存在' }
  const nextResult = String(result.error || '').trim() && !String(result.content || '').trim()
    ? { ...result, error: String(text ?? '') }
    : { ...result, content: String(text ?? '') }
  replaceToolPart(message, index, { ...part, result: nextResult })
  return { ok: true }
}

function displayOf(part: any) {
  return part?.display && typeof part.display === 'object' && !Array.isArray(part.display) ? part.display : {}
}

function deleteTextBlock(message: any, ref: AssistantMessageBlockRef): MutationResult {
  const blocks = planAssistantMessageBlocks(message?.content, message?.parts)
  const block = blocks.find((item) => item.kind === 'text' && item.id === ref.blockId)
  if (!block || block.kind !== 'text') return { ok: false, error: '文本块不存在' }
  return replaceContentRange(message, { ...ref, start: block.start, end: block.end }, '')
}

function deleteInvocationBlock(message: any, ref: AssistantMessageBlockRef): MutationResult {
  const index = findToolPartIndex(message, ref)
  if (index < 0) return { ok: false, error: '工具调用块不存在' }
  const part = message.parts[index]
  replaceToolPart(message, index, { ...part, display: { ...displayOf(part), hideInvocation: true } })
  return { ok: true }
}

function deleteResultBlock(message: any, ref: AssistantMessageBlockRef): MutationResult {
  const index = findToolPartIndex(message, ref)
  const part = index >= 0 ? message.parts[index] : null
  if (!part || !part.result) return { ok: false, error: '工具返回块不存在' }
  replaceToolPart(message, index, { ...part, display: { ...displayOf(part), hideResult: true } })
  return { ok: true }
}

export function editAssistantMessageBlock(message: any, refRaw: any, text: unknown): MutationResult {
  const ref = normalizeBlockRef(refRaw)
  if (!message || typeof message !== 'object') return { ok: false, error: '消息无效' }
  if (!ref) return { ok: false, error: '消息块无效' }
  if (ref.kind === 'text') return editTextBlock(message, ref, String(text ?? ''))
  if (ref.kind === 'reasoning') return { ok: false, error: '思考块不可编辑' }
  if (ref.kind === 'tool_invocation') return editInvocationBlock(message, ref, String(text ?? ''))
  if (ref.kind === 'tool_result') return editResultBlock(message, ref, String(text ?? ''))
  return { ok: false, error: '消息块不可编辑' }
}

export function deleteAssistantMessageBlock(message: any, refRaw: any): MutationResult {
  const ref = normalizeBlockRef(refRaw)
  if (!message || typeof message !== 'object') return { ok: false, error: '消息无效' }
  if (!ref) return { ok: false, error: '消息块无效' }
  if (ref.kind === 'text') return deleteTextBlock(message, ref)
  if (ref.kind === 'reasoning') return { ok: false, error: '思考块不可删除' }
  if (ref.kind === 'tool_invocation') return deleteInvocationBlock(message, ref)
  if (ref.kind === 'tool_result') return deleteResultBlock(message, ref)
  return { ok: false, error: '消息块不可删除' }
}
