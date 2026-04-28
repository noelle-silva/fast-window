import { createBookmarksService } from './bookmarksService'
import { resolveDataFilePath } from './paths'
import { startDirectServer } from './directServer'
import { createBookmarkStore } from './store'

const store = createBookmarkStore(resolveDataFilePath())
const service = createBookmarksService(store)

async function main() {
  await service.list()
  await startDirectServer({
    serviceName: 'bookmarks-backend',
    handleRequest: (method, params) => service.dispatch(method, params),
  })
}

main().catch(error => {
  process.stderr.write(`[bookmarks-backend] fatal ${String(error && error.message || error)}\n`)
  process.exit(1)
})
