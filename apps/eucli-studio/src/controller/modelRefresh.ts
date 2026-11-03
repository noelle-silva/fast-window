import { now } from '../core/utils'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createModelRefresh(deps: {
  getState: () => any
  getProvider: (pid: string) => any
  netRequest: (req: any) => Promise<any>
  persistProvider: (provider: any) => Promise<void>
  emit: () => void
  showToast?: AiChatShowToast
}) {
  async function refreshModels(providerId: string, force: boolean) {
    const s = deps.getState()
    const p = deps.getProvider(providerId)
    if (!p) return

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
        method: 'POST',
        path: `/api/providers/${encodeURIComponent(providerId)}/models/refresh`,
      })

      const status = Number(r?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)

      const ids = modelIdsFromRefreshResult(r?.body)

      p.modelsCache = { items: ids, fetchedAt: now() }
      s.models = { loading: false, error: '', items: ids.slice(0, 300) }

      // 刷新结果必须落盘：modelsCache 是供应商实体的一部分，重启后由它投影出
      // Provider.models。保存失败时保留内存结果，但明确告知用户未持久化。
      try {
        await deps.persistProvider(p)
        deps.showToast?.(`模型已刷新（${ids.length}）`, { kind: 'success' })
      } catch (persistError: any) {
        const reason = String(persistError?.message || persistError || '未知错误')
        deps.showToast?.(`模型已刷新（${ids.length}），但保存失败：${reason}（仅保留在内存，重启后需重新刷新）`, { kind: 'error' })
      }
    } catch (e: any) {
      s.models = { loading: false, error: String(e?.message || e || '获取模型失败'), items: [] }
      deps.showToast?.(s.models.error || '获取模型失败', { kind: 'error' })
    } finally {
      deps.emit()
    }
  }

  return {
    refreshModels,
  }
}

function modelIdsFromRefreshResult(body: any) {
  const payload = typeof body === 'string' ? parseJSON(body) : body
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : null
  if (!list) throw new Error('models 响应格式不支持（期望 data[] 或 models[]）')
  return list
    .map((model: any) => String(model?.id || '').trim())
    .filter(Boolean)
    .slice(0, 800)
    .sort((a: string, b: string) => a.localeCompare(b))
}

function parseJSON(text: string) {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return null
  }
}
