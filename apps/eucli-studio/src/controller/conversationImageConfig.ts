import { now } from '../core/utils'

export const CONVERSATION_IMAGE_LIMITS = {
  originalBudget: { min: 1, max: 100, default: 2 },
  historyBudget: { min: 1, max: 1000, default: 6 },
} as const

// createConversationImageConfigController 是「会话设置 - 会话图片」的视窗：
// 配置事实与机制全在业务端，本控制器只负责读取、编辑草稿与保存。
export function createConversationImageConfigController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: (msg: string) => void
}) {
  function currentBox() {
    const state = deps.getState()
    if (!state.conversationImageConfig || typeof state.conversationImageConfig !== 'object') state.conversationImageConfig = defaultConversationImageConfigState()
    state.conversationImageConfig = { ...defaultConversationImageConfigState(), ...state.conversationImageConfig }
    return { state, box: state.conversationImageConfig }
  }

  function patchBox(patch: Record<string, any>) {
    const { state, box } = currentBox()
    state.conversationImageConfig = { ...defaultConversationImageConfigState(), ...box, ...patch }
  }

  async function refreshConversationImageConfig(force = false) {
    const { box } = currentBox()
    const age = now() - Number(box.fetchedAt || 0)
    if (!force && box.value && age < 60 * 1000) return box.value

    patchBox({ loading: true, error: '' })
    deps.emit()

    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/conversation-image/config', timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const value = normalizeConversationImageConfig(response?.body)
      patchBox({ loading: false, error: '', value, draft: draftFromConfig(value), fetchedAt: now() })
      return value
    } catch (e: any) {
      const error = String(e?.message || e || '加载会话图片配置失败')
      patchBox({ loading: false, error })
      deps.showToast?.(error)
      return null
    } finally {
      deps.emit()
    }
  }

  function setConversationImageConfigDraft(fieldRaw: any, value: any) {
    const field = String(fieldRaw || '').trim()
    if (!isDraftField(field)) return
    const { box } = currentBox()
    patchBox({ draft: { ...defaultDraft(), ...(box.draft || {}), [field]: value }, saveError: '' })
    deps.emit()
  }

  function resetConversationImageConfigDraftToDefaults() {
    patchBox({ draft: draftFromConfig(defaultConversationImageConfig()), saveError: '' })
    deps.emit()
  }

  async function saveConversationImageConfig() {
    const { box } = currentBox()
    let config: any
    try {
      config = configFromDraft(box.draft)
    } catch (e: any) {
      const error = String(e?.message || e || '会话图片配置无效')
      patchBox({ saveError: error })
      deps.showToast?.(error)
      deps.emit()
      return false
    }

    patchBox({ saving: true, saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: '/api/conversation-image/config', body: config, timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const value = normalizeConversationImageConfig(response?.body)
      patchBox({ saving: false, saveError: '', value, draft: draftFromConfig(value), fetchedAt: now() })
      deps.showToast?.('会话图片配置已保存')
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '保存会话图片配置失败')
      patchBox({ saving: false, saveError: error })
      deps.showToast?.(error)
      return false
    } finally {
      deps.emit()
    }
  }

  return {
    refreshConversationImageConfig,
    setConversationImageConfigDraft,
    resetConversationImageConfigDraftToDefaults,
    saveConversationImageConfig,
  }
}

export function defaultConversationImageConfigState() {
  const value = defaultConversationImageConfig()
  return {
    loading: false,
    error: '',
    saving: false,
    saveError: '',
    value,
    draft: draftFromConfig(value),
    fetchedAt: 0,
  }
}

export function normalizeConversationImageConfig(value: any) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    multiVersionEnabled: source.multiVersionEnabled !== false,
    originalBudgetEnabled: source.originalBudgetEnabled !== false,
    originalBudgetCount: normalizeCount(source.originalBudgetCount, CONVERSATION_IMAGE_LIMITS.originalBudget.default, CONVERSATION_IMAGE_LIMITS.originalBudget.min, CONVERSATION_IMAGE_LIMITS.originalBudget.max),
    historyBudgetEnabled: source.historyBudgetEnabled !== false,
    historyBudgetCount: normalizeCount(source.historyBudgetCount, CONVERSATION_IMAGE_LIMITS.historyBudget.default, CONVERSATION_IMAGE_LIMITS.historyBudget.min, CONVERSATION_IMAGE_LIMITS.historyBudget.max),
    updatedAt: source.updatedAt,
  }
}

function defaultConversationImageConfig() {
  return {
    multiVersionEnabled: true,
    originalBudgetEnabled: true,
    originalBudgetCount: CONVERSATION_IMAGE_LIMITS.originalBudget.default,
    historyBudgetEnabled: true,
    historyBudgetCount: CONVERSATION_IMAGE_LIMITS.historyBudget.default,
  }
}

function draftFromConfig(config: any) {
  const value = normalizeConversationImageConfig(config)
  return {
    multiVersionEnabled: value.multiVersionEnabled,
    originalBudgetEnabled: value.originalBudgetEnabled,
    originalBudgetCount: String(value.originalBudgetCount),
    historyBudgetEnabled: value.historyBudgetEnabled,
    historyBudgetCount: String(value.historyBudgetCount),
  }
}

function defaultDraft() {
  return draftFromConfig(defaultConversationImageConfig())
}

function configFromDraft(draftRaw: any) {
  const draft = { ...defaultDraft(), ...(draftRaw && typeof draftRaw === 'object' ? draftRaw : {}) }
  return {
    multiVersionEnabled: draft.multiVersionEnabled !== false,
    originalBudgetEnabled: draft.originalBudgetEnabled !== false,
    originalBudgetCount: parseCount('原图预算张数', draft.originalBudgetCount, CONVERSATION_IMAGE_LIMITS.originalBudget.min, CONVERSATION_IMAGE_LIMITS.originalBudget.max),
    historyBudgetEnabled: draft.historyBudgetEnabled !== false,
    historyBudgetCount: parseCount('历史图片预算张数', draft.historyBudgetCount, CONVERSATION_IMAGE_LIMITS.historyBudget.min, CONVERSATION_IMAGE_LIMITS.historyBudget.max),
  }
}

function parseCount(label: string, value: any, min: number, max: number) {
  const count = Number(String(value ?? '').trim())
  if (!Number.isInteger(count)) throw new Error(`${label}必须是整数`)
  if (count < min || count > max) throw new Error(`${label}必须在 ${min}-${max} 之间`)
  return count
}

function normalizeCount(value: any, fallback: number, min: number, max: number) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return fallback
  return Math.min(max, Math.max(min, Math.round(count)))
}

function isDraftField(value: string) {
  return value === 'multiVersionEnabled' || value === 'originalBudgetEnabled' || value === 'originalBudgetCount' || value === 'historyBudgetEnabled' || value === 'historyBudgetCount'
}
