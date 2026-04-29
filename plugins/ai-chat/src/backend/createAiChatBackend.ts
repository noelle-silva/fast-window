import { AI_CHAT_DIRECT_PROTOCOL_VERSION } from '../protocol/aiChatProtocol'
import { startAiChatDirectServer } from './directServer'
import { createAiChatBackendService } from './aiChatBackendService'

export async function createAiChatBackend() {
  const token = String(process.env.FAST_WINDOW_PLUGIN_SESSION_TOKEN || '').trim()
  if (!token) throw new Error('AI Chat backend missing FAST_WINDOW_PLUGIN_SESSION_TOKEN')

  const service = createAiChatBackendService()

  const server = await startAiChatDirectServer({
    sessionToken: token,
    protocolVersion: AI_CHAT_DIRECT_PROTOCOL_VERSION,
    handleRequest: (method, params) => service.dispatch(method, params),
  })

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
    await server.close().catch(() => {})
  }

  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)))
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)))

  return server
}
