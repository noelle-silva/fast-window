import { clamp } from '../../core/utils'
import {
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
  DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
} from '../../domain/constants'
import type { AiChatAssistService } from '../../protocol/aiChatProtocol'
import { refreshScopes } from '../../domain/uiRefreshScope'

export function createAiServiceActions(deps: {
  state: any
  emit: () => void
  emitScope?: (scope: string) => void
  saveAssistConfig: (service: AiChatAssistService, config: Record<string, any>) => Promise<any>
}) {
  const { state, emit, emitScope, saveAssistConfig } = deps

  function notifySettings() {
    if (emitScope) {
      emitScope(refreshScopes.settings())
      return
    }
    emit()
  }

  function ensureAiServiceConfig(serviceName: AiChatAssistService) {
    if (!state.data) return null
    if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {} as any
    const services = state.data.settings.aiServices as any
    if (!services[serviceName] || typeof services[serviceName] !== 'object') services[serviceName] = {} as any
    return services[serviceName] as any
  }

  function persistAiService(serviceName: AiChatAssistService) {
    const config = ensureAiServiceConfig(serviceName)
    if (!config) return
    saveAssistConfig(serviceName, { ...config }).catch(() => {})
  }

  function patchAiService(serviceName: AiChatAssistService, patch: Record<string, any>) {
    const box = ensureAiServiceConfig(serviceName)
    if (!box) return
    Object.assign(box, patch)
    persistAiService(serviceName)
    notifySettings()
  }

  function setAiServiceModelSource(serviceName: AiChatAssistService, value: any) {
    const raw = String(value || '')
    const parts = raw.split(':')
    const kind = parts[0] === 'model_group' ? 'model_group' : 'provider'
    const id = parts.slice(1).join(':')
    patchAiService(serviceName, {
      kind,
      providerId: kind === 'provider' ? id : '',
      groupId: kind === 'model_group' ? id : '',
      modelId: '',
      customModelId: '',
    })
  }

  function setAiServiceModelId(serviceName: AiChatAssistService, modelId: any) {
    patchAiService(serviceName, { modelId: String(modelId || ''), customModelId: '' })
  }

  function setAiServiceLowTemperature(serviceName: AiChatAssistService, value: any) {
    patchAiService(serviceName, { lowTemperature: !!value })
  }

  function setAiServiceSystemPrompt(serviceName: AiChatAssistService, systemPrompt: any) {
    const prompt = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
    patchAiService(serviceName, { systemPrompt: prompt })
  }

  return {
    setMermaidFixEnabled: (on: any) => {
      patchAiService('mermaidFix', { enabled: !!on })
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
      setAiServiceSystemPrompt('mermaidFix', systemPrompt)
    },
    resetMermaidFixSystemPromptDefault: () => {
      setAiServiceSystemPrompt('mermaidFix', DEFAULT_MERMAID_FIX_SYSTEM_PROMPT)
    },
    setChatTitleNamingEnabled: (on: any) => {
      patchAiService('chatTitleNaming', { enabled: !!on })
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
      setAiServiceSystemPrompt('chatTitleNaming', systemPrompt)
    },
    resetChatTitleNamingSystemPromptDefault: () => {
      setAiServiceSystemPrompt('chatTitleNaming', DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT)
    },
    setStickerNamingEnabled: (on: any) => {
      patchAiService('stickerNaming', { enabled: !!on })
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
      setAiServiceSystemPrompt('stickerNaming', systemPrompt)
    },
    resetStickerNamingSystemPromptDefault: () => {
      setAiServiceSystemPrompt('stickerNaming', DEFAULT_STICKER_NAMING_SYSTEM_PROMPT)
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
      const count = clamp(
        Math.round(Number(value || DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES)),
        CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
        CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
      )
      patchAiService('contextCompression', { retainRecentMessages: count })
    },
    setContextCompressionLowTemperature: (value: any) => {
      setAiServiceLowTemperature('contextCompression', value)
    },
    setMermaidFixLowTemperature: (value: any) => {
      setAiServiceLowTemperature('mermaidFix', value)
    },
    setChatTitleNamingLowTemperature: (value: any) => {
      setAiServiceLowTemperature('chatTitleNaming', value)
    },
    setStickerNamingLowTemperature: (value: any) => {
      setAiServiceLowTemperature('stickerNaming', value)
    },
  }
}
