import { invoke } from '@tauri-apps/api/core'

function safeText(raw: unknown): string {
  return String(raw ?? '').trim()
}

export async function hostToast(message: unknown): Promise<void> {
  const msg = safeText(message)
  if (!msg) return

  // 优先走 Rust 宿主原语：统一边界 & 让插件/主程序行为一致
  try {
    await invoke('host_toast', { message: msg })
    return
  } catch {
    // fallback：非 tauri 环境（web 预览等）仍能工作
  }

  try {
    window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message: msg } }))
  } catch {}
}

export async function hostActivatePlugin(pluginId: unknown): Promise<void> {
  const pid = safeText(pluginId)
  if (!pid) return

  try {
    await invoke('host_activate_plugin', { pluginId: pid })
    return
  } catch {
    // fallback：让宿主至少能在纯前端模式下接住（App.tsx 也会监听这个事件）
  }

  try {
    window.dispatchEvent(new CustomEvent('fast-window:activate-plugin', { detail: { pluginId: pid } }))
  } catch {}
}

