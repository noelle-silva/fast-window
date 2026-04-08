import {
  type Api,
  type HyperCortexIndexV1,
  type NoteMeta,
  type VaultScope,
  NOTES_DIR,
  ensureIndex,
  ensureVaultDirs,
  noteMonthFolderFromIdOrNow,
  nowId,
  saveIndex,
  tryLoadIndex,
} from './core'
import { renderNoteDisplayHtml } from './noteRender'
import {
  NOTE_HTML_VIEW_FILE,
  NOTE_MANIFEST_FILE,
  NOTE_TEXT_FILE,
  createNoteDocData,
  createNoteManifest,
  type HyperCortexNoteDoc,
  type HyperCortexNoteDocData,
  type HyperCortexNoteManifestV1,
  type HyperCortexNoteResourceRef,
} from './noteSchema'

export function notePackageDirForId(id: string): string {
  const noteId = String(id || '').trim()
  return `${NOTES_DIR}/${noteMonthFolderFromIdOrNow(noteId)}/${noteId}`
}

function notePathInPackage(packageDir: string, file: string): string {
  return `${String(packageDir || '').replace(/\/+$/g, '')}/${file}`
}

function noteMetaFromDoc(doc: HyperCortexNoteDocData): NoteMeta {
  return {
    id: doc.id,
    title: doc.title,
    dir: doc.packageDir,
    createdAtMs: doc.createdAtMs,
    updatedAtMs: doc.updatedAtMs,
  }
}

function noteDocWithDisplay(doc: HyperCortexNoteDocData): HyperCortexNoteDoc {
  return {
    ...doc,
    displayHtml: renderNoteDisplayHtml(doc),
  }
}

async function deleteNoteFileIfExists(api: Api, scope: VaultScope, packageDir: string, file: string): Promise<void> {
  await api.files.delete({ scope, path: notePathInPackage(packageDir, file) }).catch(() => {})
}

async function readNoteManifest(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexNoteManifestV1> {
  const raw = await api.files.readText({ scope, path: notePathInPackage(packageDir, NOTE_MANIFEST_FILE) })
  const parsed = JSON.parse(raw || 'null')
  if (!parsed || typeof parsed !== 'object') throw new Error('笔记 manifest 无效')
  const id = String((parsed as any).id || '').trim()
  if (!id) throw new Error('笔记 manifest 缺少 id')
  return createNoteManifest({
    id,
    title: (parsed as any).title,
    tags: Array.isArray((parsed as any).tags) ? (parsed as any).tags : [],
    createdAtMs: Number((parsed as any).createdAtMs),
    updatedAtMs: Number((parsed as any).updatedAtMs),
    schemaVersion: Number((parsed as any).schemaVersion),
    resources: Array.isArray((parsed as any).resources) ? ((parsed as any).resources as HyperCortexNoteResourceRef[]) : [],
    faces: (parsed as any).faces,
  })
}

async function saveNoteFiles(
  api: Api,
  scope: VaultScope,
  doc: HyperCortexNoteDocData,
  options?: {
    saveTextFace?: boolean
    htmlViewContent?: string | null
  },
): Promise<void> {
  const existingManifest = await readNoteManifest(api, scope, doc.packageDir).catch(() => null)
  const faces: HyperCortexNoteManifestV1['faces'] = {
    ...(existingManifest?.faces || {}),
  }

  if (options?.saveTextFace !== false) {
    await api.files.writeText({
      scope,
      path: notePathInPackage(doc.packageDir, NOTE_TEXT_FILE),
      text: doc.body,
      overwrite: true,
    })
    faces.text = { file: NOTE_TEXT_FILE }
  }

  if (options && Object.prototype.hasOwnProperty.call(options, 'htmlViewContent')) {
    if (options.htmlViewContent == null) {
      await deleteNoteFileIfExists(api, scope, doc.packageDir, NOTE_HTML_VIEW_FILE)
      delete faces.htmlView
    } else {
      await api.files.writeText({
        scope,
        path: notePathInPackage(doc.packageDir, NOTE_HTML_VIEW_FILE),
        text: String(options.htmlViewContent),
        overwrite: true,
      })
      faces.htmlView = { file: NOTE_HTML_VIEW_FILE }
    }
  }

  const manifest = createNoteManifest({
    ...doc,
    faces,
  })
  await api.files.writeText({
    scope,
    path: notePathInPackage(doc.packageDir, NOTE_MANIFEST_FILE),
    text: JSON.stringify(manifest, null, 2),
    overwrite: true,
  })
}

async function upsertNoteIndex(api: Api, scope: VaultScope, meta: NoteMeta): Promise<void> {
  const idx = await ensureIndex(api, scope)
  await saveIndex(api, scope, {
    ...idx,
    notes: {
      ...idx.notes,
      [meta.id]: meta,
    },
  })
}

export async function saveNotePackage(
  api: Api,
  scope: VaultScope,
  input: {
    id?: string
    title?: string
    body?: string
    tags?: string[]
    createdAtMs?: number
    resources?: HyperCortexNoteResourceRef[]
    saveTextFace?: boolean
    htmlViewContent?: string | null
  },
): Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc }> {
  await ensureVaultDirs(api, scope)
  const id = String(input.id || '').trim() || nowId()
  const packageDir = notePackageDirForId(id)
  const nowMs = Date.now()
  const docData = createNoteDocData({
    id,
    packageDir,
    title: input.title,
    body: input.body,
    tags: input.tags,
    createdAtMs: input.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    resources: input.resources,
  })
  await saveNoteFiles(api, scope, docData, {
    saveTextFace: input.saveTextFace,
    htmlViewContent: input.htmlViewContent,
  })
  const meta = noteMetaFromDoc(docData)
  await upsertNoteIndex(api, scope, meta)
  return { meta, doc: noteDocWithDisplay(docData) }
}

