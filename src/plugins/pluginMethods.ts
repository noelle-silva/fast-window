import { Channel, invoke } from '@tauri-apps/api/core'
import type { PluginContext } from './pluginApi'
import { isCapabilityAllowed, type PluginMethodCapability } from './pluginContract'
import { PluginBridgeError } from './pluginBridge'

export type PluginMethodName =
  | 'host.back'
  | 'clipboard.readText'
  | 'clipboard.writeText'
  | 'clipboard.readImage'
  | 'clipboard.writeImage'
  | 'storage.get'
  | 'storage.set'
  | 'storage.remove'
  | 'storage.getAll'
  | 'storage.setAll'
  | 'storage.migrate'
  | 'files.getOutputDir'
  | 'files.pickOutputDir'
  | 'files.pickDir'
  | 'files.openOutputDir'
  | 'files.openDir'
  | 'files.images.writeBase64'
  | 'files.images.read'
  | 'files.images.list'
  | 'files.images.delete'
  | 'files.pickImages'
  | 'ui.showToast'
  | 'ui.openUrl'
  | 'ui.openExternal'
  | 'ui.openBrowserWindow'
  | 'net.request'
  | 'net.requestBase64'
  | 'net.requestStream'
  | 'net.requestStreamCancel'
  | 'task.create'
  | 'task.get'
  | 'task.list'
  | 'task.cancel'

