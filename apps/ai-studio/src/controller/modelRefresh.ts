import { now, trimSlash, isHttpBaseUrl } from '../core/utils'

export function createModelRefresh(deps: {
  getState: () => any
  getProvider: (pid: string) => any
  netRequest: (req: any) => Promise<any>
  save: () => Promise<void>
  emit: () => void
  showToast?: (msg: string) => void
}) {
  async function refreshModels(providerId, force) {
    const s = deps.getState()
    const p = deps.getProvider(providerId)
    if (!p) return

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()

    if (!baseUrl || !isHttpBaseUrl(baseUrl)) {
      s.models = { loading: false, error: '请先配置 Base URL（http/https）', items: [] }
      deps.emit()
      return
    }
    if (!apiKey) {
      s.models = { loading: false, error: '请先配置 API Key', items: [] }
      deps.emit()
      return
    }

    const cache = p.modelsCache || { items: [], fetchedAt: 0 }
    const age = now() - Number(cache.fetchedAt || 0)
    if (!force && Array.isArray(cache.items) && cache.items.length && age < 5 * 60 * 1000) {
      s.models = { loading: false, error: '', items: cache.items.slice(0, 300) }
      deps.emit()
      return
    }

    s.models = { loading: true, error: '', items: [] }
    deps.emit()

    try {
      const r = await deps.netRequest({
        method: 'GET',
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 20000,
      })

      const status = Number(r?.status || 0)
      const bodyText = String(r?.body || '')
      const json = JSON.parse(bodyText || '{}')
      if (status < 200 || status >= 300) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)

      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : null
      if (!list) throw new Error('models 响应格式不支持（期望 data[] 或 models[]）')

      const ids = list
        .map((m) => (m && typeof m.id === 'string' ? m.id : ''))
        .filter((x) => !!x)
        .slice(0, 800)
        .sort((a, b) => String(a).localeCompare(String(b)))

      p.modelsCache = { items: ids, fetchedAt: now() }
      await deps.save()

      s.models = { loading: false, error: '', items: ids.slice(0, 300) }
      deps.showToast?.(`模型已刷新（${ids.length}）`)
    } catch (e) {
      s.models = { loading: false, error: String(e?.message || e || '获取模型失败'), items: [] }
      deps.showToast?.(s.models.error || '获取模型失败')
    } finally {
      deps.emit()
    }
  }

  function resolveAiModelId(modelPick, customModelId) {
    const pick = String(modelPick || '').trim()
    if (!pick) return ''
    if (pick === '__custom__') return String(customModelId || '').trim()
    return pick
  }

  return {
    refreshModels,
    resolveAiModelId,
  }
}