export async function loadNotePackage(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexNoteDoc> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const body = manifest.faces.text
    ? await api.files.readText({ scope, path: notePathInPackage(packageDir, manifest.faces.text.file) })
    : ''
  const docData = createNoteDocData({
    id: manifest.id,
    packageDir,
    title: manifest.title,
    body,
    tags: manifest.tags,
    createdAtMs: manifest.createdAtMs,
    updatedAtMs: manifest.updatedAtMs,
    schemaVersion: manifest.schemaVersion,
    resources: manifest.resources,
  })
  return noteDocWithDisplay(docData)
}

export async function rebuildNoteIndexFromFs(api: Api, scope: VaultScope, idx: HyperCortexIndexV1): Promise<HyperCortexIndexV1> {
  await ensureVaultDirs(api, scope)
  const monthDirs = await api.files.listDir({ scope, dir: NOTES_DIR }).catch(() => [])
  const nextNotes: Record<string, NoteMeta> = {}

  for (const monthDir of monthDirs) {
    if (!monthDir.isDirectory) continue
    const packageEntries = await api.files.listDir({ scope, dir: `${NOTES_DIR}/${monthDir.name}` }).catch(() => [])
    for (const entry of packageEntries) {
      if (!entry.isDirectory) continue
      const packageDir = `${NOTES_DIR}/${monthDir.name}/${entry.name}`
      try {
        const manifest = await readNoteManifest(api, scope, packageDir)
        nextNotes[manifest.id] = {
          id: manifest.id,
          title: manifest.title,
          dir: packageDir,
          createdAtMs: Number(manifest.createdAtMs) > 0 ? Number(manifest.createdAtMs) : entry.modifiedMs || Date.now(),
          updatedAtMs: Number(manifest.updatedAtMs) > 0 ? Number(manifest.updatedAtMs) : entry.modifiedMs || Date.now(),
        }
      } catch {
      }
    }
  }

  const next: HyperCortexIndexV1 = { ...idx, notes: nextNotes }
  await saveIndex(api, scope, next).catch(() => {})
  return next
}

export async function loadNoteIndex(api: Api, scope: VaultScope): Promise<HyperCortexIndexV1> {
  let idx = await tryLoadIndex(api, scope)
  if (!idx) {
    idx = await ensureIndex(api, scope)
    idx = await rebuildNoteIndexFromFs(api, scope, idx)
  }
  return idx
}
