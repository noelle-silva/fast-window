import { AI_CHAT_DIRECT_METHOD } from '../protocol/aiChatProtocol'
import type { AiChatDirectClient } from '../direct/createAiChatDirectClient'
import type { AiChatInternalGateway, AiChatRawServiceRequestInput } from '../gateway/types'
import type { AiChatRunSpec } from '../requestPipeline'

const ACK_TIMEOUT_MS = 15000
const POLL_TIMEOUT_MS = 10000

export function createAiChatDirectGateway(directClient: AiChatDirectClient): AiChatInternalGateway {
  return {
    async startBackgroundWorker() {
      // The App sidecar owns the background worker. The UI only sends direct requests.
    },
    submitRoleChatCompletion(input: AiChatRunSpec) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.submitChatCompletion, input, { timeoutMs: ACK_TIMEOUT_MS }).then(() => undefined)
    },
    submitGroupChatCompletion(input: AiChatRunSpec) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.submitChatCompletion, input, { timeoutMs: ACK_TIMEOUT_MS }).then(() => undefined)
    },
    submitManyChatCompletions(inputs: AiChatRunSpec[]) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.submitManyChatCompletions, { inputs }, { timeoutMs: ACK_TIMEOUT_MS }).then(() => undefined)
    },
    submitRawServiceRequest(input: AiChatRawServiceRequestInput) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.submitRawServiceRequest, input, { timeoutMs: ACK_TIMEOUT_MS }).then(() => undefined)
    },
    waitServiceFinal(assistantMid: string, timeoutMs: number) {
      const requestTimeout = Math.max(ACK_TIMEOUT_MS, Math.floor(Number(timeoutMs || 0)) + 5000)
      return directClient.invoke<string>(AI_CHAT_DIRECT_METHOD.waitServiceFinal, { assistantMid, timeoutMs }, { timeoutMs: requestTimeout })
    },
    cancelAssistant(assistantMid: string) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.cancelAssistant, { assistantMid }, { timeoutMs: ACK_TIMEOUT_MS }).then(() => undefined)
    },
    resetAssistantRuntime(assistantMid: string) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.resetAssistantRuntime, { assistantMid }, { timeoutMs: ACK_TIMEOUT_MS }).then(() => undefined)
    },
    readAssistantStream(assistantMid: string) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.readAssistantStream, { assistantMid }, { timeoutMs: POLL_TIMEOUT_MS })
    },
    consumeAssistantFinal(assistantMid: string) {
      return directClient.invoke(AI_CHAT_DIRECT_METHOD.consumeAssistantFinal, { assistantMid }, { timeoutMs: POLL_TIMEOUT_MS })
    },
  }
}
