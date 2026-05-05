import http from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { AI_DRAW_DIRECT_METHOD } from '../shared/protocol'
import type { AiDrawDirectEvent } from '../shared/protocol'
import { AI_DRAW_ERROR_CODE, AiDrawDirectError, toDirectErrorPayload } from '../shared/errors'

export type DirectRequestContext = { helloDone: boolean }

export type DirectServerOptions = {
  sessionToken: string
  protocolVersion: number
  handleRequest: (method: string, params: unknown, context: DirectRequestContext) => Promise<unknown>
  onClientConnected?: () => void
  onClientDisconnected?: () => void
}

export type AiDrawDirectServer = {
  url: string
  broadcast: (event: AiDrawDirectEvent) => void
  close: () => Promise<void>
}

function sendResponse(ws: WebSocket, id: string, ok: boolean, result?: unknown, error?: unknown) {
  ws.send(JSON.stringify(ok ? { id, type: 'response', ok: true, result } : { id, type: 'response', ok: false, error }))
}

function parseToken(req: http.IncomingMessage) {
  try {
    const url = new URL(req.url || '/', 'ws://127.0.0.1')
    return url.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

export async function startAiDrawDirectServer(options: DirectServerOptions): Promise<AiDrawDirectServer> {
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
        let frame: any = null
        try {
          frame = JSON.parse(String(data))
        } catch (error) {
          throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.badRequest, '消息不是合法 JSON', error)
        }
        const id = typeof frame?.id === 'string' ? frame.id : ''
        if (!id || frame?.type !== 'request' || typeof frame?.method !== 'string' || !frame.method.trim()) {
          if (id) sendResponse(ws, id, false, undefined, toDirectErrorPayload(new AiDrawDirectError(AI_DRAW_ERROR_CODE.badRequest, '请求帧无效')))
          return
        }
        try {
          if (!helloDone.has(ws) && frame.method !== AI_DRAW_DIRECT_METHOD.protocolHello) {
            throw new AiDrawDirectError(AI_DRAW_ERROR_CODE.badRequest, '请先完成 protocol.hello')
          }
          const result = await options.handleRequest(frame.method, frame.params ?? {}, { helloDone: helloDone.has(ws) })
          if (frame.method === AI_DRAW_DIRECT_METHOD.protocolHello) helloDone.add(ws)
          sendResponse(ws, id, true, result)
        } catch (error) {
          sendResponse(ws, id, false, undefined, toDirectErrorPayload(error))
        }
      })().catch((error) => {
        process.stderr.write(`[ai-draw-backend] frame error: ${String((error as any)?.message || error)}\n`)
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
