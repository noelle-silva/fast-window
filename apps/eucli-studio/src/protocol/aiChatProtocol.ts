import type { ErrorPayload } from '../domain/errorPayload'

export const AI_CHAT_DIRECT_PROTOCOL_VERSION = 2

export const AI_CHAT_DIRECT_METHOD = {
  healthCheck: 'aiChat.healthCheck',
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
  imageRead: 'aiChat.imageRead',
  imageWrite: 'aiChat.imageWrite',
  imageDelete: 'aiChat.imageDelete',
  imagePick: 'aiChat.imagePick',
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
