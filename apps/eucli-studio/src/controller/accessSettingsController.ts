import { now } from '../core/utils'
import type { AiChatShowToast } from '../gateway/capabilities'
import {
  normalizeBoxInfo,
  normalizePersistentKeyCreated,
  normalizePersistentKeyView,
  normalizePersistentPort,
  type BoxInfo,
  type PersistentKeyCreated,
  type PersistentKeyView,
  type PersistentPort,
} from '../domain/accessSettings'

export function createAccessSettingsController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: AiChatShowToast
}) {
  function currentSection() {
    const state = deps.getState()
    if (!state.accessSettings || typeof state.accessSettings !== 'object') state.accessSettings = defaultAccessSettingsState()
    return { state, section: state.accessSettings }
  }

  function patchSection(patch: Record<string, any>) {
    const { state, section } = currentSection()
    state.accessSettings = { ...defaultAccessSettingsState(), ...section, ...patch }
  }

  async function refreshPorts() {
    const { section } = currentSection()
    patchSection({ portsLoading: true, portsError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/access/persistent-ports', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const ports = Array.isArray(response?.body) ? response.body.map(normalizePersistentPort) : []
      patchSection({ portsLoading: false, portsError: '', ports })
      return ports
    } catch (e: any) {
      const error = String(e?.message || e || '长期端口列表加载失败')
      patchSection({ portsLoading: false, portsError: error, ports: Array.isArray(section.ports) ? section.ports : [] })
      deps.showToast?.(error, { kind: 'error' })
      return section.ports || []
    } finally {
      deps.emit()
    }
  }

  async function addPort(name: string, port: number) {
    patchSection({ portsSaving: true, portsError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'POST', path: '/api/access/persistent-ports', body: { name, port }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshPorts()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '新增长期端口失败')
      patchSection({ portsError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ portsSaving: false })
      deps.emit()
    }
  }

  async function enablePort(id: string) {
    patchSection({ portsSaving: true, portsError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/access/persistent-ports/${encodeURIComponent(id)}/enable`, body: {}, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshPorts()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '启用长期端口失败')
      patchSection({ portsError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ portsSaving: false })
      deps.emit()
    }
  }

  async function disablePort(id: string) {
    patchSection({ portsSaving: true, portsError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/access/persistent-ports/${encodeURIComponent(id)}/disable`, body: {}, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshPorts()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '停用长期端口失败')
      patchSection({ portsError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ portsSaving: false })
      deps.emit()
    }
  }

  async function deletePort(id: string) {
    patchSection({ portsSaving: true, portsError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'DELETE', path: `/api/access/persistent-ports/${encodeURIComponent(id)}`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshPorts()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '删除长期端口失败')
      patchSection({ portsError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ portsSaving: false })
      deps.emit()
    }
  }

  async function refreshKeys() {
    const { section } = currentSection()
    patchSection({ keysLoading: true, keysError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/access/persistent-keys', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const keys = Array.isArray(response?.body) ? response.body.map(normalizePersistentKeyView) : []
      patchSection({ keysLoading: false, keysError: '', keys })
      return keys
    } catch (e: any) {
      const error = String(e?.message || e || '长期 Key 列表加载失败')
      patchSection({ keysLoading: false, keysError: error, keys: Array.isArray(section.keys) ? section.keys : [] })
      deps.showToast?.(error, { kind: 'error' })
      return section.keys || []
    } finally {
      deps.emit()
    }
  }

  async function addKey(name: string, expiresAt: string | null): Promise<PersistentKeyCreated | null> {
    patchSection({ keysSaving: true, keysError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'POST', path: '/api/access/persistent-keys', body: { name, expiresAt }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const created = normalizePersistentKeyCreated(response?.body)
      await refreshKeys()
      return created
    } catch (e: any) {
      const error = String(e?.message || e || '新增长期 Key 失败')
      patchSection({ keysError: error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      patchSection({ keysSaving: false })
      deps.emit()
    }
  }

  async function revealKey(id: string): Promise<string | null> {
    patchSection({ keysLoading: true, keysError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/access/persistent-keys/${encodeURIComponent(id)}/reveal`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const body = response?.body && typeof response.body === 'object' ? response.body : {}
      return String(body.plainKey || '').trim()
    } catch (e: any) {
      const error = String(e?.message || e || '查看长期 Key 失败')
      patchSection({ keysError: error })
      deps.showToast?.(error, { kind: 'error' })
      return null
    } finally {
      patchSection({ keysLoading: false })
      deps.emit()
    }
  }

  async function setKeyEnabled(id: string, enabled: boolean) {
    patchSection({ keysSaving: true, keysError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/access/persistent-keys/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, body: {}, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshKeys()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || (enabled ? '启用长期 Key 失败' : '停用长期 Key 失败'))
      patchSection({ keysError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ keysSaving: false })
      deps.emit()
    }
  }

  async function setKeyExpiration(id: string, expiresAt: string | null) {
    patchSection({ keysSaving: true, keysError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/access/persistent-keys/${encodeURIComponent(id)}/expiration`, body: { expiresAt }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshKeys()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '修改长期 Key 有效期失败')
      patchSection({ keysError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ keysSaving: false })
      deps.emit()
    }
  }

  async function deleteKey(id: string) {
    patchSection({ keysSaving: true, keysError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'DELETE', path: `/api/access/persistent-keys/${encodeURIComponent(id)}`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      await refreshKeys()
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '删除长期 Key 失败')
      patchSection({ keysError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      patchSection({ keysSaving: false })
      deps.emit()
    }
  }

  async function loadBoxInfo(): Promise<BoxInfo | null> {
    patchSection({ boxInfoLoading: true, boxInfoError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/box/info', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const info = normalizeBoxInfo(response?.body)
      patchSection({ boxInfoLoading: false, boxInfoError: '', boxInfo: info })
      return info
    } catch (e: any) {
      const error = String(e?.message || e || '业务端信息加载失败')
      patchSection({ boxInfoLoading: false, boxInfoError: error })
      return null
    } finally {
      deps.emit()
    }
  }

  return {
    refreshPorts,
    addPort,
    enablePort,
    disablePort,
    deletePort,
    refreshKeys,
    addKey,
    revealKey,
    setKeyEnabled,
    setKeyExpiration,
    deleteKey,
    loadBoxInfo,
  }
}

export function defaultAccessSettingsState() {
  return {
    ports: [] as PersistentPort[],
    portsLoading: false,
    portsSaving: false,
    portsError: '',
    keys: [] as PersistentKeyView[],
    keysLoading: false,
    keysSaving: false,
    keysError: '',
    boxInfo: null as BoxInfo | null,
    boxInfoLoading: false,
    boxInfoError: '',
    refreshedAt: 0,
  }
}

export function accessSettingsAge(section: any): number {
  return now() - Number(section?.refreshedAt || 0)
}
