import type { BackgroundClient } from '../gateway/backgroundClient'
import type { RefsService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createRefsService(background: BackgroundClient): RefsService {
  return {
    loadRefIndex: scope => background.invoke(HyperCortexRpc.refs.loadIndex, { scope }),
    saveRefIndex: (scope, idx) => background.invoke(HyperCortexRpc.refs.saveIndex, { scope, idx }),
    updateRefsForNote: (scope, noteId, body) => background.invoke(HyperCortexRpc.refs.updateForNote, { scope, noteId, body }),
    removeNoteFromRefIndex: (scope, noteId) => background.invoke(HyperCortexRpc.refs.removeNote, { scope, noteId }),
  }
}
