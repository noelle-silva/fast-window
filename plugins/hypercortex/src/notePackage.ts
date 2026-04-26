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
  safeTitleForFile,
  saveIndex,
  tryLoadIndex,
} from './core'
import { renderNoteDisplayHtml } from './noteRender'
import { updateRefsForNote } from './noteRefs'
import {
  NOTE_MANIFEST_FILE,
  createNoteDocData,
  type HyperCortexNoteDoc,
  type HyperCortexNoteDocData,
  type HyperCortexNoteManifestV1,
  type HyperCortexNoteResourceRef,
} from './noteSchema'
import { createDefaultNoteFaces, createNoteManifest } from './noteManifest'
import {
  HTML_FACE_KIND,
  MARKDOWN_FACE_KIND,
  createDefaultFaceManifest,
  getHtmlFaceFixedScale,
  isHtmlFace,
  isMarkdownFace,
  requireNoteFaceAdapter,
  type HyperCortexNoteFaceManifestV2,
  type HyperCortexNoteFaceSettingsV2,
} from './noteFaces'

export type HyperCortexHtmlFaceDoc = {
  id: string
  packageDir: string
  title: string
  description: string
  html: string
  exists: boolean
  createdAtMs: number
  updatedAtMs: number
  schemaVersion: number
  fixedScale?: number
}

export type HyperCortexNoteFaceDoc = {
  id: string
  packageDir: string
  noteId: string
  noteTitle: string
  noteDescription: string
  face: HyperCortexNoteFaceManifestV2
  content: string
  exists: boolean
  createdAtMs: number
  updatedAtMs: number
  schemaVersion: number
}

function notePackageFolderNameForTitleAndId(title: string, id: string): string {
  const safeTitle = safeTitleForFile(title)
  const noteId = String(id || '').trim()
  return `${safeTitle}_${noteId}`
}

export function notePackageDirForId(id: string, title?: string): string {
  const noteId = String(id || '').trim()
  const t = String(title ?? '').trim() || '未命名'
  return `${NOTES_DIR}/${noteMonthFolderFromIdOrNow(noteId)}/${notePackageFolderNameForTitleAndId(t, noteId)}`
}

function notePathInPackage(packageDir: string, file: string): string {
  return `${String(packageDir || '').replace(/\/+$/g, '')}/${file}`
}

function noteMetaFromDoc(doc: HyperCortexNoteDocData): NoteMeta {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
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

function noteFaceDocFromManifest(manifest: HyperCortexNoteManifestV1, packageDir: string, face: HyperCortexNoteFaceManifestV2, content: string, exists: boolean): HyperCortexNoteFaceDoc {
  return {
    id: face.id,
    packageDir,
    noteId: manifest.id,
    noteTitle: manifest.title,
    noteDescription: manifest.description,
    face,
    content,
    exists,
    createdAtMs: manifest.createdAtMs,
    updatedAtMs: manifest.updatedAtMs,
    schemaVersion: manifest.schemaVersion,
  }
}

function htmlFaceDocFromFaceDoc(doc: HyperCortexNoteFaceDoc): HyperCortexHtmlFaceDoc {
  const fixedScale = getHtmlFaceFixedScale(doc.face)
  return {
    id: doc.noteId,
    packageDir: doc.packageDir,
    title: doc.noteTitle,
    description: doc.noteDescription,
    html: doc.content,
    exists: doc.exists,
    fixedScale,
    createdAtMs: doc.createdAtMs,
    updatedAtMs: doc.updatedAtMs,
    schemaVersion: doc.schemaVersion,
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
    description: (parsed as any).description,
    tags: Array.isArray((parsed as any).tags) ? (parsed as any).tags : [],
    createdAtMs: Number((parsed as any).createdAtMs),
    updatedAtMs: Number((parsed as any).updatedAtMs),
    schemaVersion: Number((parsed as any).schemaVersion),
    resources: Array.isArray((parsed as any).resources) ? ((parsed as any).resources as HyperCortexNoteResourceRef[]) : [],
    faces: (parsed as any).faces,
    primaryFaceId: (parsed as any).primaryFaceId,
    faceOrder: Array.isArray((parsed as any).faceOrder) ? (parsed as any).faceOrder : [],
  })
}

