export type AiChatController = {
  api: any
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

