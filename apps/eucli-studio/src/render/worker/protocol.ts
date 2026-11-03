// ============================================================================
// 渲染 Worker 消息协议
//
// 所有请求都带数字 id，响应原样带回，调用方据此关联并发请求。
// 成功与失败都用显式分支表达：失败必须携带可读错误，不允许静默丢消息。
// ============================================================================

export const WORKER_PROTOCOL_VERSION = 1

export type WorkerProtocolVersion = typeof WORKER_PROTOCOL_VERSION

export type WorkerRequestId = number

export type WorkerPingRequest = {
  id: WorkerRequestId
  type: 'ping'
}

export type WorkerParseRequest = {
  id: WorkerRequestId
  type: 'parse'
  source: string
}

export type WorkerParseBatchItem = {
  key: string
  source: string
}

export type WorkerParseBatchRequest = {
  id: WorkerRequestId
  type: 'parse-batch'
  items: WorkerParseBatchItem[]
}

export type WorkerMathBatchItem = {
  key: string
  tex: string
  display: boolean
}

export type WorkerMathBatchRequest = {
  id: WorkerRequestId
  type: 'math-batch'
  items: WorkerMathBatchItem[]
}

export type WorkerRequest =
  | WorkerPingRequest
  | WorkerParseRequest
  | WorkerParseBatchRequest
  | WorkerMathBatchRequest

export type WorkerRequestType = WorkerRequest['type']

export type WorkerError = {
  name: string
  message: string
  stack?: string
}

export type WorkerPingResult = {
  protocolVersion: WorkerProtocolVersion
}

export type WorkerParseResult = {
  html: string
}

export type WorkerMathResult = {
  html: string
}

export type WorkerItemResult<T> =
  | { key: string; ok: true; value: T }
  | { key: string; ok: false; error: WorkerError }

export type WorkerParseBatchResult = {
  items: WorkerItemResult<WorkerParseResult>[]
}

export type WorkerMathBatchResult = {
  items: WorkerItemResult<WorkerMathResult>[]
}

export type WorkerSuccessResponse =
  | { id: WorkerRequestId; type: 'ping'; ok: true; result: WorkerPingResult }
  | { id: WorkerRequestId; type: 'parse'; ok: true; result: WorkerParseResult }
  | { id: WorkerRequestId; type: 'parse-batch'; ok: true; result: WorkerParseBatchResult }
  | { id: WorkerRequestId; type: 'math-batch'; ok: true; result: WorkerMathBatchResult }

export type WorkerFailureResponse = {
  id: WorkerRequestId
  ok: false
  error: WorkerError
}

export type WorkerResponse = WorkerSuccessResponse | WorkerFailureResponse

export function toWorkerError(error: unknown): WorkerError {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }
  return { name: 'Error', message: String(error) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readWorkerRequestId(value: unknown): WorkerRequestId | null {
  if (!isRecord(value)) return null
  const id = value.id
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

function isParseBatchItem(value: unknown): value is WorkerParseBatchItem {
  return isRecord(value) && typeof value.key === 'string' && typeof value.source === 'string'
}

function isMathBatchItem(value: unknown): value is WorkerMathBatchItem {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.tex === 'string' &&
    typeof value.display === 'boolean'
  )
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!isRecord(value)) return false
  if (readWorkerRequestId(value) === null) return false

  switch (value.type) {
    case 'ping':
      return true
    case 'parse':
      return typeof value.source === 'string'
    case 'parse-batch':
      return Array.isArray(value.items) && value.items.every(isParseBatchItem)
    case 'math-batch':
      return Array.isArray(value.items) && value.items.every(isMathBatchItem)
    default:
      return false
  }
}
