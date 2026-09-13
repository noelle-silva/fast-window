import type { SearchService } from '../gateway/types'
import type { BackgroundClient } from '../gateway/backgroundClient'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createSearchService(background: BackgroundClient): SearchService {
  return {
    listFaceKinds: () => background.invoke(HyperCortexRpc.search.kinds),
    queryNotes: (scope, query, faceKinds) =>
      background.invoke(HyperCortexRpc.search.query, { scope, query, faceKinds: Array.isArray(faceKinds) ? faceKinds : [] }),
  }
}
