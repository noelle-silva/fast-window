import type { NotesService } from '../gateway/types'
import type { BackgroundClient } from '../gateway/backgroundClient'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createNotesService(background: BackgroundClient): NotesService {
  return {
    loadNoteManifest: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.loadManifest, { scope, packageDir }),
    tryReadNoteManifest: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.tryReadManifest, { scope, packageDir }),
    loadNoteFace: (scope, packageDir, faceId) => background.invoke(HyperCortexRpc.notes.loadFace, { scope, packageDir, faceId }),
    saveNoteFace: (scope, input) => background.invoke(HyperCortexRpc.notes.saveFace, { scope, input }),
    deleteNoteFace: (scope, packageDir, faceId, mode) => background.invoke(HyperCortexRpc.notes.deleteFace, { scope, packageDir, faceId, mode }),
    saveNoteFaces: (scope, input) => background.invoke(HyperCortexRpc.notes.saveFaces, { scope, input }),
    saveNoteFaceOrder: (scope, packageDir, faceOrder) => background.invoke(HyperCortexRpc.notes.saveFaceOrder, { scope, packageDir, faceOrder }),
    saveFaceSettings: (scope, packageDir, faceId, settings) => background.invoke(HyperCortexRpc.notes.saveFaceSettings, { scope, packageDir, faceId, settings }),
    publishNoteVersion: (scope, packageDir, commitName) => background.invoke(HyperCortexRpc.notes.versions.publish, { scope, packageDir, commitName }),
    listNoteVersions: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.versions.list, { scope, packageDir }),
    loadNoteVersion: (scope, packageDir, versionId) => background.invoke(HyperCortexRpc.notes.versions.load, { scope, packageDir, versionId }),
    restoreNoteVersion: (scope, packageDir, versionId) => background.invoke(HyperCortexRpc.notes.versions.restore, { scope, packageDir, versionId }),
    loadNoteIndex: scope => background.invoke(HyperCortexRpc.notes.loadIndex, { scope }),
    rebuildNoteIndexFromFs: (scope, idx) => background.invoke(HyperCortexRpc.notes.rebuildIndex, { scope, idx }),
    createEmptyNote: (scope, input) => background.invoke(HyperCortexRpc.notes.create, { scope, input }),
  }
}
