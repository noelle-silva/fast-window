import { AI_CHAT_DIRECT_METHOD } from './aiChatProtocol'

// 请求的「重放类别」：断线重连后能不能自动重发，只由它决定。
//
//   idempotent-read  纯读取：重放一次不会产生第二次副作用
//   non-idempotent   写 / 命令：重放可能重复执行，必须交给 reconcile 收敛
export type ReplayClass = 'idempotent-read' | 'non-idempotent'

// DirectFailure 四态（design-5 P5）：
//
//   timeout              交互超时：前端不再等，但不代表工作应停止
//   indeterminate        已发出、结果未知：写 / 命令丢弃 promise，由 reconcile 收敛
//   reconnected-unknown  断线重连后无法判定：non-idempotent 请求的唯一合法答复
//   transport            传输层已断开且不会再重试：只有 close() 才会走到这里
export const DIRECT_FAILURE = {
  timeout: 'DIRECT_TIMEOUT',
  indeterminate: 'DIRECT_INDETERMINATE',
  reconnectedUnknown: 'RECONNECTED_UNKNOWN',
  transport: 'DIRECT_TRANSPORT',
} as const

export type DirectFailureKind = keyof typeof DIRECT_FAILURE

export class DirectFailure extends Error {
  readonly kind: DirectFailureKind
  readonly code: string
  readonly method: string
  readonly replay: ReplayClass

  constructor(kind: DirectFailureKind, method: string, replay: ReplayClass, message?: string) {
    super(message || defaultMessage(kind, method))
    this.name = 'DirectFailure'
    this.kind = kind
    this.code = DIRECT_FAILURE[kind]
    this.method = method
    this.replay = replay
  }
}

function defaultMessage(kind: DirectFailureKind, method: string) {
  switch (kind) {
    case 'timeout':
      return `请求超时：${method}`
    case 'indeterminate':
      return `请求结果未知，需要重新对账：${method}`
    case 'reconnectedUnknown':
      return `连接重建，无法确认请求是否完成：${method}`
    default:
      return `连接已关闭：${method}`
  }
}

export function isDirectFailure(error: unknown): error is DirectFailure {
  return error instanceof DirectFailure
}

const READ_METHODS = new Set<string>([
  AI_CHAT_DIRECT_METHOD.healthCheck,
  AI_CHAT_DIRECT_METHOD.storageGet,
  AI_CHAT_DIRECT_METHOD.storageGetMany,
  AI_CHAT_DIRECT_METHOD.sessionIndexGet,
  AI_CHAT_DIRECT_METHOD.sessionSummaryList,
  AI_CHAT_DIRECT_METHOD.sessionGet,
  AI_CHAT_DIRECT_METHOD.sessionWindow,
  // session.graph 是纯读投影：与 window/get 同类，超时后可安全重放。
  AI_CHAT_DIRECT_METHOD.sessionGraph,
  AI_CHAT_DIRECT_METHOD.imageRead,
  AI_CHAT_DIRECT_METHOD.eucliConfigGet,
  AI_CHAT_DIRECT_METHOD.releaseCandidatesList,
  AI_CHAT_DIRECT_METHOD.artifactsInstallations,
])

const WRITE_METHODS = new Set<string>([
  AI_CHAT_DIRECT_METHOD.storageSet,
  AI_CHAT_DIRECT_METHOD.storageRemove,
  AI_CHAT_DIRECT_METHOD.setActiveChat,
  // session.view.patch 是服务端事实写入：非幂等，断线后不能自动重放。
  AI_CHAT_DIRECT_METHOD.sessionView,
  AI_CHAT_DIRECT_METHOD.imageWrite,
  AI_CHAT_DIRECT_METHOD.imageDelete,
  AI_CHAT_DIRECT_METHOD.eucliConfigSet,
])

// replayClassFor 是「这一帧能不能自动重放」的唯一判定点。
// netRequest 的语义由它承载的 HTTP 方法决定：GET 是读，其余是命令。
export function replayClassFor(method: string, params?: unknown): ReplayClass {
  if (READ_METHODS.has(method)) return 'idempotent-read'
  if (WRITE_METHODS.has(method)) return 'non-idempotent'
  if (method === AI_CHAT_DIRECT_METHOD.netRequest) {
    const verb = String((params as any)?.method || 'GET').toUpperCase()
    return verb === 'GET' ? 'idempotent-read' : 'non-idempotent'
  }
  return 'non-idempotent'
}

// isInteractionTimeoutApplies 决定交互超时之后 promise 怎么处置：
//
//   read    → 保留 promise 至自然完成（结果仍然有用，只是不再阻塞 UI）
//   write   → 丢弃 promise，标记 indeterminate
//   command → 丢弃 promise，禁止自动重试
export function keepsPromiseAfterInteractionTimeout(replay: ReplayClass) {
  return replay === 'idempotent-read'
}
