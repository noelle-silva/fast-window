import { clamp } from '../../core/utils'
import {
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
  DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
} from '../../domain/constants'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createAiServiceActions(deps: {
  state: any
  emit: () => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
}) {
  const { state, emit, saveMeta } = deps

  function ensureAiServiceConfig(serviceName: string) {
    if (!state.data) return null
    if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
    const services = state.data.settings.aiServices as any
    if (!services[serviceName] || typeof services[serviceName] !== 'object') services[serviceName] = {} as any
    return services[serviceName] as any
  }

  function setAiServiceModelSource(serviceName: string, value: any) {
    const box = ensureAiServiceConfig(serviceName)
    if (!box) return
    const raw = String(value || '')
    const parts = raw.split(':')
    const kind = parts[0] === 'model_group' ? 'model_group' : 'provider'
    const id = parts.slice(1).join(':')
    box.kind = kind
    box.providerId = kind === 'provider' ? id : ''
    box.groupId = kind === 'model_group' ? id : ''
    box.modelId = ''
    box.customModelId = ''
    saveMeta().catch(() => {})
    emit()
  }

  function setAiServiceModelId(serviceName: string, modelId: any) {
    const box = ensureAiServiceConfig(serviceName)
    if (!box) return
    box.modelId = String(modelId || '')
    box.customModelId = ''
    saveMeta().catch(() => {})
    emit()
  }

  return {
    setMermaidFixEnabled: (on: any) => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.enabled = !!on
      saveMeta().catch(() => {})
      emit()
    },
    setMermaidFixProviderId: (providerId: any) => {
      setAiServiceModelSource('mermaidFix', `provider:${String(providerId || '')}`)
    },
    setMermaidFixModelSource: (source: any) => {
      setAiServiceModelSource('mermaidFix', source)
    },
    setMermaidFixModelId: (modelId: any) => {
      setAiServiceModelId('mermaidFix', modelId)
    },
    setMermaidFixSystemPrompt: (systemPrompt: any) => {
      if (!state.data) return
      const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.systemPrompt = p
      saveMeta().catch(() => {})
      emit()
    },
    resetMermaidFixSystemPromptDefault: () => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {} as any
      state.data.settings.aiServices.mermaidFix.systemPrompt = DEFAULT_MERMAID_FIX_SYSTEM_PROMPT
      saveMeta().catch(() => {})
      emit()
    },
    setChatTitleNamingEnabled: (on: any) => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.enabled = !!on
      saveMeta().catch(() => {})
      emit()
    },
    setChatTitleNamingProviderId: (providerId: any) => {
      setAiServiceModelSource('chatTitleNaming', `provider:${String(providerId || '')}`)
    },
    setChatTitleNamingModelSource: (source: any) => {
      setAiServiceModelSource('chatTitleNaming', source)
    },
    setChatTitleNamingModelId: (modelId: any) => {
      setAiServiceModelId('chatTitleNaming', modelId)
    },
    setChatTitleNamingSystemPrompt: (systemPrompt: any) => {
      if (!state.data) return
      const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.systemPrompt = p
      saveMeta().catch(() => {})
      emit()
    },
    resetChatTitleNamingSystemPromptDefault: () => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {} as any
      state.data.settings.aiServices.chatTitleNaming.systemPrompt = DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT
      saveMeta().catch(() => {})
      emit()
    },
    setStickerNamingEnabled: (on: any) => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.enabled = !!on
      saveMeta().catch(() => {})
      emit()
    },
    setStickerNamingProviderId: (providerId: any) => {
      setAiServiceModelSource('stickerNaming', `provider:${String(providerId || '')}`)
    },
    setStickerNamingModelSource: (source: any) => {
      setAiServiceModelSource('stickerNaming', source)
    },
    setStickerNamingModelId: (modelId: any) => {
      setAiServiceModelId('stickerNaming', modelId)
    },
    setStickerNamingSystemPrompt: (systemPrompt: any) => {
      if (!state.data) return
      const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.systemPrompt = p
      saveMeta().catch(() => {})
      emit()
    },
    resetStickerNamingSystemPromptDefault: () => {
      if (!state.data) return
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {} as any
      state.data.settings.aiServices.stickerNaming.systemPrompt = DEFAULT_STICKER_NAMING_SYSTEM_PROMPT
      saveMeta().catch(() => {})
      emit()
    },
    setContextCompressionProviderId: (providerId: any) => {
      setAiServiceModelSource('contextCompression', `provider:${String(providerId || '')}`)
    },
    setContextCompressionModelSource: (source: any) => {
      setAiServiceModelSource('contextCompression', source)
    },
    setContextCompressionModelId: (modelId: any) => {
      setAiServiceModelId('contextCompression', modelId)
    },
    setContextCompressionRetainRecentMessages: (value: any) => {
      if (!state.data) return
      const count = clamp(
        Math.round(Number(value || DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES)),
        CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
        CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
      )
      if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
      if (!state.data.settings.aiServices.contextCompression || typeof state.data.settings.aiServices.contextCompression !== 'object') state.data.settings.aiServices.contextCompression = {} as any
      state.data.settings.aiServices.contextCompression.retainRecentMessages = count
      saveMeta().catch(() => {})
      emit()
    },
  }
}