type MethodDef = {
  capability?: PluginMethodCapability
  handler: (
    ctx: PluginContext,
    args: unknown[],
    extra: { onBack?: () => void; postStream?: (payload: { streamId: string; event: any }) => void },
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

  'clipboard.readText': { capability: 'clipboard.readText', handler: ctx => ctx.api.clipboard.readText() },
  'clipboard.writeText': {
    capability: 'clipboard.writeText',
    handler: (ctx, args) => ctx.api.clipboard.writeText(String(args?.[0] ?? '')),
  },
  'clipboard.readImage': { capability: 'clipboard.readImage', handler: ctx => ctx.api.clipboard.readImage() },
  'clipboard.writeImage': {
    capability: 'clipboard.writeImage',
    handler: (ctx, args) => ctx.api.clipboard.writeImage(String(args?.[0] ?? '')),
  },

  'storage.get': { capability: 'storage.get', handler: (ctx, args) => ctx.api.storage.get(String(args?.[0] ?? '')) },
  'storage.set': {
    capability: 'storage.set',
    handler: (ctx, args) => ctx.api.storage.set(String(args?.[0] ?? ''), args?.[1]),
  },
  'storage.remove': {
    capability: 'storage.remove',
    handler: (ctx, args) => ctx.api.storage.remove(String(args?.[0] ?? '')),
  },
  'storage.getAll': { capability: 'storage.getAll', handler: ctx => ctx.api.storage.getAll() },
  'storage.setAll': {
    capability: 'storage.setAll',
    handler: (ctx, args) => ctx.api.storage.setAll((args?.[0] as any) ?? {}),
  },
  'storage.migrate': {
    // 迁移会写盘：要求具备写入能力即可。
    capability: 'storage.set',
    handler: ctx => ctx.api.storage.migrate(),
  },

  'files.getOutputDir': { capability: 'files.getOutputDir', handler: ctx => ctx.api.files.getOutputDir() },
  'files.pickOutputDir': { capability: 'files.pickOutputDir', handler: ctx => ctx.api.files.pickOutputDir() },
  'files.pickDir': { capability: 'files.pickDir', handler: ctx => ctx.api.files.pickDir() },
  'files.openOutputDir': { capability: 'files.openOutputDir', handler: ctx => ctx.api.files.openOutputDir() },
  'files.openDir': {
    capability: 'files.openDir',
    handler: (ctx, args) => ctx.api.files.openDir(String(args?.[0] ?? '')),
  },
  'files.images.writeBase64': {
    capability: 'files.images.writeBase64',
    handler: (ctx, args) => ctx.api.files.images.writeBase64((args?.[0] as any) ?? null),
  },
  'files.images.read': {
    capability: 'files.images.read',
    handler: (ctx, args) => ctx.api.files.images.read((args?.[0] as any) ?? null),
  },
  'files.images.list': {
    capability: 'files.images.list',
    handler: (ctx, args) => ctx.api.files.images.list((args?.[0] as any) ?? null),
  },
  'files.images.delete': {
    capability: 'files.images.delete',
    handler: (ctx, args) => ctx.api.files.images.delete((args?.[0] as any) ?? null),
  },
  'files.pickImages': {
    capability: 'files.pickImages',
    handler: (ctx, args) => ctx.api.files.pickImages(args?.[0] as any),
  },

  'ui.showToast': {
    capability: 'ui.showToast',
    handler: (ctx, args) => ctx.api.ui.showToast(String(args?.[0] ?? '')),
  },
  'ui.openUrl': { capability: 'ui.openUrl', handler: (ctx, args) => ctx.api.ui.openUrl(String(args?.[0] ?? '')) },
  'ui.openExternal': {
    capability: 'ui.openExternal',
    handler: (ctx, args) => ctx.api.ui.openExternal(String(args?.[0] ?? '')),
  },
  'ui.openBrowserWindow': {
    capability: 'ui.openBrowserWindow',
    handler: async (ctx, args) => {
      const url = String(args?.[0] ?? '').trim()
      if (!url) throw new PluginBridgeError('BAD_REQUEST', 'url is required')
      await invoke('open_browser_window', { url, pluginId: ctx.id })
      return null
    },
  },

  'net.request': {
    capability: 'net.request',
    handler: (ctx, args) => {
      const req = (args?.[0] as any) ?? null
      const responseType = String(req?.responseType || 'text')

      if (responseType === 'base64') {
        if (!isCapabilityAllowed(ctx.requires, 'net.requestBase64')) {
          throw new PluginBridgeError('CAPABILITY_DENIED', 'Capability denied: net.requestBase64', {
            needed: 'net.requestBase64',
          })
        }
        const mode = String(req?.mode || 'direct')
        if (mode === 'task') {
          throw new PluginBridgeError('BAD_REQUEST', 'net.request({ responseType: \"base64\" }) does not support mode=\"task\"')
        }
        const { responseType: _rt, mode: _mode, ...rest } = req || {}
        return ctx.api.net.requestBase64(rest)
      }

      return ctx.api.net.request(req)
    },
  },
  'net.requestBase64': {
    capability: 'net.requestBase64',
    handler: (ctx, args) => ctx.api.net.requestBase64(args?.[0] as any),
  },

  'net.requestStream': {
    capability: 'net.requestStream',
    handler: async (_ctx, args, extra) => {
      if (!extra.postStream) throw new PluginBridgeError('BAD_REQUEST', 'postStream is required for net.requestStream')

      const req = (args?.[0] as any) ?? null
      let streamId = ''
      const pending: any[] = []

      const channel = new Channel<any>(event => {
        if (streamId) extra.postStream?.({ streamId, event })
        else pending.push(event)
      })

      streamId = await invoke<string>('http_request_stream', { req, channel })
      for (const event of pending) extra.postStream?.({ streamId, event })
      return { streamId }
    },
  },

  'net.requestStreamCancel': {
    capability: 'net.requestStreamCancel',
    handler: async (_ctx, args) => {
      const streamId = String(args?.[0] ?? '').trim()
      if (!streamId) throw new PluginBridgeError('BAD_REQUEST', 'streamId is required')
      await invoke('http_request_stream_cancel', { streamId })
      return null
    },
  },

  'task.create': {
    capability: 'task.create',
    handler: (ctx, args) => {
      const req = args?.[0] as any
      const kind = String(req?.kind || '').trim()
      if (kind === 'http.request') {
        throw new PluginBridgeError('BAD_REQUEST', 'Use fastWindow.net.request({ mode: "task", ... }) for http requests')
      }
      return ctx.api.task.create(req)
    },
  },
  'task.get': { capability: 'task.get', handler: (ctx, args) => ctx.api.task.get(String(args?.[0] ?? '')) },
  'task.list': { capability: 'task.list', handler: (ctx, args) => ctx.api.task.list(args?.[0] as any) },
  'task.cancel': { capability: 'task.cancel', handler: (ctx, args) => ctx.api.task.cancel(String(args?.[0] ?? '')) },
}

export async function dispatchPluginMethod(
  ctx: PluginContext,
  method: string,
  args: unknown,
  extra: { onBack?: () => void; postStream?: (payload: { streamId: string; event: any }) => void },
) {
  const key = method as PluginMethodName
  const def = (methods as any)[key] as MethodDef | undefined
  if (!def) throw new PluginBridgeError('UNKNOWN_METHOD', `Unknown method: ${String(method)}`)

  if (def.capability && !isCapabilityAllowed(ctx.requires, def.capability)) {
    throw new PluginBridgeError('CAPABILITY_DENIED', `Capability denied: ${def.capability}`, { needed: def.capability })
  }

  const list = Array.isArray(args) ? (args as unknown[]) : []
  return def.handler(ctx, list, extra)
}
