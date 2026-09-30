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
  // 范围刷新：能说清“只该动哪里”的变化走范围通道，不惊动整页。
  getScopeVer: (scope: string) => number
  subscribeScope: (scope: string, fn: () => void) => () => void
  emitScope: (scope: string) => void
  // 读取当前活动会话中指定消息的实时对象（流式更新就地改写同一对象）。
  getMessageById: (mid: string) => any
  fmtTime: (ts: any) => string
  activeRole: () => any
  activeChat: () => any
  getProvider: (providerId: any) => any
  renderAssistantInto: (el: unknown, text: unknown, options?: any) => void
  actions: Record<string, any>
  dispose: () => void
}

