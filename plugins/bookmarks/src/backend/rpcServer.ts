import readline from 'node:readline'

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

export function startRpcServer(handler: (method: string, params: unknown) => Promise<unknown>) {
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  setInterval(() => {}, 1 << 30)

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  input.on('line', line => {
    const raw = line.trim()
    if (!raw) return

    let frame: any = null
    try {
      frame = JSON.parse(raw)
    } catch {
      log('invalid json frame')
      return
    }

    handleFrame(handler, frame).catch(error => log('fatal frame error', formatError(error)))
  })
}

export function sendReady() {
  writeFrame({ type: 'ready' })
  log('ready')
}

async function handleFrame(handler: (method: string, params: unknown) => Promise<unknown>, frame: any) {
  const id = typeof frame.id === 'string' ? frame.id : ''
  if (!id) return

  try {
    const result = await handler(String(frame.method || ''), frame.params)
    writeFrame({ id, ok: true, result })
  } catch (error) {
    writeFrame({ id, ok: false, error: { message: formatError(error) } })
  }
}
