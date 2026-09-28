import type { BackgroundClient } from '../gateway/backgroundClient'
import type { RefsService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createRefsService(background: BackgroundClient): RefsService {
  return {
    loadRefIndex: scope => background.invoke(HyperCortexRpc.refs.loadIndex, { scope }),
    queryRelations: (scope, noteId, radius, direction) =>
      background.invoke(HyperCortexRpc.refs.queryRelations, { scope, noteId, radius, direction }),
  }
}
