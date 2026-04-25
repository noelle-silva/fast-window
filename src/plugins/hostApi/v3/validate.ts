import { PluginBridgeError } from '../../pluginBridge'

export type PlainObject = Record<string, unknown>

export function expectPlainObject(value: unknown, message: string): PlainObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginBridgeError('BAD_REQUEST', message)
  }
  return value as PlainObject
}

export function readNonEmptyString(value: unknown, fieldName: string): string {
  const s = String(value ?? '').trim()
  if (!s) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} is required`)
  if (s.includes('\n') || s.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} must be a single line`)
  return s
}

export function readOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new PluginBridgeError('BAD_REQUEST', `${fieldName} must be a number`)
  }
  return value
}

export function readOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new PluginBridgeError('BAD_REQUEST', `${fieldName} must be a boolean`)
  return value
}

export function isLikelyAbsolutePath(path: string): boolean {
  // Windows: C:\... / \\server\share\...
  if (/^[A-Za-z]:[\\/]/.test(path)) return true
  if (/^\\\\[^\\]/.test(path)) return true
  // Unix: /...
  if (path.startsWith('/')) return true
  return false
}