export async function tryReadNoteManifest(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexNoteManifestV1 | null> {
  try {
    return await readNoteManifest(api, scope, packageDir)
  } catch {
    return null
  }
}

async function saveNoteFiles(
  api: Api,
  scope: VaultScope,
  doc: HyperCortexNoteDocData,
  options?: {
    saveTextFace?: boolean
  },
): Promise<HyperCortexNoteManifestV1> {
  const existingManifest = await readNoteManifest(api, scope, doc.packageDir).catch(() => null)
  const faces: HyperCortexNoteManifestV1['faces'] = {
    ...(existingManifest?.faces || createDefaultNoteFaces()),
  }

  if (options?.saveTextFace === true) {
    const face = faces.text || createDefaultFaceManifest(MARKDOWN_FACE_KIND)
    const adapter = requireNoteFaceAdapter(face.kind)
    await api.files.writeText({
      scope,
      path: notePathInPackage(doc.packageDir, face.file),
      text: adapter.normalizeContent(doc.body),
      overwrite: true,
    })
    faces.text = face
  }

  const manifest = createNoteManifest({
    ...doc,
    faces,
    primaryFaceId: existingManifest?.primaryFaceId || 'text',
    faceOrder: existingManifest?.faceOrder || Object.keys(faces),
  })
  await api.files.writeText({
    scope,
    path: notePathInPackage(doc.packageDir, NOTE_MANIFEST_FILE),
    text: JSON.stringify(manifest, null, 2),
    overwrite: true,
  })
  return manifest
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
    packageDir?: string
    title?: string
    description?: string
    body?: string
    tags?: string[]
    createdAtMs?: number
    resources?: HyperCortexNoteResourceRef[]
    saveTextFace?: boolean
  },
): Promise<{ meta: NoteMeta; doc: HyperCortexNoteDoc }> {
  await ensureVaultDirs(api, scope)
  const id = String(input.id || '').trim() || nowId()
  const title = String(input.title ?? '').trim() || '未命名'
  const description = String(input.description ?? '').trim()
  const desiredDir = notePackageDirForId(id, title)
  const currentDir = String(input.packageDir || '').trim()

  if (currentDir && currentDir !== desiredDir) {
    await api.files.rename({ scope, from: currentDir, to: desiredDir, overwrite: false })
  }
  const packageDir = desiredDir
  const nowMs = Date.now()
  const docData = createNoteDocData({
    id,
    packageDir,
    title,
    description,
    body: input.body,
    tags: input.tags,
    createdAtMs: input.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    resources: input.resources,
  })
  await saveNoteFiles(api, scope, docData, {
    saveTextFace: input.saveTextFace,
  })
  const meta = noteMetaFromDoc(docData)
  await upsertNoteIndex(api, scope, meta)
  await updateRefsForNote(api, scope, id, input.body ?? '').catch(() => {})
  return { meta, doc: noteDocWithDisplay(docData) }
}

export async function loadNotePackage(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexNoteDoc> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const textFace = manifest.faces.text || Object.values(manifest.faces).find(isMarkdownFace)
  const body = textFace
    ? await api.files.readText({ scope, path: notePathInPackage(packageDir, textFace.file) })
    : ''
  const docData = createNoteDocData({
    id: manifest.id,
    packageDir,
    title: manifest.title,
    description: manifest.description,
    body,
    tags: manifest.tags,
    createdAtMs: manifest.createdAtMs,
    updatedAtMs: manifest.updatedAtMs,
    schemaVersion: manifest.schemaVersion,
    resources: manifest.resources,
  })
  return noteDocWithDisplay(docData)
}

