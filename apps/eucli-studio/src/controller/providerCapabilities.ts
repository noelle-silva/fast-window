import { now } from '../core/utils'
import { normalizeProviderCapabilities, type ProviderCapabilities } from '../domain/providerCapabilities'

// 能力清单是静态事实，只在页面打开时取一次，缓存窗口取得比模型组更宽。
const PROVIDER_CAPABILITIES_CACHE_MS = 300_000

// createProviderCapabilitiesController 取回业务端声明的协议与思考档位清单。
//
// 客户端不持有任何协议或档位枚举：拿不到清单时下拉只显示已保存的值，
// 绝不编造选项。这是与 modelGroups 策略清单完全相同的取数范式。
export function createProviderCapabilitiesController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
}) {
  function currentBox() {
    const state = deps.getState()
    if (!state.providerCapabilities || typeof state.providerCapabilities !== 'object') {
      state.providerCapabilities = defaultProviderCapabilitiesState()
    }
    state.providerCapabilities = { ...defaultProviderCapabilitiesState(), ...state.providerCapabilities }
    return { state, box: state.providerCapabilities }
  }

  function patchBox(patch: Record<string, any>) {
    const { state, box } = currentBox()
    state.providerCapabilities = { ...defaultProviderCapabilitiesState(), ...box, ...patch }
  }

  // 失败时保留上一次拿到的清单：清单缺席不是致命错误，
  // 渲染层会退化成「只显示已保存的值」。
  async function loadProviderCapabilities(force = false) {
    const { box } = currentBox()
    const cached = box.value as ProviderCapabilities
    const hasCache = cached.protocols.length > 0 || cached.reasoningEfforts.length > 0
    if (!force && hasCache && now() - Number(box.fetchedAt || 0) < PROVIDER_CAPABILITIES_CACHE_MS) return cached
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/capabilities' })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const value = normalizeProviderCapabilities(response?.body)
      patchBox({ error: '', value, fetchedAt: now() })
      deps.emit()
      return value
    } catch (e: any) {
      const error = String(e?.message || e || '加载能力清单失败')
      patchBox({ error })
      deps.emit()
      return { protocols: [], reasoningEfforts: [] }
    }
  }

  function providerCapabilities(): ProviderCapabilities {
    const { box } = currentBox()
    return box.value as ProviderCapabilities
  }

  return { loadProviderCapabilities, providerCapabilities }
}

export function defaultProviderCapabilitiesState() {
  return {
    value: { protocols: [], reasoningEfforts: [] } as ProviderCapabilities,
    error: '',
    fetchedAt: 0,
  }
}
