import type { BackgroundClient } from '../gateway/backgroundClient'
import type { TrashService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createTrashService(background: BackgroundClient): TrashService {
  return {
    listTrashItems: scope => background.invoke(HyperCortexRpc.trash.list, { scope }),
    moveNoteToTrash: (scope, note) => background.invoke(HyperCortexRpc.trash.moveNote, { scope, note }),
    permanentlyDeleteNoteDir: (scope, noteId, dir) => background.invoke(HyperCortexRpc.trash.permanentlyDeleteNoteDir, { scope, noteId, dir }),
    restoreTrashItem: (scope, item) => background.invoke(HyperCortexRpc.trash.restore, { scope, item }),
    maybeAutoCleanupTrash: (scope, days) => background.invoke(HyperCortexRpc.trash.maybeAutoCleanup, { scope, days }),
  }
}
