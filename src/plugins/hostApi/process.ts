import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'
import { V3_METHOD } from './v3/methodNames'
import { expectPlainObject, readNonEmptyString, readOptionalNumber, isLikelyAbsolutePath } from './v3/validate'

const PROCESS_BRIDGE_TIMEOUT_MS = 15 * 60 * 1000

function readOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined
  const s = String(value ?? '').trim()
  if (!s) return undefined
  if (s.includes('\n') || s.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} must be a single line`)
  return s
}

function readOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} must be an array`)
  const out: string[] = []
  for (const it of value) {
    const s = String(it ?? '')
    if (s.length > 2048) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} item too long`)
    if (s.includes('\n') || s.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} item must be a single line`)
    out.push(s)
    if (out.length > 64) throw new PluginBridgeError('BAD_REQUEST', `${fieldName} too many items`)
  }
  return out
}

function readOptionalEnv(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  const obj = expectPlainObject(value, 'env must be an object')
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(obj)) {
    const kk = String(k ?? '').trim()
    if (!kk) continue
    if (kk.length > 128) throw new PluginBridgeError('BAD_REQUEST', 'env key too long')
    if (kk.includes('\n') || kk.includes('\r') || kk.includes('\0') || kk.includes('=')) {
      throw new PluginBridgeError('BAD_REQUEST', 'env key is invalid')
    }
    const vv = String(v ?? '')
    if (vv.length > 4096) throw new PluginBridgeError('BAD_REQUEST', 'env value too long')
    if (vv.includes('\0')) throw new PluginBridgeError('BAD_REQUEST', 'env value is invalid')
    out[kk] = vv
    n += 1
    if (n > 64) throw new PluginBridgeError('BAD_REQUEST', 'env has too many entries')
  }
  return out
}

function readOptionalCwd(value: unknown): string | undefined {
  const s = readOptionalString(value, 'cwd')
  if (!s) return undefined
  // 前端只做最基本校验：绝对/相对均允许，真正的安全范围在 Rust 宿主侧治理。
  // 这里额外过滤一下明显的奇怪输入，避免无意义请求。
  if (s.length > 1024) throw new PluginBridgeError('BAD_REQUEST', 'cwd is too long')
  if (isLikelyAbsolutePath(s)) return s
  return s
}

export const processMethods: PluginMethodRegistry = {
  [V3_METHOD.process.openExternalUrl]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.openExternalUrl', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.openExternalUrl payload must be an object')
      const url = readNonEmptyString(req.url, 'url')
      await invokeWithTimeout('process_open_external_url', { url }, PROCESS_BRIDGE_TIMEOUT_MS)
      return null
    },
  },
  [V3_METHOD.process.openExternalUri]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.openExternalUri', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.openExternalUri payload must be an object')
      const uri = readNonEmptyString((req as any).uri ?? (req as any).url, 'uri')
      await invokeWithTimeout('process_open_external_uri', { uri }, PROCESS_BRIDGE_TIMEOUT_MS)
      return null
    },
  },
  [V3_METHOD.process.openBrowserWindow]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.openBrowserWindow', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.openBrowserWindow payload must be an object')
      const url = readNonEmptyString(req.url, 'url')
      await invokeWithTimeout('process_open_browser_window', { pluginId: ctx.id, url }, PROCESS_BRIDGE_TIMEOUT_MS)
      return null
    },
  },

  [V3_METHOD.process.run]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.run', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.run payload must be an object')
      const command = readNonEmptyString(req.command, 'command')
      const payload = {
        command,
        args: readOptionalStringArray(req.args, 'args'),
        cwd: readOptionalCwd(req.cwd),
        env: readOptionalEnv(req.env),
        timeoutMs: readOptionalNumber(req.timeoutMs, 'timeoutMs'),
        maxOutputBytes: readOptionalNumber(req.maxOutputBytes, 'maxOutputBytes'),
      }
      return await invokeWithTimeout('process_run', { pluginId: ctx.id, req: payload }, PROCESS_BRIDGE_TIMEOUT_MS)
    },
  },

  [V3_METHOD.process.spawn]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.spawn', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.spawn payload must be an object')
      const command = readNonEmptyString(req.command, 'command')
      const payload = {
        command,
        args: readOptionalStringArray(req.args, 'args'),
        cwd: readOptionalCwd(req.cwd),
        env: readOptionalEnv(req.env),
        maxOutputBytes: readOptionalNumber(req.maxOutputBytes, 'maxOutputBytes'),
      }
      return await invokeWithTimeout('process_spawn', { pluginId: ctx.id, req: payload }, PROCESS_BRIDGE_TIMEOUT_MS)
    },
  },

  [V3_METHOD.process.kill]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.kill', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.kill payload must be an object')
      const processId = readNonEmptyString(req.processId, 'processId')
      return await invokeWithTimeout('process_kill', { pluginId: ctx.id, processId }, PROCESS_BRIDGE_TIMEOUT_MS)
    },
  },

  [V3_METHOD.process.wait]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:process.wait', 'cap:process.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'process.wait payload must be an object')
      const processId = readNonEmptyString(req.processId, 'processId')
      const timeoutMs = readOptionalNumber(req.timeoutMs, 'timeoutMs')
      const forget = (req as any).forget == null ? undefined : !!(req as any).forget
      return await invokeWithTimeout('process_wait', { pluginId: ctx.id, processId, timeoutMs, forget }, PROCESS_BRIDGE_TIMEOUT_MS)
    },
  },
}

