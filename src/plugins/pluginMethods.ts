import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { PluginContext } from './pluginApi'
import { PluginBridgeError } from './pluginBridge'

export type PluginMethodName =
  | 'host.back'
  | 'tauri.invoke'
  | 'tauri.streamOpen'
  | 'tauri.streamCancel'

type TauriInvokeSpec = {
  command: string
  payload?: any
  timeoutMs?: number | null
}

type TauriStreamCancelSpec = {
  command: string
  payload?: any
  resultKey?: string | null
  idKey?: string | null
}

type TauriStreamOpenSpec = {
  command: string
  payload?: any
  channelKey?: string | null
  timeoutMs?: number | null
  detached?: boolean | null
  cancel?: TauriStreamCancelSpec | null
}

// 注意：payload 可能包含 base64（例如 canvas 图片）；过小会误伤常见用例。
// 这里给一个更现实的默认上限，同时对高危 command（如 shell）再单独收紧。
const MAX_TAURI_INVOKE_JSON_BYTES = 16 * 1024 * 1024
const MAX_TAURI_INVOKE_JSON_BYTES_HIGH_RISK = 256 * 1024
const DEFAULT_TAURI_INVOKE_TIMEOUT_MS = 8000
const MAX_TAURI_INVOKE_TIMEOUT_MS = 5 * 60 * 1000
const LONG_TAURI_INVOKE_TIMEOUT_MS = 15 * 60 * 1000

const MAX_TAURI_STREAMS_TOTAL = 128
const MAX_TAURI_STREAMS_PER_PLUGIN = 32

const STORE_LOAD_COMMAND = 'plugin:store|load'

type StreamHandle = {
  pluginId: string
  closed: boolean
  cancel: () => void
  detachedCancel?: null | {
    command: string
    payload: any
    idKey: string
    resultKey: string | null
    idValue: any
  }
}

const tauriStreams = new Map<string, StreamHandle>()

