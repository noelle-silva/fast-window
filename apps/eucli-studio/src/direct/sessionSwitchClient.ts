import type { AiChatDirectClient } from '../direct/createAiChatDirectClient'
import { AI_CHAT_DIRECT_FEATURE, AI_CHAT_DIRECT_METHOD } from '../protocol/aiChatProtocol'
import { validateSessionWindowPage, validateSessionWire } from '../protocol/sessionWireContract'
import { normalizeSessionGraph } from '../protocol/sessionGraphContract'
import {
  normalizeActiveChatCommandResult,
  normalizeSessionIndexBundle,
  normalizeSessionSummaryPage,
  scopeKey,
  type SessionScope,
  type SessionSwitchClient,
  type SessionReadOptions,
  type SessionWireProfile,
  type SessionWindowRequest,
} from '../protocol/sessionSwitchProtocol'

// 后端能力协商：healthCheck 返回 features，前端据此决定走新接口还是旧 storage key。
// 不升协议主版本——协议版本是严格相等校验，升版会让新旧前端直接互斥。
export function readHealthCheckFeatures(raw: any): string[] {
  const features = (raw as any)?.features
  if (!Array.isArray(features)) return []
  return features.map((item: any) => String(item || '').trim()).filter(Boolean)
}

// 能力协商必须「可刷新」：
//
//   studio.bootstrap 才会触发 box 能力探测（probeBoxCapabilities），
//   而首次 healthCheck 在它之前就发生了。若在构造时把 features 快照下来，
//   所有 gated 功能会永远保持关闭。
//
// 因此这里只持有「读取当前 features 的函数」：每次判定都读到最新值，
// bootstrap 之后 refreshHealthCheck() 一刷新，后续判定立刻生效。
export type FeatureSource = () => string[]

export type SessionSwitchClientWithFeatures = SessionSwitchClient & {
  // 静态快照模式下手动替换（bootstrap 之后调用）；动态模式为无操作。
  refreshFeatures: (features: string[]) => void
}

