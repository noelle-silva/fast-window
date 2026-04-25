import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'

export const clipboardMethods: PluginMethodRegistry = {
  'clipboard.readText': {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:clipboard.readText', 'cap:clipboard.*'])
      return await invokeWithTimeout('clipboard_read_text', {})
    },
  },
  'clipboard.writeText': {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:clipboard.writeText', 'cap:clipboard.*'])
      const text = String(args?.[0] ?? '').trim()
      await invokeWithTimeout('clipboard_write_text', { text })
      return null
    },
  },
  'clipboard.readImageDataUrl': {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:clipboard.readImage', 'cap:clipboard.*'])
      return await invokeWithTimeout('clipboard_read_image_data_url', {})
    },
  },
  'clipboard.writeImageDataUrl': {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:clipboard.writeImage', 'cap:clipboard.*'])
      const dataUrl = String(args?.[0] ?? '').trim()
      if (!dataUrl) throw new PluginBridgeError('BAD_REQUEST', 'dataUrl is required')
      await invokeWithTimeout('clipboard_write_image_data_url', { dataUrl })
      return null
    },
  },
}
