import type { Api, VaultScope } from '../core'
import { listTrashItems, maybeAutoCleanupTrash, moveNoteToTrash, permanentlyDeleteNoteDir, restoreTrashItem } from '../trash'
import type { TrashService } from '../gateway/types'

export function createTrashService(api: Api): TrashService {
  return {
    listTrashItems: (scope: VaultScope) => listTrashItems(api, scope),
    moveNoteToTrash: (scope, note) => moveNoteToTrash(api, scope, note),
    permanentlyDeleteNoteDir: (scope, noteId, dir) => permanentlyDeleteNoteDir(api, scope, noteId, dir),
    restoreTrashItem: (scope, item) => restoreTrashItem(api, scope, item),
    maybeAutoCleanupTrash: (scope, days) => maybeAutoCleanupTrash(api, scope, days),
  }
}
