import type { Api, VaultScope } from '../core'
import {
  deleteHtmlFace,
  deleteNoteFace,
  loadHtmlFace,
  loadNoteFace,
  loadNoteIndex as loadNoteIndexWithApi,
  loadNoteManifest,
  loadNotePackage,
  rebuildNoteIndexFromFs,
  saveHtmlFace,
  saveHtmlFaceFixedScale,
  saveNoteFace,
  saveNotePackage,
  tryReadNoteManifest,
} from '../notePackage'
import type { NotesService } from '../gateway/types'

export function createNotesService(api: Api): NotesService {
  return {
    saveNotePackage: (scope, input) => saveNotePackage(api, scope, input),
    loadNotePackage: (scope, packageDir) => loadNotePackage(api, scope, packageDir),
    loadNoteManifest: (scope, packageDir) => loadNoteManifest(api, scope, packageDir),
    tryReadNoteManifest: (scope, packageDir) => tryReadNoteManifest(api, scope, packageDir),
    loadNoteFace: (scope, packageDir, faceId) => loadNoteFace(api, scope, packageDir, faceId),
    saveNoteFace: (scope, input) => saveNoteFace(api, scope, input),
    deleteNoteFace: (scope, packageDir, faceId) => deleteNoteFace(api, scope, packageDir, faceId),
    loadHtmlFace: (scope, packageDir) => loadHtmlFace(api, scope, packageDir),
    saveHtmlFace: (scope, input) => saveHtmlFace(api, scope, input),
    deleteHtmlFace: (scope, packageDir) => deleteHtmlFace(api, scope, packageDir),
    saveHtmlFaceFixedScale: (scope, packageDir, fixedScale) => saveHtmlFaceFixedScale(api, scope, packageDir, fixedScale),
    loadNoteIndex: (scope: VaultScope) => loadNoteIndexWithApi(api, scope),
    rebuildNoteIndexFromFs: (scope, idx) => rebuildNoteIndexFromFs(api, scope, idx),
    createEmptyNote: (scope, input) => saveNotePackage(api, scope, input),
  }
}
