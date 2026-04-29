import { AI_CHAT_DIRECT_PROTOCOL_VERSION } from '../protocol/aiChatProtocol'
import { startAiChatDirectServer } from './directServer'
import { createAiChatBackendService } from './aiChatBackendService'
import type { AiChatBackendService } from './aiChatBackendService'
import { createBackendHostCapabilities } from '../host/createBackendHostCapabilities'
import { createAiChatCapabilitiesFromHostApi } from '../gateway/capabilities'

export async function createAiChatBackend() {
  const token = String(process.env.FAST_WINDOW_PLUGIN_SESSION_TOKEN || '').trim()
  if (!token) throw new Error('AI Chat backend missing FAST_WINDOW_PLUGIN_SESSION_TOKEN')

  let capabilities: any
  if (typeof (globalThis as any).window !== 'undefined' && (globalThis as any).window.fastWindow) {
    capabilities = createAiChatCapabilitiesFromHostApi((globalThis as any).window.fastWindow, 'ai-chat')
  } else {
    capabilities = createBackendHostCapabilities()
  }

  let handleRequest = (_method: string, _params: unknown) =>
    Promise.reject(new Error('AI Chat backend not ready'))

  const server = await startAiChatDirectServer({
    sessionToken: token,
    protocolVersion: AI_CHAT_DIRECT_PROTOCOL_VERSION,
    handleRequest: (method, params) => handleRequest(method, params),
  })

  const service: AiChatBackendService = createAiChatBackendService({
    capabilities,
    onEvent: (event) => server.broadcast(event),
  })

  handleRequest = (method, params) => service.dispatch(method, params)

  process.stdout.write(`${JSON.stringify({
    type: 'ready',
    ipc: {
      mode: 'direct',
      transport: 'local-websocket',
      url: server.url,
      protocolVersion: AI_CHAT_DIRECT_PROTOCOL_VERSION,
    },
  })}\n`)

  const shutdown = async () => {
    await service.dispose().catch(() => {})
    await server.close().catch(() => {})
  }

  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)))
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)))

  return server
}
