import { now } from '../core/utils'

export const MODEL_REQUEST_TIMEOUT_LIMITS = {
  listModels: { minMs: 5_000, maxMs: 120_000, defaultMs: 30_000 },
  completion: { minMs: 30_000, maxMs: 600_000, defaultMs: 300_000 },
  streamIdle: { minMs: 15_000, maxMs: 300_000, defaultMs: 120_000 },
} as const

type ModelRequestConfigDraftKey = 'listModelsTimeoutSec' | 'completionTimeoutSec' | 'streamIdleTimeoutSec'

export function createModelRequestConfigController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: (msg: string) => void
}) {
  function currentBox() {
    const state = deps.getState()
    if (!state.modelRequestConfig || typeof state.modelRequestConfig !== 'object') state.modelRequestConfig = defaultModelRequestConfigState()
    state.modelRequestConfig = { ...defaultModelRequestConfigState(), ...state.modelRequestConfig }
    return { state, box: state.modelRequestConfig }
  }

  function patchBox(patch: Record<string, any>) {
    const { state, box } = currentBox()
    state.modelRequestConfig = { ...defaultModelRequestConfigState(), ...box, ...patch }
  }

  async function refreshModelRequestConfig(force = false) {
    const { box } = currentBox()
    const age = now() - Number(box.fetchedAt || 0)
    if (!force && box.value && age < 60 * 1000) return box.value

    patchBox({ loading: true, error: '' })
    deps.emit()

    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/providers/model-request-config', timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const value = normalizeModelRequestConfig(response?.body)
      patchBox({ loading: false, error: '', value, draft: draftFromConfig(value), fetchedAt: now() })
      return value
    } catch (e: any) {
      const error = String(e?.message || e || '加载 e-b 模型请求配置失败')
      patchBox({ loading: false, error })
      deps.showToast?.(error)
      return null
    } finally {
      deps.emit()
    }
  }

  function setModelRequestConfigDraft(keyRaw: any, value: any) {
    const key = String(keyRaw || '').trim() as ModelRequestConfigDraftKey
    if (!isDraftKey(key)) return
    const { box } = currentBox()
    patchBox({ draft: { ...defaultDraft(), ...(box.draft || {}), [key]: String(value ?? '') }, saveError: '' })
    deps.emit()
  }

  function resetModelRequestConfigDraftToDefaults() {
    patchBox({ draft: draftFromConfig(defaultModelRequestConfig()), saveError: '' })
    deps.emit()
  }

  async function saveModelRequestConfig() {
    const { box } = currentBox()
    let config: any
    try {
      config = configFromDraft(box.draft)
    } catch (e: any) {
      const error = String(e?.message || e || 'e-b 模型请求配置无效')
      patchBox({ saveError: error })
      deps.showToast?.(error)
      deps.emit()
      return false
    }

    patchBox({ saving: true, saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: '/api/providers/model-request-config', body: config, timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const value = normalizeModelRequestConfig(response?.body)
      patchBox({ saving: false, saveError: '', value, draft: draftFromConfig(value), fetchedAt: now() })
      deps.showToast?.('e-b 模型请求配置已保存')
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '保存 e-b 模型请求配置失败')
      patchBox({ saving: false, saveError: error })
      deps.showToast?.(error)
      return false
    } finally {
      deps.emit()
    }
  }

  return {
    refreshModelRequestConfig,
    setModelRequestConfigDraft,
    resetModelRequestConfigDraftToDefaults,
    saveModelRequestConfig,
  }
}

export function defaultModelRequestConfigState() {
  const value = defaultModelRequestConfig()
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

export function normalizeModelRequestConfig(value: any) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    listModelsTimeoutMs: normalizeTimeoutMs(source.listModelsTimeoutMs, MODEL_REQUEST_TIMEOUT_LIMITS.listModels.defaultMs),
    completionTimeoutMs: normalizeTimeoutMs(source.completionTimeoutMs, MODEL_REQUEST_TIMEOUT_LIMITS.completion.defaultMs),
    streamIdleTimeoutMs: normalizeTimeoutMs(source.streamIdleTimeoutMs, MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.defaultMs),
    updatedAt: source.updatedAt,
  }
}

function defaultModelRequestConfig() {
  return {
    listModelsTimeoutMs: MODEL_REQUEST_TIMEOUT_LIMITS.listModels.defaultMs,
    completionTimeoutMs: MODEL_REQUEST_TIMEOUT_LIMITS.completion.defaultMs,
    streamIdleTimeoutMs: MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.defaultMs,
  }
}

function draftFromConfig(config: any) {
  const value = normalizeModelRequestConfig(config)
  return {
    listModelsTimeoutSec: String(Math.round(value.listModelsTimeoutMs / 1000)),
    completionTimeoutSec: String(Math.round(value.completionTimeoutMs / 1000)),
    streamIdleTimeoutSec: String(Math.round(value.streamIdleTimeoutMs / 1000)),
  }
}

function defaultDraft() {
  return draftFromConfig(defaultModelRequestConfig())
}

function configFromDraft(draftRaw: any) {
  const draft = { ...defaultDraft(), ...(draftRaw && typeof draftRaw === 'object' ? draftRaw : {}) }
  return {
    listModelsTimeoutMs: parseTimeoutSeconds('模型列表总超时', draft.listModelsTimeoutSec, MODEL_REQUEST_TIMEOUT_LIMITS.listModels.minMs, MODEL_REQUEST_TIMEOUT_LIMITS.listModels.maxMs),
    completionTimeoutMs: parseTimeoutSeconds('非流式生成总超时', draft.completionTimeoutSec, MODEL_REQUEST_TIMEOUT_LIMITS.completion.minMs, MODEL_REQUEST_TIMEOUT_LIMITS.completion.maxMs),
    streamIdleTimeoutMs: parseTimeoutSeconds('流式空闲超时', draft.streamIdleTimeoutSec, MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.minMs, MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.maxMs),
  }
}

function parseTimeoutSeconds(label: string, value: any, minMs: number, maxMs: number) {
  const seconds = Number(String(value ?? '').trim())
  if (!Number.isFinite(seconds)) throw new Error(`${label}必须是数字`)
  const ms = Math.round(seconds * 1000)
  if (ms < minMs || ms > maxMs) throw new Error(`${label}必须在 ${Math.round(minMs / 1000)}-${Math.round(maxMs / 1000)} 秒之间`)
  return ms
}

function normalizeTimeoutMs(value: any, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(n)
}

function isDraftKey(value: string): value is ModelRequestConfigDraftKey {
  return value === 'listModelsTimeoutSec' || value === 'completionTimeoutSec' || value === 'streamIdleTimeoutSec'
}
