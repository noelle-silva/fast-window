import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'
import { V3_METHOD } from './v3/methodNames'
import { expectPlainObject, readNonEmptyString, readOptionalNumber } from './v3/validate'

const BACKGROUND_INVOKE_TIMEOUT_MS = 15 * 60 * 1000

export const backgroundMethods: PluginMethodRegistry = {
  [V3_METHOD.background.invoke]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:background.invoke', 'cap:background.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'background.invoke payload must be an object')
      const method = readNonEmptyString(req.method, 'method')
      if (method.includes('\n') || method.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', 'method must be a single line')
      const timeoutMs = readOptionalNumber(req.timeoutMs, 'timeoutMs')
      const res = await invokeWithTimeout<{ result: unknown }>(
        'plugin_backend_invoke',
        {
          req: {
            pluginId: ctx.id,
            method,
            params: (req as any).params ?? null,
            timeoutMs,
          },
        },
        BACKGROUND_INVOKE_TIMEOUT_MS,
      )
      return res?.result ?? null
    },
  },
}
