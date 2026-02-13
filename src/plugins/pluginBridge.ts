export type PluginBridgeErrorCode =
  | 'UNKNOWN_METHOD'
  | 'CAPABILITY_DENIED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'

export class PluginBridgeError extends Error {
  code: PluginBridgeErrorCode
  data?: unknown

  constructor(code: PluginBridgeErrorCode, message: string, data?: unknown) {
    super(message)
    this.name = 'PluginBridgeError'
    this.code = code
    this.data = data
  }
}

export function toBridgeError(err: unknown): PluginBridgeError {
  if (err instanceof PluginBridgeError) return err
  const msg = String((err as any)?.message || err || 'Unknown error')
  return new PluginBridgeError('INTERNAL_ERROR', msg)
}

