import { normalizeBackgroundEndpoint } from '../backgroundEndpoint'
import { PluginBridgeError } from '../pluginBridge'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'
import { V3_METHOD } from './v3/methodNames'

export const backgroundEndpointMethods: PluginMethodRegistry = {
  [V3_METHOD.background.endpoint]: {
    handler: async (ctx, _args, extra) => {
      if (extra.runtime !== 'ui') {
        throw new PluginBridgeError('BAD_REQUEST', 'background.endpoint is only available in UI runtime')
      }
      const res = await invokeWithTimeout<unknown>('plugin_backend_endpoint', { pluginId: ctx.id }, 15 * 1000)
      return normalizeBackgroundEndpoint(res)
    },
  },
}
