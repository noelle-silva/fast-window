import { invoke } from '@tauri-apps/api/core'
import { PluginBridgeError } from '../pluginBridge'

const DEFAULT_TIMEOUT_MS = 8_000
const LONG_TIMEOUT_MS = 15 * 60 * 1000
const PICKER_TIMEOUT_MS = 30 * 60 * 1000

export function joinPath(base: string, rel: string): string {
  const b = String(base ?? '').replace(/[\\/]+$/, '')
  const r = String(rel ?? '').replace(/^[\\/]+/, '')
  if (!b) return r
  if (!r) return b
  return `${b}/${r}`
}

export async function invokeWithTimeout<T>(command: string, payload: any, timeoutMs = resolveCommandTimeoutMs(command)): Promise<T> {
  let timer: any = null
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new PluginBridgeError('INTERNAL_ERROR', 'Request timeout')), timeoutMs)
    })
    return await Promise.race([invoke<T>(command, payload ?? {}), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function resolveCommandTimeoutMs(command: string): number {
  if (command.startsWith('plugin_pick_')) return PICKER_TIMEOUT_MS
  if (command.startsWith('plugin_images_') || command.startsWith('plugin_files_')) return LONG_TIMEOUT_MS
  return DEFAULT_TIMEOUT_MS
}