export async function loadNoteManifest(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexNoteManifestV1> {
  return readNoteManifest(api, scope, packageDir)
}

export async function loadNoteFace(api: Api, scope: VaultScope, packageDir: string, faceId: string): Promise<HyperCortexNoteFaceDoc> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const id = String(faceId || '').trim()
  const face = manifest.faces[id]
  if (!face) throw new Error(`笔记面不存在：${id}`)
  const adapter = requireNoteFaceAdapter(face.kind)
  let exists = false
  const raw = await api.files.readText({ scope, path: notePathInPackage(packageDir, face.file) }).then(value => {
    exists = true
    return value
  }).catch(() => adapter.createEmptyContent({ noteId: manifest.id, title: manifest.title }))
  const content = adapter.normalizeContent(raw)
  return noteFaceDocFromManifest(manifest, packageDir, face, content, exists)
}

export async function saveNoteFace(
  api: Api,
  scope: VaultScope,
  input: {
    id?: string
    packageDir?: string
    title?: string
    description?: string
    body?: string
    tags?: string[]
    createdAtMs?: number
    resources?: HyperCortexNoteResourceRef[]
    faceId: string
    kind: string
    content: string
    settings?: HyperCortexNoteFaceSettingsV2 | null
  },
): Promise<{ meta: NoteMeta; faceDoc: HyperCortexNoteFaceDoc; manifest: HyperCortexNoteManifestV1 }> {
  await ensureVaultDirs(api, scope)
  const id = String(input.id || '').trim() || nowId()
  const title = String(input.title ?? '').trim() || '未命名'
  const desiredDir = notePackageDirForId(id, title)
  const currentDir = String(input.packageDir || '').trim()

  if (currentDir && currentDir !== desiredDir) {
    await api.files.rename({ scope, from: currentDir, to: desiredDir, overwrite: false })
  }

  const packageDir = desiredDir
  const existingManifest = await readNoteManifest(api, scope, packageDir).catch(() => null)
  const adapter = requireNoteFaceAdapter(input.kind)
  const faceId = String(input.faceId || '').trim() || adapter.defaultFaceId
  const existingFace = existingManifest?.faces?.[faceId]
  const face = existingFace
    ? createDefaultFaceManifest(adapter.kind, {
        id: faceId,
        title: existingFace.title,
        file: existingFace.file,
        role: existingFace.role,
        settings: input.settings ?? existingFace.settings,
      })
    : createDefaultFaceManifest(adapter.kind, { id: faceId, settings: input.settings })
  const nowMs = Date.now()
  const docData = createNoteDocData({
    id,
    packageDir,
    title,
    description: String(input.description ?? existingManifest?.description ?? '').trim(),
    body: input.body,
    tags: input.tags ?? existingManifest?.tags,
    createdAtMs: input.createdAtMs ?? existingManifest?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    resources: input.resources ?? existingManifest?.resources,
  })
  await api.files.writeText({
    scope,
    path: notePathInPackage(packageDir, face.file),
    text: adapter.normalizeContent(input.content),
    overwrite: true,
  })

  const faces = {
    ...(existingManifest?.faces || createDefaultNoteFaces()),
    [face.id]: face,
  }
  const manifest = createNoteManifest({
    ...docData,
    faces,
    primaryFaceId: existingManifest?.primaryFaceId || 'text',
    faceOrder: existingManifest?.faceOrder || Object.keys(faces),
  })
  await api.files.writeText({
    scope,
    path: notePathInPackage(packageDir, NOTE_MANIFEST_FILE),
    text: JSON.stringify(manifest, null, 2),
    overwrite: true,
  })

  const meta = noteMetaFromDoc(docData)
  await upsertNoteIndex(api, scope, meta)
  const faceDoc = noteFaceDocFromManifest(manifest, packageDir, manifest.faces[face.id], adapter.normalizeContent(input.content), true)
  return { meta, faceDoc, manifest }
}

export async function deleteNoteFace(api: Api, scope: VaultScope, packageDir: string, faceId: string): Promise<HyperCortexNoteManifestV1> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const id = String(faceId || '').trim()
  const face = manifest.faces[id]
  if (!face) return manifest
  if (!face.capabilities.deletable) throw new Error('该笔记面不可删除')
  await deleteNoteFileIfExists(api, scope, packageDir, face.file)
  const faces = { ...manifest.faces }
  delete faces[id]
  const next = createNoteManifest({
    ...manifest,
    faces,
    primaryFaceId: manifest.primaryFaceId === id ? 'text' : manifest.primaryFaceId,
    faceOrder: manifest.faceOrder.filter(item => item !== id),
    updatedAtMs: Date.now(),
  })
  await api.files.writeText({
    scope,
    path: notePathInPackage(packageDir, NOTE_MANIFEST_FILE),
    text: JSON.stringify(next, null, 2),
    overwrite: true,
  })
  return next
}