export function createSessionSwitchClient(deps: {
  directClient: AiChatDirectClient
  // features 是静态快照（兼容旧调用方）；featuresSource 优先。
  features?: string[]
  featuresSource?: FeatureSource
}): SessionSwitchClientWithFeatures {
  const { directClient } = deps
  let staticFeatures = (deps.features || []).map((item) => String(item || '').trim()).filter(Boolean)

  function currentFeatures(): string[] {
    if (typeof deps.featuresSource === 'function') return deps.featuresSource()
    return [...staticFeatures]
  }

  const hasFeature = (feature: string) => currentFeatures().includes(feature)

  async function sessionIndexGet(scopes: SessionScope[]) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.sessionIndexGet)) {
      throw new Error('后端不支持 sessionIndex.get')
    }
    const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.sessionIndexGet, {
      scopes: scopes.map((scope) => ({ kind: scope.kind, targetId: scope.targetId })),
    })
    return normalizeSessionIndexBundle(result)
  }

  async function sessionSummaryList(scope: SessionScope, options?: { cursor?: string; limit?: number }) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.sessionSummaryList)) {
      throw new Error('后端不支持 sessionSummary.list')
    }
    const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.sessionSummaryList, {
      scope: { kind: scope.kind, targetId: scope.targetId },
      cursor: String(options?.cursor || ''),
      limit: Number(options?.limit || 0),
    })
    return normalizeSessionSummaryPage(result)
  }

  async function sessionGet(scope: SessionScope, chatId: string, options?: SessionReadOptions) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.sessionGet)) {
      throw new Error('后端不支持 session.get')
    }
    const params: Record<string, unknown> = {
      scope: { kind: scope.kind, targetId: scope.targetId },
      chatId: String(chatId || '').trim(),
      profile: options?.profile || 'view',
    }
    // switchId 必须随正文请求一起走：三跳同源（前端 → studio → box X-Eucli-Trace）。
    if (options?.switchId) params.switchId = String(options.switchId)
    const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.sessionGet, params)
    // 客户端是唯一真解析方：strict 校验在协议边界完成，坏数据不进业务层。
    return validateSessionWire(result)
  }

  async function sessionWindow(scope: SessionScope, chatId: string, options?: SessionWindowRequest) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.sessionWindow)) {
      throw new Error('后端不支持 session.window')
    }
    const params: Record<string, unknown> = {
      scope: { kind: scope.kind, targetId: scope.targetId },
      chatId: String(chatId || '').trim(),
      profile: options?.profile || 'view',
    }
    // cursor 由业务端签发与解释，这里只做原样透传。
    if (options?.cursor) params.cursor = String(options.cursor)
    if (options?.head) params.head = String(options.head)
    if (options?.before) params.before = String(options.before)
    if (typeof options?.limit === 'number') params.limit = options.limit
    if (typeof options?.maxBytes === 'number') params.maxBytes = options.maxBytes
    // 正文加载必须与偏好命令共享同一个 switchId。
    if (options?.switchId) params.switchId = String(options.switchId)
    const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.sessionWindow, params)
    return validateSessionWindowPage(result)
  }

  async function sessionGraph(scope: SessionScope, chatId: string, options?: { switchId?: string }) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.sessionGraph)) {
      throw new Error('后端不支持 session.graph')
    }
    const params: Record<string, unknown> = {
      scope: { kind: scope.kind, targetId: scope.targetId },
      chatId: String(chatId || '').trim(),
    }
    if (options?.switchId) params.switchId = String(options.switchId)
    const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.sessionGraph, params)
    return normalizeSessionGraph(result)
  }

  async function setSessionView(scope: SessionScope, chatId: string, head: string, options?: { branchId?: string; switchId?: string }) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.sessionViewPatch)) {
      throw new Error('后端不支持 session.view.patch')
    }
    const params: Record<string, unknown> = {
      scope: { kind: scope.kind, targetId: scope.targetId },
      chatId: String(chatId || '').trim(),
      head: String(head || '').trim(),
    }
    if (options?.branchId) params.branchId = String(options.branchId)
    if (options?.switchId) params.switchId = String(options.switchId)
    return directClient.invoke(AI_CHAT_DIRECT_METHOD.sessionView, params)
  }

  async function setActiveChat(scope: SessionScope, chatId: string, options?: { expectedRevision?: number; switchId?: string }) {
    if (!hasFeature(AI_CHAT_DIRECT_FEATURE.setActiveChat)) {
      throw new Error('后端不支持 setActiveChat')
    }
    const params: Record<string, unknown> = {
      scope: { kind: scope.kind, targetId: scope.targetId },
      chatId: String(chatId || '').trim(),
    }
    if (typeof options?.expectedRevision === 'number') params.expectedRevision = options.expectedRevision
    // switchId 是纯观测关联键：后端只透传/记日志，不参与任何行为分支。
    if (options?.switchId) params.switchId = String(options.switchId)
    const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.setActiveChat, params)
    return normalizeActiveChatCommandResult(result)
  }

  return {
    get healthCheckFeatures() {
      return currentFeatures()
    },
    hasFeature,
    refreshFeatures(features: string[]) {
      staticFeatures = (features || []).map((item) => String(item || '').trim()).filter(Boolean)
    },
    sessionIndexGet,
    sessionSummaryList,
    sessionGet,
    sessionWindow,
    sessionGraph,
    setSessionView,
    setActiveChat,
  }
}

// scope 化协议的迁移垫片：一次往返拿多个旧 storage key。
// 只在新接口不可用时使用，不进长期契约。
export async function storageGetMany(directClient: AiChatDirectClient, keys: string[]): Promise<Record<string, any>> {
  const result = await directClient.invoke(AI_CHAT_DIRECT_METHOD.storageGetMany, { keys })
  const values = (result as any)?.values
  return values && typeof values === 'object' ? values : {}
}

export function sessionScopeKey(scope: SessionScope) {
  return scopeKey(scope)
}
