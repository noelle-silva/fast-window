import type { AiChatDirectRequest, AiChatDirectResponse } from './aiChatProtocol'

export class AiChatDirectError extends Error {
  code: string
  details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AiChatDirectError'
    this.code = code
    this.details = details
  }
}

export function toDirectErrorPayload(error: unknown) {
  if (error instanceof AiChatDirectError) {
    return { code: error.code, message: error.message, details: error.details }
  }
  return { code: 'INTERNAL', message: String((error as any)?.message || error || '请求失败') }
}

export function validateRequestFrame(frame: unknown): AiChatDirectRequest {
  if (!frame || typeof frame !== 'object') {
    throw new AiChatDirectError('BAD_REQUEST', '请求帧无效')
  }
  const f = frame as Record<string, unknown>
  if (typeof f.id !== 'string' || !f.id.trim()) {
    throw new AiChatDirectError('BAD_REQUEST', '请求 id 缺失或无效')
  }
  if (f.type !== 'request') {
    throw new AiChatDirectError('BAD_REQUEST', '请求帧 type 必须为 request')
  }
  if (typeof f.method !== 'string' || !f.method.trim()) {
    throw new AiChatDirectError('BAD_REQUEST', '请求 method 缺失')
  }
  return f as unknown as AiChatDirectRequest
}

export function makeResponseFrame(id: string, ok: boolean, result?: unknown, error?: unknown): string {
  const frame: AiChatDirectResponse = ok
    ? { id, type: 'response', ok: true, result }
    : { id, type: 'response', ok: false, error: toDirectErrorPayload(error) }
  return JSON.stringify(frame)
}