function approxJsonBytes(value: unknown): number {
  try {
    const raw = JSON.stringify(value)
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(raw).length
    return raw.length * 2
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function isHighRiskTauriCommand(command: string): boolean {
  // 高危：shell 直接执行外部命令/程序。
  // 规则：对高危 command，网关拒绝通配，必须精确命中 tauri:<command>。
  return command.startsWith('plugin:shell|')
}

function safeStringCommand(command: string) {
  if (!command) throw new PluginBridgeError('BAD_REQUEST', 'command is required')
  if (command.length > 256) throw new PluginBridgeError('BAD_REQUEST', 'command is too long')
  if (command.includes('\n') || command.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', 'command is invalid')
}

function tryParseTauriCancelSpec(raw: any): TauriStreamCancelSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const command = String((raw as any).command ?? '').trim()
  if (!command) return null
  const payload = (raw as any).payload ?? {}
  const resultKey = (raw as any).resultKey == null ? null : String((raw as any).resultKey ?? '').trim() || null
  const idKey = (raw as any).idKey == null ? null : String((raw as any).idKey ?? '').trim() || null
  return { command, payload, resultKey, idKey }
}

function resolveCancelId(result: any, resultKey: string | null): any {
  if (!resultKey) return result
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  return (result as any)[resultKey]
}

function isTauriCommandAllowed(requires: readonly string[] | undefined, command: string): boolean {
  if (!requires || requires.length === 0) return false

  const needed = `tauri:${command}`
  const highRisk = isHighRiskTauriCommand(command)

  for (const raw of requires) {
    const cap = String(raw ?? '').trim()
    if (!cap.startsWith('tauri:')) continue

    // 高危 command：只允许精确匹配，不允许任何通配（包括 tauri:*）。
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

function resolveTauriInvokeTimeoutMs(command: string, timeoutMs: unknown): number {
  const requested = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0
  if (requested > 0) {
    return Math.min(requested, MAX_TAURI_INVOKE_TIMEOUT_MS)
  }
  // rfd 文件/目录选择属于“人类交互时长”，默认给长超时。
  if (command.startsWith('plugin_pick_')) return LONG_TAURI_INVOKE_TIMEOUT_MS
  if (command.startsWith('plugin:dialog|')) return LONG_TAURI_INVOKE_TIMEOUT_MS
  return DEFAULT_TAURI_INVOKE_TIMEOUT_MS
}

function makeStreamId(pluginId: string): string {
  return `tauri-${pluginId}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function countStreamsForPlugin(pluginId: string): number {
  let n = 0
  for (const h of tauriStreams.values()) {
    if (h.pluginId === pluginId) n += 1
  }
  return n
}

function isSafePlainKey(key: string): boolean {
  const k = String(key || '').trim()
  if (!k) return false
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') return false
  return true
}

let cachedHostDataDir: string | null = null
let cachedHostDataDirPromise: Promise<string> | null = null

async function getHostDataDir(): Promise<string> {
  if (cachedHostDataDir) return cachedHostDataDir
  if (cachedHostDataDirPromise) return cachedHostDataDirPromise

  cachedHostDataDirPromise = Promise.resolve()
    .then(async () => {
      const dir = await invoke<string>('get_data_dir')
      const s = String(dir ?? '').trim()
      if (!s) throw new PluginBridgeError('INTERNAL_ERROR', 'get_data_dir returned empty')
      cachedHostDataDir = s
      return s
    })
    .finally(() => {
      cachedHostDataDirPromise = null
    })

  return cachedHostDataDirPromise
}

function joinPath(base: string, rel: string): string {
  const b = String(base ?? '').replace(/[\\/]+$/, '')
  const r = String(rel ?? '').replace(/^[\\/]+/, '')
  if (!b) return r
  if (!r) return b
  return `${b}/${r}`
}

function normalizeAndValidateStoreRelativePath(raw: unknown): string {
  const src = String(raw ?? '').trim()
  if (!src) throw new PluginBridgeError('BAD_REQUEST', 'store path is required')
  if (src.includes('\0') || src.includes('\n') || src.includes('\r')) {
    throw new PluginBridgeError('BAD_REQUEST', 'store path is invalid')
  }

  const p = src.replace(/\\/g, '/')

  // Fail fast: forbid absolute paths (Windows drive, UNC, POSIX absolute) and any colon usage.
  if (/^[a-zA-Z]:[\\/]/.test(src) || p.startsWith('/') || src.startsWith('\\\\')) {
    throw new PluginBridgeError('BAD_REQUEST', 'store path must be a safe relative path (absolute path is forbidden)')
  }
  if (p.includes(':')) {
    throw new PluginBridgeError('BAD_REQUEST', 'store path must be a safe relative path (colon is forbidden)')
  }

  const parts = p.split('/')
  if (parts.length < 2) {
    throw new PluginBridgeError('BAD_REQUEST', "store path must be under 'plugins/'")
  }
  if (parts[0] !== 'plugins') {
    throw new PluginBridgeError('BAD_REQUEST', "store path must be under 'plugins/'")
  }

  for (const seg of parts) {
    if (!seg) throw new PluginBridgeError('BAD_REQUEST', 'store path is invalid (empty segment)')
    if (seg === '.' || seg === '..') {
      throw new PluginBridgeError('BAD_REQUEST', 'store path is invalid (directory traversal is forbidden)')
    }
  }

  return parts.join('/')
}

async function rewriteStoreLoadPayload(payload: any): Promise<any> {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  if (!p) throw new PluginBridgeError('BAD_REQUEST', 'payload must be an object')

  const rel = normalizeAndValidateStoreRelativePath((p as any).path)
  const dataDir = await getHostDataDir()
  const abs = joinPath(dataDir, rel)
  return { ...(p as any), path: abs }
}

async function invokeWithTimeout<T>(command: string, payload: any, timeoutMs: number): Promise<T> {
  let timer: any = null
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new PluginBridgeError('INTERNAL_ERROR', 'Request timeout')), timeoutMs)
    })
    // tauri invoke 的 payload 是一个对象（或 undefined）
    return await Promise.race([invoke<T>(command, payload ?? {}), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function validatePluginIdNotForged(pluginId: string, payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return

  const p = payload as any
  const claimed = p.pluginId ?? p.plugin_id
  if (claimed == null) return

  const claimedId = String(claimed || '').trim()
  if (!claimedId) return
  if (claimedId !== pluginId) {
    throw new PluginBridgeError('CAPABILITY_DENIED', 'pluginId mismatch', { expected: pluginId, got: claimedId })
  }
}

type MethodDef = {
  handler: (
    ctx: PluginContext,
    args: unknown[],
    extra: { runtime: 'ui' | 'background'; onBack?: () => void; postStream?: (payload: { streamId: string; event: any }) => void },
  ) => unknown | Promise<unknown>
}

const methods: Record<PluginMethodName, MethodDef> = {
  'host.back': {
    handler: async (_ctx, _args, extra) => {
      if (!extra.onBack) throw new PluginBridgeError('BAD_REQUEST', 'host.back is not available in background runtime')
      extra.onBack()
      return null
    },
  },

  'tauri.invoke': {
    handler: async (ctx, args) => {
      const spec = (args?.[0] as any) as TauriInvokeSpec
      const command = String(spec?.command ?? '').trim()
      safeStringCommand(command)

      if (!isTauriCommandAllowed(ctx.requires, command)) {
        throw new PluginBridgeError('CAPABILITY_DENIED', `Capability denied: tauri:${command}`, { needed: `tauri:${command}` })
      }

      validatePluginIdNotForged(ctx.id, spec?.payload)

      const payload0 = command === STORE_LOAD_COMMAND ? await rewriteStoreLoadPayload(spec?.payload) : (spec?.payload ?? {})

      const size = approxJsonBytes(payload0 ?? null)
      const maxBytes = isHighRiskTauriCommand(command) ? MAX_TAURI_INVOKE_JSON_BYTES_HIGH_RISK : MAX_TAURI_INVOKE_JSON_BYTES
      if (size > maxBytes) {
        throw new PluginBridgeError('BAD_REQUEST', 'payload too large', { maxBytes })
      }

      const timeoutMs = resolveTauriInvokeTimeoutMs(command, spec?.timeoutMs)
      return invokeWithTimeout<any>(command, payload0 ?? {}, timeoutMs)
    },
  },

  'tauri.streamOpen': {
    handler: async (ctx, args, extra) => {
      if (!extra.postStream) throw new PluginBridgeError('BAD_REQUEST', 'postStream is required for tauri.streamOpen')

      const spec = (args?.[0] as any) as TauriStreamOpenSpec
      const command = String(spec?.command ?? '').trim()
      safeStringCommand(command)

      if (!isTauriCommandAllowed(ctx.requires, command)) {
        throw new PluginBridgeError('CAPABILITY_DENIED', `Capability denied: tauri:${command}`, { needed: `tauri:${command}` })
      }

      if (tauriStreams.size >= MAX_TAURI_STREAMS_TOTAL) {
        throw new PluginBridgeError('BAD_REQUEST', 'too many open streams')
      }
      if (countStreamsForPlugin(ctx.id) >= MAX_TAURI_STREAMS_PER_PLUGIN) {
        throw new PluginBridgeError('BAD_REQUEST', 'too many open streams for this plugin')
      }

      const streamId = makeStreamId(ctx.id)

      const post = (event: any) => extra.postStream?.({ streamId, event })

      // 事件监听：command = "event.listen|<eventName>"
      if (command.startsWith('event.listen|')) {
        const eventName = command.slice('event.listen|'.length).trim()
        if (!eventName) throw new PluginBridgeError('BAD_REQUEST', 'event name is required')

        let unlisten: null | (() => void) = null
        const handle: StreamHandle = {
          pluginId: ctx.id,
          closed: false,
          cancel: () => {
            if (handle.closed) return
            handle.closed = true
            try { unlisten?.() } catch {}
          },
          detachedCancel: null,
        }
        tauriStreams.set(streamId, handle)

        post({ type: '__gateway_start', kind: 'event.listen', name: eventName })
        void Promise.resolve()
          .then(async () => {
            const u = await listen(eventName, e => {
              const h = tauriStreams.get(streamId)
              if (!h || h.closed) return
              post({ type: 'event', name: e.event, payload: e.payload, id: (e as any).id })
            })
            unlisten = u
            const h = tauriStreams.get(streamId)
            if (!h || h.closed) {
              try { u() } catch {}
              tauriStreams.delete(streamId)
            }
          })
          .catch(err => {
            const h = tauriStreams.get(streamId)
            if (!h || h.closed) return
            h.closed = true
            post({ type: 'error', message: String((err as any)?.message || err || 'listen failed') })
            post({ type: 'end', canceled: false })
            tauriStreams.delete(streamId)
          })

        return { streamId }
      }

      // Channel 流：创建 Channel，把事件回推到 iframe
      const size = approxJsonBytes(spec?.payload ?? null)
      const maxBytes = isHighRiskTauriCommand(command) ? MAX_TAURI_INVOKE_JSON_BYTES_HIGH_RISK : MAX_TAURI_INVOKE_JSON_BYTES
      if (size > maxBytes) {
        throw new PluginBridgeError('BAD_REQUEST', 'payload too large', { maxBytes })
      }

      const channelKey = String(spec?.channelKey ?? 'channel').trim() || 'channel'
      if (!isSafePlainKey(channelKey)) throw new PluginBridgeError('BAD_REQUEST', 'invalid channelKey')

      const rawPayload = spec?.payload ?? {}
      const isPlainObject = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      if (!isPlainObject) throw new PluginBridgeError('BAD_REQUEST', 'payload must be an object for channel commands')

      validatePluginIdNotForged(ctx.id, rawPayload)

      const timeoutMs = resolveTauriInvokeTimeoutMs(command, spec?.timeoutMs)
      const detached = !!spec?.detached
      const cancelSpec = tryParseTauriCancelSpec((spec as any)?.cancel)

      const handle: StreamHandle = {
        pluginId: ctx.id,
        closed: false,
        cancel: () => {
          handle.closed = true
          const c = handle.detachedCancel
          if (!c) return
          const idKey = c.idKey || 'streamId'
          const payload0 = c.payload && typeof c.payload === 'object' && !Array.isArray(c.payload) ? c.payload : {}
          const payload = { ...payload0, [idKey]: c.idValue }
          void invoke(c.command, payload).catch(() => {})
        },
        detachedCancel: null,
      }
      tauriStreams.set(streamId, handle)

      const channel = new Channel<any>(ev => {
        const h = tauriStreams.get(streamId)
        if (!h || h.closed) return
        post(ev)
        const t = ev && typeof ev === 'object' ? String((ev as any).type || '') : ''
        if (t === 'end' || t === 'error') {
          const hh = tauriStreams.get(streamId)
          if (!hh) return
          hh.closed = true
          tauriStreams.delete(streamId)
        }
      })

      const payload = { ...(rawPayload as any), [channelKey]: channel }
      post({ type: '__gateway_start', kind: 'channel', command })

      void Promise.resolve()
        .then(async () => {
          const result = await invokeWithTimeout<any>(command, payload, timeoutMs)
          const h = tauriStreams.get(streamId)
          if (!h) return

          if (cancelSpec) {
            const cancelCommand = String(cancelSpec.command || '').trim()
            safeStringCommand(cancelCommand)
            if (!isTauriCommandAllowed(ctx.requires, cancelCommand)) {
              throw new PluginBridgeError('CAPABILITY_DENIED', `Capability denied: tauri:${cancelCommand}`, {
                needed: `tauri:${cancelCommand}`,
              })
            }

            const idKey = String(cancelSpec.idKey || 'streamId').trim() || 'streamId'
            if (!isSafePlainKey(idKey)) throw new PluginBridgeError('BAD_REQUEST', 'invalid cancel.idKey')

            const idValue = resolveCancelId(result, cancelSpec.resultKey ?? null)
            h.detachedCancel = {
              command: cancelCommand,
              payload: cancelSpec.payload ?? {},
              idKey,
              resultKey: cancelSpec.resultKey ?? null,
              idValue,
            }

            // 如果用户在拿到 id 之前就 cancel 了，这里补一枪取消。
            if (h.closed) {
              const payload0 =
                cancelSpec.payload && typeof cancelSpec.payload === 'object' && !Array.isArray(cancelSpec.payload)
                  ? cancelSpec.payload
                  : {}
              const payload2 = { ...payload0, [idKey]: idValue }
              void invoke(cancelCommand, payload2).catch(() => {})
            }
          }

          if (h.closed) return
          if (detached) {
            post({ type: '__gateway_ready', result })
            return
          }

          post({ type: '__gateway_result', result })
          post({ type: 'end', canceled: false })
        })
        .catch(err => {
          const h = tauriStreams.get(streamId)
          if (!h || h.closed) return
          post({ type: 'error', message: String((err as any)?.message || err || 'invoke failed') })
          post({ type: 'end', canceled: false })
        })
        .finally(() => {
          if (!detached) tauriStreams.delete(streamId)
        })

      return { streamId }
    },
  },

  'tauri.streamCancel': {
    handler: async (ctx, args, extra) => {
      if (!extra.postStream) throw new PluginBridgeError('BAD_REQUEST', 'postStream is required for tauri.streamCancel')

      const streamId = String(args?.[0] ?? '').trim()
      if (!streamId) throw new PluginBridgeError('BAD_REQUEST', 'streamId is required')

      const h = tauriStreams.get(streamId)
      if (!h) return null
      if (h.pluginId !== ctx.id) {
        throw new PluginBridgeError('CAPABILITY_DENIED', 'streamId does not belong to this plugin')
      }

      if (!h.closed) {
        h.closed = true
        try { h.cancel() } catch {}
      }

      extra.postStream?.({ streamId, event: { type: 'end', canceled: true } })
      tauriStreams.delete(streamId)
      return null
    },
  },
}

export async function dispatchPluginMethod(
  ctx: PluginContext,
  method: string,
  args: unknown,
  extra: { runtime: 'ui' | 'background'; onBack?: () => void; postStream?: (payload: { streamId: string; event: any }) => void },
) {
  const key = method as PluginMethodName
  const def = (methods as any)[key] as MethodDef | undefined
  if (!def) throw new PluginBridgeError('UNKNOWN_METHOD', `Unknown method: ${String(method)}`)

  const list = Array.isArray(args) ? (args as unknown[]) : []
  return def.handler(ctx, list, extra)
}
