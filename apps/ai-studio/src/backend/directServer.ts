import http from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { AI_CHAT_DIRECT_METHOD, type AiChatDirectEvent } from '../protocol/aiChatProtocol'
import { validateRequestFrame, makeResponseFrame } from '../protocol/aiChatProtocolGuards'

export type AiChatDirectServerOptions = {
  sessionToken: string
  protocolVersion: number
  handleRequest: (method: string, params: unknown) => Promise<unknown>
  onClientConnected?: () => void
  onClientDisconnected?: () => void
}

export type AiChatDirectServer = {
  url: string
  broadcast: (event: AiChatDirectEvent) => void
  close: () => Promise<void>
}

function parseToken(req: http.IncomingMessage): string {
  try {
    const url = new URL(req.url || '/', 'ws://127.0.0.1')
    return url.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

export async function startAiChatDirectServer(options: AiChatDirectServerOptions): Promise<AiChatDirectServer> {
  const httpServer = http.createServer()
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()
  const helloDone = new WeakSet<WebSocket>()

  httpServer.on('upgrade', (req, socket, head) => {
    if (parseToken(req) !== options.sessionToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws) => {
    clients.add(ws)
    options.onClientConnected?.()

    ws.on('close', () => {
      clients.delete(ws)
      options.onClientDisconnected?.()
    })

    ws.on('message', (data) => {
      void (async () => {
        let frame: ReturnType<typeof validateRequestFrame> | null = null
        try {
          frame = validateRequestFrame(JSON.parse(String(data)))
        } catch (error) {
          send(ws, frame?.id || '', false, undefined, error)
          return
        }

        const { id, method } = frame
        if (!helloDone.has(ws) && method !== AI_CHAT_DIRECT_METHOD.healthCheck) {
          send(ws, id, false, undefined, new Error('请先完成 healthCheck'))
          return
        }

        try {
          const result = await options.handleRequest(method, frame.params ?? {})
          if (method === AI_CHAT_DIRECT_METHOD.healthCheck) {
            helloDone.add(ws)
          }
          send(ws, id, true, result)
        } catch (error) {
          send(ws, id, false, undefined, error)
        }
      })().catch((error) => {
        process.stderr.write(`[ai-chat-backend] frame error: ${String((error as any)?.message || error)}\n`)
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('WebSocket server 监听失败')
  const url = `ws://127.0.0.1:${address.port}`

  return {
    url,
    broadcast(event) {
      const text = JSON.stringify(event)
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN && helloDone.has(ws)) ws.send(text)
      }
    },
    close() {
      for (const ws of clients) ws.close()
      return new Promise((resolve) => {
        wss.close(() => httpServer.close(() => resolve()))
      })
    },
  }
}

function send(ws: WebSocket, id: string, ok: boolean, result?: unknown, error?: unknown) {
  if (!id) return
  ws.send(makeResponseFrame(id, ok, result, error))
}
