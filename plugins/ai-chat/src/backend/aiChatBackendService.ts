import { AI_CHAT_DIRECT_METHOD } from '../protocol/aiChatProtocol'
import { AiChatDirectError } from '../protocol/aiChatProtocolGuards'

export type AiChatBackendService = {
  dispatch: (method: string, params: unknown) => Promise<unknown>
}

export function createAiChatBackendService(): AiChatBackendService {
  async function dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case AI_CHAT_DIRECT_METHOD.healthCheck:
        return { version: 1, status: 'ok' }

      case AI_CHAT_DIRECT_METHOD.submitChatCompletion:
      case AI_CHAT_DIRECT_METHOD.submitManyChatCompletions:
      case AI_CHAT_DIRECT_METHOD.submitRawServiceRequest:
      case AI_CHAT_DIRECT_METHOD.waitServiceFinal:
      case AI_CHAT_DIRECT_METHOD.cancelAssistant:
      case AI_CHAT_DIRECT_METHOD.readAssistantStream:
      case AI_CHAT_DIRECT_METHOD.consumeAssistantFinal:
      case AI_CHAT_DIRECT_METHOD.resetAssistantRuntime:
        throw new AiChatDirectError('NOT_IMPLEMENTED', `method "${method}" will be implemented in phase 4`)

      default:
        throw new AiChatDirectError('METHOD_NOT_FOUND', `未知方法: ${method}`)
    }
  }

  return { dispatch }
}
