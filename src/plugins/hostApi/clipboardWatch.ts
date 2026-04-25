import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'
import { V3_METHOD } from './v3/methodNames'
import { expectPlainObject, readNonEmptyString } from './v3/validate'

export const clipboardWatchMethods: PluginMethodRegistry = {
  [V3_METHOD.clipboard.watch]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:clipboard.watch', 'cap:clipboard.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'clipboard.watch payload must be an object')
      return await invokeWithTimeout('clipboard_watch_start', { pluginId: ctx.id, req })
    },
  },
  [V3_METHOD.clipboard.getWatch]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:clipboard.getWatch', 'cap:clipboard.*'])
      const watchId = readNonEmptyString(args?.[0], 'watchId')
      return await invokeWithTimeout('clipboard_watch_get', { pluginId: ctx.id, watchId })
    },
  },
  [V3_METHOD.clipboard.unwatch]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:clipboard.unwatch', 'cap:clipboard.*'])
      const watchId = readNonEmptyString(args?.[0], 'watchId')
      return await invokeWithTimeout('clipboard_watch_stop', { pluginId: ctx.id, watchId })
    },
  },
}

