import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createToast } from '../ui/toast'
import type { HostGateway } from './types'

export function createHostGateway(): HostGateway {
  const toast = createToast()

  return {
    async toast(message: string) {
      const text = String(message || '').trim()
      if (!text) return
      toast(text)
    },
    async back() {
      await getCurrentWindow().hide()
    },
    async startDragging() {
      await getCurrentWindow().startDragging()
    },
    async minimize() {
      await getCurrentWindow().minimize()
    },
    async toggleMaximize() {
      await getCurrentWindow().toggleMaximize()
    },
    async closeToTray() {
      await invoke('hide_to_tray')
    },
  }
}
