export const AI_CHAT_DIRECT_PROTOCOL_VERSION = 1

export const AI_CHAT_DIRECT_METHOD = {
  healthCheck: 'aiChat.healthCheck',
  submitChatCompletion: 'aiChat.submitChatCompletion',
  submitManyChatCompletions: 'aiChat.submitManyChatCompletions',
  submitRawServiceRequest: 'aiChat.submitRawServiceRequest',
  waitServiceFinal: 'aiChat.waitServiceFinal',
  cancelAssistant: 'aiChat.cancelAssistant',
  readAssistantStream: 'aiChat.readAssistantStream',
  consumeAssistantFinal: 'aiChat.consumeAssistantFinal',
  resetAssistantRuntime: 'aiChat.resetAssistantRuntime',
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
  error?: { code?: string; message: string; details?: unknown }
}

export type AiChatDirectEvent = {
  type: 'event'
  name: AiChatDirectEventName
  payload?: unknown
}
