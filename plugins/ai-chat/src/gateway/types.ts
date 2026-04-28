import type { AiChatRunSpec, AiChatRunTarget } from '../requestPipeline'

export type AiChatRawServiceRequestInput = {
  target: AiChatRunTarget
  req: any
  stream: boolean
}

export type AiChatInternalGateway = {
  startBackgroundWorker: (intervalMs?: number) => Promise<void>
  submitRoleChatCompletion: (input: AiChatRunSpec) => Promise<void>
  submitGroupChatCompletion: (input: AiChatRunSpec) => Promise<void>
  submitManyChatCompletions: (inputs: AiChatRunSpec[]) => Promise<void>
  submitRawServiceRequest: (input: AiChatRawServiceRequestInput) => Promise<void>
  waitServiceFinal: (assistantMid: string, timeoutMs: number) => Promise<string>
  cancelAssistant: (assistantMid: string) => Promise<void>
  resetAssistantRuntime: (assistantMid: string) => Promise<void>
  readAssistantStream: (assistantMid: string) => Promise<any>
  consumeAssistantFinal: (assistantMid: string) => Promise<any>
}
