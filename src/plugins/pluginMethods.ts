import type { PluginContext } from './pluginApi'
import { PluginBridgeError } from './pluginBridge'
import { tauriGatewayMethods } from './hostApi/tauriGateway'
import type { PluginMethodRegistry } from './hostApi/types'

const legacyV2Methods: PluginMethodRegistry = {
  'host.back': {
    handler: async (_ctx, _args, extra) => {
      if (!extra.onBack) throw new PluginBridgeError('BAD_REQUEST', 'host.back is not available in background runtime')
      extra.onBack()
      return null
    },
  },
  ...tauriGatewayMethods,
}

export async function dispatchPluginMethod(
  ctx: PluginContext,
  method: string,
  args: unknown,
  extra: {
    runtime: 'ui' | 'background'
    onBack?: () => void
    postStream?: (payload: { streamId: string; event: any }) => void
  },
) {
  const def = legacyV2Methods[String(method)]
  if (!def) throw new PluginBridgeError('UNKNOWN_METHOD', `Unknown method: ${String(method)}`)

  const list = Array.isArray(args) ? (args as unknown[]) : []
  return def.handler(ctx, list, extra)
}
