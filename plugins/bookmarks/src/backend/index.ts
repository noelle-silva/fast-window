import { createBookmarksService } from './bookmarksService'
import { resolveDataFilePath } from './paths'
import { startRpcServer, sendReady } from './rpcServer'
import { createBookmarkStore } from './store'

const store = createBookmarkStore(resolveDataFilePath())
const service = createBookmarksService(store)

async function main() {
  startRpcServer((method, params) => service.dispatch(method, params))
  await service.list()
  sendReady()
}

main().catch(error => {
  process.stderr.write(`[bookmarks-backend] fatal ${String(error && error.message || error)}\n`)
  process.exit(1)
})
