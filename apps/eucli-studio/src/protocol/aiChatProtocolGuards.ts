import type { AiChatDirectRequest, AiChatDirectResponse } from './aiChatProtocol'
import { assignErrorPayload, normalizeErrorPayload, normalizeErrorPayloads } from '../domain/errorPayload'

export class AiChatDirectError extends Error {
  code?: string
  system?: string
  details?: unknown
  cause?: unknown
  causes?: unknown[]

  constructor(code: string | undefined, message: string, details?: unknown, system?: string, cause?: unknown, causes?: unknown[]) {
    super(message)
    this.name = 'AiChatDirectError'
    this.code = code
    this.system = system
    this.details = details
    this.cause = cause
    this.causes = causes
  }
}

export function toDirectErrorPayload(error: unknown) {
	if (error instanceof AiChatDirectError) {
		const causes = normalizeErrorPayloads(error.causes)
		return { code: error.code, message: error.message, system: error.system, details: error.details, cause: normalizeErrorPayload(error.cause) || undefined, causes: causes.length ? causes : undefined }
	}
	const raw = error && typeof error === 'object' ? (error as any) : null
	if (isStructuredErrorPayload(raw)) {
		const payload = normalizeErrorPayload(raw)
		if (payload) return payload
	}
	const fallback: any = { code: String(raw?.code || 'INTERNAL'), message: String(raw?.message || error || '请求失败') }
	if (raw && Object.prototype.hasOwnProperty.call(raw, 'details')) fallback.details = raw.details
	return assignErrorPayload(fallback, null)
}

function isStructuredErrorPayload(raw: any) {
	return !!raw && (
		Object.prototype.hasOwnProperty.call(raw, 'code') ||
		Object.prototype.hasOwnProperty.call(raw, 'system') ||
		Object.prototype.hasOwnProperty.call(raw, 'details') ||
		Object.prototype.hasOwnProperty.call(raw, 'cause') ||
		Object.prototype.hasOwnProperty.call(raw, 'causes')
	)
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
