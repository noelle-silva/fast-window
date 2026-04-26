import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'
import { V3_METHOD } from './v3/methodNames'
import { expectPlainObject, readNonEmptyString, readOptionalNumber } from './v3/validate'

const BACKGROUND_INVOKE_TIMEOUT_MS = 15 * 60 * 1000
const BACKGROUND_INVOKE_MAX_PAYLOAD_BYTES = 1024 * 1024

function assertPayloadLimit(method: string, params: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify({ method, params: params ?? null })).length
  if (bytes > BACKGROUND_INVOKE_MAX_PAYLOAD_BYTES) {
    throw new PluginBridgeError('BAD_REQUEST', `background.invoke payload exceeds ${BACKGROUND_INVOKE_MAX_PAYLOAD_BYTES} bytes`)
  }
}

export const backgroundMethods: PluginMethodRegistry = {
  [V3_METHOD.background.invoke]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:background.invoke', 'cap:background.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'background.invoke payload must be an object')
      const method = readNonEmptyString(req.method, 'method')
      if (method.includes('\n') || method.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', 'method must be a single line')
      const timeoutMs = readOptionalNumber(req.timeoutMs, 'timeoutMs')
      const params = (req as any).params ?? null
      assertPayloadLimit(method, params)
      const res = await invokeWithTimeout<{ result: unknown }>(
        'plugin_backend_invoke',
        {
          req: {
            pluginId: ctx.id,
            method,
            params,
            timeoutMs,
          },
        },
        BACKGROUND_INVOKE_TIMEOUT_MS,
      )
      return res?.result ?? null
    },
  },
}
