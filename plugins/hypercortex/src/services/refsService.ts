import type { Api, VaultScope } from '../core'
import { loadRefIndex, removeNoteFromRefIndex, saveRefIndex, updateRefsForNote } from '../noteRefs'
import type { RefsService } from '../gateway/types'

export function createRefsService(api: Api): RefsService {
  return {
    loadRefIndex: (scope: VaultScope) => loadRefIndex(api, scope),
    saveRefIndex: (scope, idx) => saveRefIndex(api, scope, idx),
    updateRefsForNote: (scope, noteId, body) => updateRefsForNote(api, scope, noteId, body),
    removeNoteFromRefIndex: (scope, noteId) => removeNoteFromRefIndex(api, scope, noteId),
  }
}
