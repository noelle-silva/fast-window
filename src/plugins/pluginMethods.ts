import { invoke } from '@tauri-apps/api/core'
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
  | 'files.getOutputDir'
  | 'files.pickOutputDir'
  | 'files.pickDir'
  | 'files.openOutputDir'
  | 'files.openDir'
  | 'files.saveImageBase64'
  | 'files.saveRefImageBase64'
  | 'files.listOutputImages'
  | 'files.readOutputImage'
  | 'files.deleteOutputImage'
  | 'files.listRefImages'
  | 'files.readRefImage'
  | 'files.deleteRefImage'
  | 'files.pickImages'
  | 'ui.showToast'
  | 'ui.openUrl'
  | 'ui.openBrowserWindow'
  | 'net.request'
  | 'net.requestBase64'
  | 'task.create'
  | 'task.get'
  | 'task.list'
  | 'task.cancel'

type MethodDef = {
  capability?: PluginMethodCapability
  handler: (ctx: PluginContext, args: unknown[], extra: { onBack?: () => void }) => unknown | Promise<unknown>
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

  'files.getOutputDir': { capability: 'files.getOutputDir', handler: ctx => ctx.api.files.getOutputDir() },
  'files.pickOutputDir': { capability: 'files.pickOutputDir', handler: ctx => ctx.api.files.pickOutputDir() },
  'files.pickDir': { capability: 'files.pickDir', handler: ctx => ctx.api.files.pickDir() },
  'files.openOutputDir': { capability: 'files.openOutputDir', handler: ctx => ctx.api.files.openOutputDir() },
  'files.openDir': {
    capability: 'files.openDir',
    handler: (ctx, args) => ctx.api.files.openDir(String(args?.[0] ?? '')),
  },
  'files.saveImageBase64': {
    capability: 'files.saveImageBase64',
    handler: (ctx, args) => ctx.api.files.saveImageBase64(String(args?.[0] ?? '')),
  },
  'files.saveRefImageBase64': {
    capability: 'files.saveRefImageBase64',
    handler: (ctx, args) => ctx.api.files.saveRefImageBase64(String(args?.[0] ?? '')),
  },
  'files.listOutputImages': { capability: 'files.listOutputImages', handler: ctx => ctx.api.files.listOutputImages() },
  'files.readOutputImage': {
    capability: 'files.readOutputImage',
    handler: (ctx, args) => ctx.api.files.readOutputImage(String(args?.[0] ?? '')),
  },
  'files.deleteOutputImage': {
    capability: 'files.deleteOutputImage',
    handler: (ctx, args) => ctx.api.files.deleteOutputImage(String(args?.[0] ?? '')),
  },
  'files.listRefImages': { capability: 'files.listRefImages', handler: ctx => ctx.api.files.listRefImages() },
  'files.readRefImage': {
    capability: 'files.readRefImage',
    handler: (ctx, args) => ctx.api.files.readRefImage(String(args?.[0] ?? '')),
  },
  'files.deleteRefImage': {
    capability: 'files.deleteRefImage',
    handler: (ctx, args) => ctx.api.files.deleteRefImage(String(args?.[0] ?? '')),
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
  extra: { onBack?: () => void },
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
