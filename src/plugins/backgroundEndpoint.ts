export type PluginBackgroundEndpoint = {
  mode: 'direct'
  transport: 'local-websocket'
  url: string
  token: string
  protocolVersion: number
}

export function normalizeBackgroundEndpoint(value: unknown): PluginBackgroundEndpoint {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null
  if (!raw) throw new Error('background endpoint is required')
  if (raw.mode !== 'direct') throw new Error('background endpoint mode must be direct')
  if (raw.transport !== 'local-websocket') throw new Error('background endpoint transport must be local-websocket')

  const url = String(raw.url || '').trim()
  const token = String(raw.token || '').trim()
  const protocolVersion = Number(raw.protocolVersion || 1)

  if (!url) throw new Error('background endpoint url is required')
  if (!token) throw new Error('background endpoint token is required')
  if (!Number.isInteger(protocolVersion) || protocolVersion <= 0) {
    throw new Error('background endpoint protocolVersion is invalid')
  }

  return { mode: 'direct', transport: 'local-websocket', url, token, protocolVersion }
}
