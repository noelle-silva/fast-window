export const AI_DRAW_ERROR_CODE = {
  badRequest: 'BAD_REQUEST',
  unauthorized: 'UNAUTHORIZED',
  protocolVersionUnsupported: 'PROTOCOL_VERSION_UNSUPPORTED',
  methodNotFound: 'METHOD_NOT_FOUND',
  taskNotFound: 'TASK_NOT_FOUND',
  upstreamFailed: 'UPSTREAM_FAILED',
  imageInvalid: 'IMAGE_INVALID',
  storageFailed: 'STORAGE_FAILED',
  internal: 'INTERNAL',
} as const

export type AiDrawErrorCode = (typeof AI_DRAW_ERROR_CODE)[keyof typeof AI_DRAW_ERROR_CODE]

export class AiDrawDirectError extends Error {
  code: AiDrawErrorCode
  details?: unknown

  constructor(code: AiDrawErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AiDrawDirectError'
    this.code = code
    this.details = details
  }
}

export function toDirectErrorPayload(error: unknown) {
  if (error instanceof AiDrawDirectError) {
    return { code: error.code, message: error.message, details: error.details }
  }
  return { code: AI_DRAW_ERROR_CODE.internal, message: String((error as any)?.message || error || '请求失败') }
}
