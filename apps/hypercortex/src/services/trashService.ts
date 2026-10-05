import type { BackgroundClient } from '../gateway/backgroundClient'
import type { TrashService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createTrashService(background: BackgroundClient): TrashService {
  return {
    listTrashItems: scope => background.invoke(HyperCortexRpc.trash.list, { scope }),
    moveNoteToTrash: (scope, note, refs) => background.invoke(HyperCortexRpc.trash.moveNote, { scope, note, refs }),
    moveAssetToTrash: (scope, assetId, ext, refs) => background.invoke(HyperCortexRpc.trash.moveAsset, { scope, assetId, ext, refs }),
    moveFolderToTrash: (scope, snapshot) => background.invoke(HyperCortexRpc.trash.moveFolder, { scope, folder: snapshot }),
    permanentlyDeleteNoteDir: (scope, noteId, dir) => background.invoke(HyperCortexRpc.trash.permanentlyDeleteNoteDir, { scope, noteId, dir }),
    permanentlyDeleteTrashItem: (scope, item) => background.invoke(HyperCortexRpc.trash.permanentlyDeleteItem, { scope, item }),
    restoreTrashItem: (scope, item) => background.invoke(HyperCortexRpc.trash.restore, { scope, item }),
    maybeAutoCleanupTrash: (scope, days) => background.invoke(HyperCortexRpc.trash.maybeAutoCleanup, { scope, days }),
  }
}
