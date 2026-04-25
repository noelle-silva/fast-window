import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'

export const dialogMethods: PluginMethodRegistry = {
  'dialog.pickDir': {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:dialog.pickDir', 'cap:dialog.*'])
      return await invokeWithTimeout('host_dialog_pick_dir', { pluginId: ctx.id }, 30 * 60 * 1000)
    },
  },
  'dialog.pickOutputDir': {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:dialog.pickOutputDir', 'cap:dialog.*'])
      return await invokeWithTimeout('host_dialog_pick_output_dir', { pluginId: ctx.id }, 30 * 60 * 1000)
    },
  },
  'dialog.pickLibraryDir': {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:dialog.pickLibraryDir', 'cap:dialog.*'])
      return await invokeWithTimeout('host_dialog_pick_library_dir', { pluginId: ctx.id }, 30 * 60 * 1000)
    },
  },
  'dialog.pickImages': {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:dialog.pickImages', 'cap:dialog.*'])
      const req = (args?.[0] ?? {}) as { maxCount?: number }
      const maxCount = typeof req?.maxCount === 'number' ? req.maxCount : undefined
      return await invokeWithTimeout('host_dialog_pick_images', { pluginId: ctx.id, maxCount }, 30 * 60 * 1000)
    },
  },
  'dialog.confirm': {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:dialog.confirm', 'cap:dialog.*'])
      const req = (args?.[0] ?? {}) as { message?: string }
      const message = String(req?.message ?? '').trim()
      if (!message) throw new PluginBridgeError('BAD_REQUEST', 'message is required')
      return await invokeWithTimeout('host_dialog_confirm', { pluginId: ctx.id, message }, 30 * 60 * 1000)
    },
  },
}
