import type { NotesService } from '../gateway/types'
import type { BackgroundClient } from '../gateway/backgroundClient'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createNotesService(background: BackgroundClient): NotesService {
  return {
    saveNotePackage: (scope, input) => background.invoke(HyperCortexRpc.notes.savePackage, { scope, input }),
    loadNotePackage: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.loadPackage, { scope, packageDir }),
    loadNoteManifest: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.loadManifest, { scope, packageDir }),
    tryReadNoteManifest: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.tryReadManifest, { scope, packageDir }),
    loadNoteFace: (scope, packageDir, faceId) => background.invoke(HyperCortexRpc.notes.loadFace, { scope, packageDir, faceId }),
    saveNoteFace: (scope, input) => background.invoke(HyperCortexRpc.notes.saveFace, { scope, input }),
    deleteNoteFace: (scope, packageDir, faceId) => background.invoke(HyperCortexRpc.notes.deleteFace, { scope, packageDir, faceId }),
    loadHtmlFace: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.loadHtmlFace, { scope, packageDir }),
    saveHtmlFace: (scope, input) => background.invoke(HyperCortexRpc.notes.saveHtmlFace, { scope, input }),
    deleteHtmlFace: (scope, packageDir) => background.invoke(HyperCortexRpc.notes.deleteHtmlFace, { scope, packageDir }),
    saveHtmlFaceFixedScale: (scope, packageDir, fixedScale) => background.invoke(HyperCortexRpc.notes.saveHtmlFaceFixedScale, { scope, packageDir, fixedScale }),
    loadNoteIndex: scope => background.invoke(HyperCortexRpc.notes.loadIndex, { scope }),
    rebuildNoteIndexFromFs: (scope, idx) => background.invoke(HyperCortexRpc.notes.rebuildIndex, { scope, idx }),
    createEmptyNote: (scope, input) => background.invoke(HyperCortexRpc.notes.create, { scope, input }),
  }
}
