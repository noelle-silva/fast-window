import type { PluginContext } from '../pluginApi'
import { PluginBridgeError } from '../pluginBridge'
import { isTrustedLocalApp, usesSystemBackend } from '../pluginProfiles'

export function isCapabilityAllowed(requires: readonly string[] | undefined, needed: string): boolean {
  if (!requires || requires.length === 0) return false

  for (const raw of requires) {
    const cap = String(raw ?? '').trim()
    if (!cap) continue
    if (cap === needed) return true
    if (cap.endsWith('*')) {
      const prefix = cap.slice(0, -1)
      if (needed.startsWith(prefix)) return true
    }
  }

  return false
}

export function isTauriCommandAllowed(requires: readonly string[] | undefined, command: string): boolean {
  if (!requires || requires.length === 0) return false

  const needed = `tauri:${command}`
  const highRisk = command.startsWith('plugin:shell|')

  for (const raw of requires) {
    const cap = String(raw ?? '').trim()
    if (!cap.startsWith('tauri:')) continue

    if (highRisk) {
      if (cap === needed) return true
      continue
    }

    if (cap === 'tauri:*') return true
    if (cap === needed) return true

    if (cap.endsWith('*')) {
      const prefix = cap.slice(0, -1)
      if (needed.startsWith(prefix)) return true
    }
  }

  return false
}

export function requireAnyCapability(ctx: PluginContext, needed: string[], message?: string) {
  if (!usesSystemBackend(ctx.apiVersion)) return
  if (isTrustedLocalApp(ctx.apiVersion) && needed.some(cap => cap.startsWith('cap:background.') || cap.startsWith('cap:host.'))) return
  if (needed.some(cap => isCapabilityAllowed(ctx.requires, cap))) return

  throw new PluginBridgeError(
    'CAPABILITY_DENIED',
    message || `Capability denied: ${needed.join(' or ')}`,
    { needed },
  )
}
