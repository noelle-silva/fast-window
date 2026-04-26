import readline from 'node:readline'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(__dirname, '..', 'shared', 'schema.json')

function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function writeError(id, message) {
  writeFrame({ id, ok: false, error: { message } })
}

function readSchema() {
  return JSON.parse(readFileSync(schemaPath, 'utf8'))
}

async function handleRequest(frame) {
  const id = typeof frame.id === 'string' ? frame.id : ''
  if (!id) return

  if (frame.method !== 'demo.ping') {
    writeError(id, `Unknown method: ${String(frame.method || '')}`)
    return
  }

  const schema = readSchema()
  const params = frame.params && typeof frame.params === 'object' ? frame.params : {}
  process.stderr.write(`[v4-contract-demo] demo.ping ${JSON.stringify(params)}\n`)

  writeFrame({
    id,
    ok: true,
    result: {
      pong: true,
      echo: params.message || null,
      schema: schema.title,
      handledAt: new Date().toISOString(),
    },
  })
}

writeFrame({ type: 'ready' })
process.stderr.write('[v4-contract-demo] backend ready\n')

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

input.on('line', line => {
  const trimmed = line.trim()
  if (!trimmed) return

  let frame = null
  try {
    frame = JSON.parse(trimmed)
  } catch {
    process.stderr.write(`[v4-contract-demo] invalid json frame: ${trimmed}\n`)
    return
  }

  handleRequest(frame).catch(err => {
    const id = frame && typeof frame.id === 'string' ? frame.id : ''
    if (id) writeError(id, String(err && err.message ? err.message : err))
  })
})
