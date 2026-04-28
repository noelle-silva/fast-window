import type { AiChatCapabilities } from '../gateway/capabilities'

export type AiChatController = {
  capabilities: AiChatCapabilities
  defaults: {
    mermaidFixSystemPrompt: string
    chatTitleNamingSystemPrompt: string
    stickerNamingSystemPrompt: string
  }
  getState: () => any
  getSnapshot: () => number
  subscribe: (fn: () => void) => () => void
  fmtTime: (ts: any) => string
  activeRole: () => any
  activeChat: () => any
  getProvider: (providerId: any) => any
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
  actions: Record<string, any>
}

