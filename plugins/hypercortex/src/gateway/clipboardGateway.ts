import type { ClipboardGateway } from './types'

export function createClipboardGateway(baseApi: any): ClipboardGateway {
  const base = baseApi || {}
  return {
    async writeText(text: string) {
      const s = String(text ?? '')
      if (navigator?.clipboard?.writeText) return navigator.clipboard.writeText(s)
      if (typeof base?.host?.writeClipboardText === 'function') return base.host.writeClipboardText(s)
      throw new Error('剪贴板写入能力不可用')
    },
  }
}
