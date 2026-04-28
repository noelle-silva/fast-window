import { AI_DRAW_DIRECT_PROTOCOL_VERSION } from '../shared/protocol'
import { readAiDrawBackendEnv } from './env'
import { startAiDrawDirectServer } from './directServer'
import { createAiDrawBackendService } from './service'

async function main() {
  const env = readAiDrawBackendEnv()
  const service = createAiDrawBackendService(env)
  const server = await startAiDrawDirectServer({
    sessionToken: env.sessionToken,
    protocolVersion: AI_DRAW_DIRECT_PROTOCOL_VERSION,
    handleRequest: (method, params, context) => service.dispatch(method, params, context),
  })
  const unsubscribe = service.subscribe((event) => server.broadcast(event))
  const shutdown = async () => {
    unsubscribe()
    await service.dispose().catch(() => {})
    await server.close().catch(() => {})
  }
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)))
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)))
  process.stdout.write(`${JSON.stringify({
    type: 'ready',
    ipc: {
      mode: 'direct',
      transport: 'local-websocket',
      url: server.url,
      protocolVersion: AI_DRAW_DIRECT_PROTOCOL_VERSION,
    },
  })}\n`)
}

main().catch((error) => {
  process.stderr.write(`[ai-draw-backend] ${String(error?.stack || error?.message || error)}\n`)
  process.exit(1)
})
