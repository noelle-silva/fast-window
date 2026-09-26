import { now } from '../core/utils'

export const REQUEST_RECORD_LIMIT_MIN = 1
export const REQUEST_RECORD_LIMIT_MAX = 1000
export const REQUEST_RECORD_LIMIT_DEFAULT = 100

export function defaultRequestRecordsState() {
  return {
    loading: false,
    error: '',
    items: [] as any[],
    fetchedAt: 0,
    selectedId: '',
    detail: null as any,
    detailLoading: false,
    detailError: '',
    config: { enabled: false, limit: REQUEST_RECORD_LIMIT_DEFAULT, updatedAt: '' },
    configLoaded: false,
    configFetchedAt: 0,
    configLoading: false,
    configError: '',
    configSaving: false,
    limitDraft: String(REQUEST_RECORD_LIMIT_DEFAULT),
  }
}

export function createRequestRecordsController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: (msg: string, options?: any) => void
}) {
  function currentBox() {
    const state = deps.getState()
    if (!state.requestRecords || typeof state.requestRecords !== 'object') state.requestRecords = defaultRequestRecordsState()
    state.requestRecords = { ...defaultRequestRecordsState(), ...state.requestRecords }
    return { state, box: state.requestRecords }
  }

  function patchBox(patch: Record<string, any>) {
    const { state, box } = currentBox()
    state.requestRecords = { ...defaultRequestRecordsState(), ...box, ...patch }
  }

  async function refreshRequestRecords(force = false) {
    const { box } = currentBox()
    const age = now() - Number(box.fetchedAt || 0)
    if (!force && Array.isArray(box.items) && box.items.length && age < 60 * 1000) return box.items

    patchBox({ loading: true, error: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/request-records', timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const items = normalizeRequestRecordSummaries(response?.body)
      patchBox({ loading: false, error: '', items, fetchedAt: now() })
      return items
    } catch (e: any) {
      const error = String(e?.message || e || '请求记录加载失败')
      patchBox({ loading: false, error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      deps.emit()
    }
  }

  async function refreshRequestRecordConfig(force = false) {
    const { box } = currentBox()
    const age = now() - Number(box.configFetchedAt || 0)
    if (!force && box.configLoaded && age < 60 * 1000) return box.config

    patchBox({ configLoading: true, configError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/request-records/config', timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const config = normalizeRequestRecordConfig(response?.body)
      patchBox({ configLoading: false, configError: '', config, configLoaded: true, configFetchedAt: now(), limitDraft: String(config.limit) })
      return config
    } catch (e: any) {
      const error = String(e?.message || e || '请求记录配置加载失败')
      patchBox({ configLoading: false, configError: error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      deps.emit()
    }
  }

  async function openRequestRecord(recordIdRaw: any) {
    const recordId = String(recordIdRaw || '').trim()
    if (!recordId) return null
    patchBox({ selectedId: recordId, detailLoading: true, detailError: '', detail: null })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/request-records/${encodeURIComponent(recordId)}`, timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const detail = normalizeRequestRecord(response?.body)
      patchBox({ detailLoading: false, detailError: '', detail })
      return detail
    } catch (e: any) {
      const error = String(e?.message || e || '请求记录详情加载失败')
      patchBox({ detailLoading: false, detailError: error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      deps.emit()
    }
  }

  function setRequestRecordLimitDraft(value: any) {
    const { box } = currentBox()
    patchBox({ limitDraft: String(value ?? '') })
    deps.emit()
  }

  async function setRequestRecordEnabled(enabledRaw: any) {
    return saveRequestRecordConfig({ enabled: !!enabledRaw })
  }

  async function commitRequestRecordLimit() {
    const { box } = currentBox()
    const limit = Number(String(box.limitDraft ?? '').trim())
    if (!Number.isInteger(limit) || limit < REQUEST_RECORD_LIMIT_MIN || limit > REQUEST_RECORD_LIMIT_MAX) {
      patchBox({ limitDraft: String(Number(box.config?.limit) || REQUEST_RECORD_LIMIT_DEFAULT) })
      deps.showToast?.(`保留条数必须在 ${REQUEST_RECORD_LIMIT_MIN}-${REQUEST_RECORD_LIMIT_MAX} 之间`, { kind: 'error' })
      deps.emit()
      return false
    }
    if (limit === Number(box.config?.limit)) {
      patchBox({ limitDraft: String(limit) })
      deps.emit()
      return true
    }
    return saveRequestRecordConfig({ limit })
  }

  async function saveRequestRecordConfig(patch: { enabled?: boolean; limit?: number }) {
    const { box } = currentBox()
    const previous = box.config || {}
    const next = {
      enabled: patch.enabled !== undefined ? !!patch.enabled : !!previous.enabled,
      limit: patch.limit !== undefined ? Number(patch.limit) : Number(previous.limit) || REQUEST_RECORD_LIMIT_DEFAULT,
    }
    patchBox({ configSaving: true, configError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: '/api/request-records/config', body: next, timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const config = normalizeRequestRecordConfig(response?.body)
      patchBox({ configSaving: false, configError: '', config, configLoaded: true, configFetchedAt: now(), limitDraft: String(config.limit) })
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '请求记录配置保存失败')
      patchBox({ configSaving: false, configError: error, config: previous, limitDraft: String(Number(previous?.limit) || REQUEST_RECORD_LIMIT_DEFAULT) })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      deps.emit()
    }
  }

  return {
    refreshRequestRecords,
    refreshRequestRecordConfig,
    openRequestRecord,
    setRequestRecordLimitDraft,
    commitRequestRecordLimit,
    setRequestRecordEnabled,
  }
}

export function normalizeRequestRecordConfig(value: any) {
  const unwrapped = value?.data && typeof value.data === 'object' ? value.data : value
  const source = unwrapped && typeof unwrapped === 'object' ? unwrapped : {}
  const limitRaw = Number(source.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw >= REQUEST_RECORD_LIMIT_MIN && limitRaw <= REQUEST_RECORD_LIMIT_MAX ? Math.round(limitRaw) : REQUEST_RECORD_LIMIT_DEFAULT
  return { enabled: !!source.enabled, limit, updatedAt: source.updatedAt }
}

function normalizeRequestRecordSummaries(value: any) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
  return list.filter((item: any) => item && typeof item === 'object')
}

function normalizeRequestRecord(value: any) {
  const source = value?.data && typeof value.data === 'object' ? value.data : value
  if (!source || typeof source !== 'object') return null
  return source
}
