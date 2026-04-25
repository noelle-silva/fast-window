import { PluginBridgeError } from '../pluginBridge'
import type { PluginMethodRegistry } from './types'
import { requireAnyCapability } from './capability'
import { hostActivatePlugin, hostToast } from '../../host/hostPrimitives'

export const hostMethods: PluginMethodRegistry = {
  'host.back': {
    handler: async (_ctx, _args, extra) => {
      if (!extra.onBack) throw new PluginBridgeError('BAD_REQUEST', 'host.back is not available in background runtime')
      extra.onBack()
      return null
    },
  },
  'host.getInfo': {
    handler: async (ctx, _args, extra) => {
      requireAnyCapability(ctx, ['cap:host.getInfo', 'cap:host.*'])
      return {
        pluginId: ctx.id,
        apiVersion: ctx.apiVersion,
        runtime: extra.runtime,
      }
    },
  },
  'host.toast': {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:host.toast', 'cap:host.*'])
      const message = String(args?.[0] ?? '').trim()
      if (!message) throw new PluginBridgeError('BAD_REQUEST', 'message is required')
      await hostToast(message)
      return null
    },
  },
  'host.activatePlugin': {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:host.activatePlugin', 'cap:host.*'])
      const pluginId = String(args?.[0] ?? '').trim()
      if (!pluginId) throw new PluginBridgeError('BAD_REQUEST', 'pluginId is required')
      await hostActivatePlugin(pluginId)
      return null
    },
  },
}