export async function saveNoteFaceSettings(
  api: Api,
  scope: VaultScope,
  packageDir: string,
  faceId: string,
  settings: HyperCortexNoteFaceSettingsV2,
): Promise<void> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const id = String(faceId || '').trim()
  const face = manifest.faces[id]
  if (!face) return
  const adapter = requireNoteFaceAdapter(face.kind)
  const nextFace = createDefaultFaceManifest(face.kind, {
    id: face.id,
    title: face.title,
    file: face.file,
    role: face.role,
    settings: adapter.normalizeSettings(settings),
  })
  const next = createNoteManifest({
    ...manifest,
    faces: { ...manifest.faces, [id]: nextFace },
  })
  await api.files.writeText({
    scope,
    path: notePathInPackage(packageDir, NOTE_MANIFEST_FILE),
    text: JSON.stringify(next, null, 2),
    overwrite: true,
  })
}

export async function loadHtmlFace(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexHtmlFaceDoc> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const face = manifest.faces.html || Object.values(manifest.faces).find(isHtmlFace)
  if (!face) {
    const placeholder = createDefaultFaceManifest(HTML_FACE_KIND)
    return htmlFaceDocFromFaceDoc(noteFaceDocFromManifest(
      manifest,
      packageDir,
      placeholder,
      manifest.description,
      requireNoteFaceAdapter(HTML_FACE_KIND).createEmptyContent({ noteId: manifest.id, title: manifest.title }),
      false,
    ))
  }
  return htmlFaceDocFromFaceDoc(await loadNoteFace(api, scope, packageDir, face.id))
}

export async function saveHtmlFace(
  api: Api,
  scope: VaultScope,
  input: {
    id?: string
    packageDir?: string
    title?: string
    description?: string
    body?: string
    tags?: string[]
    createdAtMs?: number
    resources?: HyperCortexNoteResourceRef[]
    html: string
  },
): Promise<{ meta: NoteMeta; htmlFace: HyperCortexHtmlFaceDoc }> {
  const result = await saveNoteFace(api, scope, {
    id: input.id,
    packageDir: input.packageDir,
    title: input.title,
    description: input.description,
    body: input.body,
    tags: input.tags,
    createdAtMs: input.createdAtMs,
    resources: input.resources,
    faceId: 'html',
    kind: HTML_FACE_KIND,
    content: input.html,
  })
  return {
    meta: result.meta,
    htmlFace: htmlFaceDocFromFaceDoc(result.faceDoc),
  }
}

export async function deleteHtmlFace(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexHtmlFaceDoc> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const face = manifest.faces.html || Object.values(manifest.faces).find(isHtmlFace)
  if (face) await deleteNoteFace(api, scope, packageDir, face.id)
  const nextManifest = await readNoteManifest(api, scope, packageDir)
  const placeholder = createDefaultFaceManifest(HTML_FACE_KIND)
  return htmlFaceDocFromFaceDoc(noteFaceDocFromManifest(
    nextManifest,
    packageDir,
    placeholder,
    nextManifest.description,
    requireNoteFaceAdapter(HTML_FACE_KIND).createEmptyContent({ noteId: nextManifest.id, title: nextManifest.title }),
    false,
  ))
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
          description: manifest.description,
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

export async function saveHtmlFaceFixedScale(
  api: Api,
  scope: VaultScope,
  packageDir: string,
  fixedScale: number | null,
): Promise<void> {
  const manifest = await readNoteManifest(api, scope, packageDir)
  const face = manifest.faces.html || Object.values(manifest.faces).find(isHtmlFace)
  if (!face) return
  await saveNoteFaceSettings(api, scope, packageDir, face.id, fixedScale !== null && Number.isFinite(fixedScale) ? { fixedScale } : {})
}
