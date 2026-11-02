import type { ErrorPayload } from '../domain/errorPayload'

export const AI_CHAT_DIRECT_PROTOCOL_VERSION = 2

export const AI_CHAT_DIRECT_METHOD = {
  healthCheck: 'aiChat.healthCheck',
  // 传输取消帧：只停止「等待」，绝不代表工作应停止（平面 A ≠ 平面 B）。
  cancelRequest: 'aiChat.cancelRequest',
  studioBootstrap: 'studio.bootstrap',
  eucliConfigGet: 'eucli.config.get',
  eucliConfigSet: 'eucli.config.set',
  releaseCandidatesList: 'releaseCandidates.list',
  artifactsInstallations: 'artifacts.installations',
  submitChatCompletion: 'aiChat.submitChatCompletion',
  submitManyChatCompletions: 'aiChat.submitManyChatCompletions',
  submitRawServiceRequest: 'aiChat.submitRawServiceRequest',
  waitServiceFinal: 'aiChat.waitServiceFinal',
  cancelAssistant: 'aiChat.cancelAssistant',
  getAssistantRuntime: 'aiChat.getAssistantRuntime',
  readAssistantStream: 'aiChat.readAssistantStream',
  consumeAssistantFinal: 'aiChat.consumeAssistantFinal',
  resetAssistantRuntime: 'aiChat.resetAssistantRuntime',
  netRequest: 'aiChat.netRequest',
  storageGet: 'aiChat.storageGet',
  storageSet: 'aiChat.storageSet',
  storageRemove: 'aiChat.storageRemove',
  // AI 微服务配置是 e-b 的独立事实：只写目标 service 的 assist 端点。
  assistConfigSet: 'aiChat.assistConfig.set',
  // 迁移垫片：一次往返拿多个旧 storage key，不进长期契约。
  storageGetMany: 'aiChat.storageGetMany',
  // scope 化协议：以 {kind,targetId} 寻址，不再以 storage key 寻址。
  sessionIndexGet: 'aiChat.sessionIndex.get',
  sessionSummaryList: 'aiChat.sessionSummary.list',
  sessionGet: 'aiChat.session.get',
  sessionWindow: 'aiChat.session.window',
  sessionView: 'aiChat.session.view',
  sessionGraph: 'aiChat.session.graph',
  setActiveChat: 'aiChat.setActiveChat',
  imageRead: 'aiChat.imageRead',
  imageWrite: 'aiChat.imageWrite',
  imageDelete: 'aiChat.imageDelete',
  imagePick: 'aiChat.imagePick',
} as const

// AI 微服务标识：与 backend-go assistServiceSpecs 的 key 一一对应。
// 读取路径（meta.settings.aiServices）与写入路径（assistConfig.set）共用它。
export const AI_CHAT_ASSIST_SERVICE = {
  mermaidFix: 'mermaidFix',
  chatTitleNaming: 'chatTitleNaming',
  stickerNaming: 'stickerNaming',
  contextCompression: 'contextCompression',
} as const

export type AiChatAssistService = (typeof AI_CHAT_ASSIST_SERVICE)[keyof typeof AI_CHAT_ASSIST_SERVICE]

// 后端能力协商：靠 healthCheck.features 灰度，不升协议主版本。
// directProtocolVersion 是严格相等校验，升版会让新旧前端直接互斥。
export const AI_CHAT_DIRECT_FEATURE = {
  sessionIndexGet: 'sessionIndex.get',
  sessionSummaryList: 'sessionSummary.list',
  sessionGet: 'session.get',
  sessionWindow: 'session.window',
  sessionViewPatch: 'session.view.patch',
  sessionGraph: 'session.graph',
  setActiveChat: 'setActiveChat',
  storageGetMany: 'storageGetMany',
  revisionLayered: 'revisionLayered',
} as const

export const AI_CHAT_DIRECT_EVENT = {
  runProgress: 'aiChat.run.progress',
  runFinal: 'aiChat.run.final',
  chatUpdated: 'aiChat.chat.updated',
  eucliBoxRunEvent: 'eucliBox.run.event',
} as const

export type AiChatDirectMethod = (typeof AI_CHAT_DIRECT_METHOD)[keyof typeof AI_CHAT_DIRECT_METHOD]
export type AiChatDirectEventName = (typeof AI_CHAT_DIRECT_EVENT)[keyof typeof AI_CHAT_DIRECT_EVENT]

export type AiChatDirectRequest<T = unknown> = {
  id: string
  type: 'request'
  method: AiChatDirectMethod
  params?: T
}

export type AiChatDirectResponse<T = unknown> = {
  id: string
  type: 'response'
  ok: boolean
  result?: T
  error?: ErrorPayload
}

export type AiChatDirectEvent = {
  type: 'event'
  name: AiChatDirectEventName
  payload?: unknown
}
