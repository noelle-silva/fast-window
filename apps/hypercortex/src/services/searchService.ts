import type { SearchService } from '../gateway/types'
import type { BackgroundClient } from '../gateway/backgroundClient'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createSearchService(background: BackgroundClient): SearchService {
  return {
    loadOptions: () => background.invoke(HyperCortexRpc.search.options),
    queryNotes: (scope, query) => background.invoke(HyperCortexRpc.search.query, { scope, ...query }),
    queryAssets: (scope, query) => background.invoke(HyperCortexRpc.search.queryAssets, { scope, ...query }),
  }
}
