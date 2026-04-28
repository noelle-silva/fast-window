import http from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'

export type DirectRequestHandler = (method: string, params: unknown) => Promise<unknown>

function writeFrame(frame: unknown) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function formatError(error: any) {
  return String(error && error.message || error || '请求失败')
}

export function log(message: string, extra?: unknown) {
  const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`
  process.stderr.write(`[bookmarks-backend] ${message}${suffix}\n`)
}

function authenticate(req: http.IncomingMessage, expectedToken: string) {
  try {
    const url = new URL(req.url || '/', 'ws://127.0.0.1')
    return url.searchParams.get('token') === expectedToken
  } catch {
    return false
  }
}

async function handleFrame(ws: WebSocket, handler: DirectRequestHandler, frame: any) {
  const id = typeof frame?.id === 'string' ? frame.id : ''
  if (!id || frame?.type !== 'request') return

  try {
    const result = await handler(String(frame.method || ''), frame.params)
    ws.send(JSON.stringify({ id, type: 'response', ok: true, result }))
  } catch (error) {
    ws.send(JSON.stringify({ id, type: 'response', ok: false, error: { message: formatError(error) } }))
  }
}

export async function startDirectServer(options: {
  serviceName: string
  handleRequest: DirectRequestHandler
}): Promise<{ url: string }> {
  const token = String(process.env.FAST_WINDOW_PLUGIN_SESSION_TOKEN || '').trim()
  if (!token) throw new Error(`${options.serviceName} missing FAST_WINDOW_PLUGIN_SESSION_TOKEN`)

  const server = http.createServer()
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    if (!authenticate(req, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  wss.on('connection', ws => {
    ws.on('message', data => {
      let frame: any = null
      try {
        frame = JSON.parse(String(data))
      } catch {
        log('invalid json frame')
        return
      }
      handleFrame(ws, options.handleRequest, frame).catch(error => log('fatal frame error', formatError(error)))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error(`${options.serviceName} failed to bind local websocket`)
  const url = `ws://127.0.0.1:${address.port}`
  writeFrame({
    type: 'ready',
    ipc: {
      mode: 'direct',
      transport: 'local-websocket',
      url,
      protocolVersion: 1,
    },
  })
  log('ready', { url })
  return { url }
}
