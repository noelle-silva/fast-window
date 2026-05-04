import { HyperCortexRpc } from '../shared/rpcMethods'
import type { BackgroundClient } from './backgroundClient'
import { createToast } from './toast'
import type { HostGateway } from './types'

export function createHostGateway(baseApi: any, background: BackgroundClient): HostGateway {
  const base = baseApi || {}
  const baseToast = base?.ui && typeof base.ui.showToast === 'function' ? ((message: string) => base.ui.showToast(message)) : null
  const toast = createToast()

  return {
    async toast(message: string) {
      const m = String(message ?? '').trim()
      if (!m) return
      if (baseToast) return baseToast(m)
      toast(m)
    },
    async back() {
      if (typeof base?.ui?.back === 'function') return base.ui.back()
      if (typeof base?.host?.back === 'function') return base.host.back()
      throw new Error('无法返回')
    },
    async startDragging() {
      if (typeof base?.ui?.startDragging === 'function') return base.ui.startDragging()
      if (typeof base?.host?.startDragging === 'function') return base.host.startDragging()
      throw new Error('v4 宿主未提供 startDragging')
    },
    async getLibraryDir() {
      return background.invoke(HyperCortexRpc.host.getLibraryDir, {})
    },
    async openDir(dir: string) {
      const s = String(dir || '').trim()
      if (!s) throw new Error('dir 不能为空')
      return background.invoke(HyperCortexRpc.host.openDir, { dir: s })
    },
  }
}
