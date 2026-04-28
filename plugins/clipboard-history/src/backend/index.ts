import { startDirectServer } from './directServer'
import { createClipboardHistoryService } from './clipboardHistoryService'
import { createClipboardHistoryStore } from './store'

async function main() {
  const store = createClipboardHistoryStore()
  const service = createClipboardHistoryService(store)
  await service.warmup()
  await startDirectServer({
    serviceName: 'clipboard-history-backend',
    handleRequest: (method, params) => service.dispatch(method, params),
  })
}

main().catch(error => {
  process.stderr.write(`[clipboard-history-backend] fatal ${String(error?.message || error)}\n`)
  process.exit(1)
})
