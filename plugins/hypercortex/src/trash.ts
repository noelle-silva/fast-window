import { ASSETS_DIR, NOTES_DIR, ensureIndex, saveIndex, type Api, type NoteMeta, type VaultScope } from './core'
import { removeNoteFromRefIndex } from './noteRefs'
import { NOTE_MANIFEST_FILE, createNoteManifest, type HyperCortexNoteManifestV1 } from './noteSchema'

const TRASH_DIR = 'Trash'
const TRASH_META_FILE = 'trash-meta.json'

type TrashMetaV1 = {
  version: 1
  deletedAtMs: number
  originalDir?: string
}

export type HyperCortexTrashItem = {
  id: string
  title: string
  dir: string
  createdAtMs: number
  updatedAtMs: number
  deletedAtMs: number
  originalDir: string
}

function normalizePath(path: string): string {
  return String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

function noteDirToTrashDir(noteDir: string): string {
  const dir = normalizePath(noteDir)
  const [head, ...rest] = dir.split('/')
  if (head !== NOTES_DIR) throw new Error('笔记目录不在 Notes 下，无法移入回收站')
  return [TRASH_DIR, ...rest].join('/')
}

function trashDirToNoteDir(trashDir: string): string {
  const dir = normalizePath(trashDir)
  const [head, ...rest] = dir.split('/')
  if (head !== TRASH_DIR) throw new Error('回收站目录不在 Trash 下，无法恢复')
  return [NOTES_DIR, ...rest].join('/')
}

function noteMetaFromManifest(manifest: HyperCortexNoteManifestV1, packageDir: string): NoteMeta {
  return {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    dir: packageDir,
    createdAtMs: Number(manifest.createdAtMs) || Date.now(),
    updatedAtMs: Number(manifest.updatedAtMs) || Date.now(),
  }
}

async function readNoteManifest(api: Api, scope: VaultScope, packageDir: string): Promise<HyperCortexNoteManifestV1> {
  const dir = normalizePath(packageDir)
  const raw = await api.files.readText({ scope, path: `${dir}/${NOTE_MANIFEST_FILE}` })
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
    resources: Array.isArray((parsed as any).resources) ? (parsed as any).resources : [],
    faces: (parsed as any).faces,
  })
}

async function tryReadTrashMeta(api: Api, scope: VaultScope, dir: string): Promise<TrashMetaV1 | null> {
  const path = `${normalizePath(dir)}/${TRASH_META_FILE}`
  try {
    const raw = await api.files.readText({ scope, path })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if (Number((parsed as any).version) !== 1) return null
    const deletedAtMs = Number((parsed as any).deletedAtMs)
    if (!(deletedAtMs > 0)) return null
    const originalDir = typeof (parsed as any).originalDir === 'string' ? (parsed as any).originalDir.trim() : ''
    return { version: 1, deletedAtMs, originalDir: originalDir || undefined }
  } catch {
    return null
  }
}

async function writeTrashMeta(api: Api, scope: VaultScope, dir: string, meta: TrashMetaV1): Promise<void> {
  const path = `${normalizePath(dir)}/${TRASH_META_FILE}`
  await api.files.writeText({ scope, path, text: JSON.stringify(meta, null, 2), overwrite: true })
}

async function deleteTrashMetaFileIfExists(api: Api, scope: VaultScope, dir: string): Promise<void> {
  const path = `${normalizePath(dir)}/${TRASH_META_FILE}`
  await api.files.delete({ scope, path }).catch(() => {})
}

export async function ensureTrashDir(api: Api, scope: VaultScope): Promise<void> {
  await api.files.listDir({ scope, dir: TRASH_DIR }).catch(() => {})
}

export async function listTrashItems(api: Api, scope: VaultScope): Promise<HyperCortexTrashItem[]> {
  await ensureTrashDir(api, scope)
  const months = await api.files.listDir({ scope, dir: TRASH_DIR }).catch(() => [])
  const out: HyperCortexTrashItem[] = []

  for (const monthDir of months) {
    if (!monthDir.isDirectory) continue
    const packages = await api.files.listDir({ scope, dir: `${TRASH_DIR}/${monthDir.name}` }).catch(() => [])
    for (const entry of packages) {
      if (!entry.isDirectory) continue
      const packageDir = `${TRASH_DIR}/${monthDir.name}/${entry.name}`
      try {
        const manifest = await readNoteManifest(api, scope, packageDir)
        const meta = await tryReadTrashMeta(api, scope, packageDir)
        const deletedAtMs = meta?.deletedAtMs || entry.modifiedMs || Date.now()
        const originalDir = normalizePath(meta?.originalDir || trashDirToNoteDir(packageDir))
        out.push({
          id: manifest.id,
          title: manifest.title || '未命名',
          dir: normalizePath(packageDir),
          createdAtMs: Number(manifest.createdAtMs) || 0,
          updatedAtMs: Number(manifest.updatedAtMs) || 0,
          deletedAtMs,
          originalDir,
        })
      } catch {
      }
    }
  }

  out.sort((a, b) => (b.deletedAtMs || 0) - (a.deletedAtMs || 0))
  return out
}

export async function moveNoteToTrash(api: Api, scope: VaultScope, note: NoteMeta): Promise<{ trashDir: string }> {
  if (scope !== 'library') throw new Error('回收站仅支持 library scope')
  await ensureTrashDir(api, scope)
  const fromDir = normalizePath(note.dir)
  if (!fromDir) throw new Error('笔记目录为空，无法移入回收站')
  const toDir = noteDirToTrashDir(fromDir)

  await api.files.rename({ scope, from: fromDir, to: toDir, overwrite: false })

  const deletedAtMs = Date.now()
  await writeTrashMeta(api, scope, toDir, { version: 1, deletedAtMs, originalDir: fromDir }).catch(() => {})

  const idx = await ensureIndex(api, scope)
  if (idx.notes && Object.prototype.hasOwnProperty.call(idx.notes, note.id)) {
    const nextNotes = { ...(idx.notes || {}) }
    delete nextNotes[note.id]
    await saveIndex(api, scope, { ...idx, notes: nextNotes })
  }
  await removeNoteFromRefIndex(api, scope, note.id).catch(() => {})

  return { trashDir: toDir }
}

export async function permanentlyDeleteNoteDir(api: Api, scope: VaultScope, noteId: string, dir: string): Promise<void> {
  const nid = String(noteId || '').trim()
  const d = normalizePath(dir)
  if (!nid) throw new Error('noteId 不能为空')
  if (!d) throw new Error('dir 不能为空')
  if (d === NOTES_DIR || d === ASSETS_DIR || d === TRASH_DIR) throw new Error('禁止删除根目录')

  await api.files.deleteTree({ scope, path: d })

  const idx = await ensureIndex(api, scope)
  if (idx.notes && Object.prototype.hasOwnProperty.call(idx.notes, nid)) {
    const nextNotes = { ...(idx.notes || {}) }
    delete nextNotes[nid]
    await saveIndex(api, scope, { ...idx, notes: nextNotes })
  }
  await removeNoteFromRefIndex(api, scope, nid).catch(() => {})
}

export async function restoreTrashItem(api: Api, scope: VaultScope, item: HyperCortexTrashItem): Promise<{ meta: NoteMeta }> {
  if (scope !== 'library') throw new Error('回收站仅支持 library scope')
  const fromDir = normalizePath(item.dir)
  const desired = normalizePath(item.originalDir || trashDirToNoteDir(fromDir))

  await api.files.rename({ scope, from: fromDir, to: desired, overwrite: false })
  await deleteTrashMetaFileIfExists(api, scope, desired).catch(() => {})

  const manifest = await readNoteManifest(api, scope, desired)
  const meta = noteMetaFromManifest(manifest, desired)
  const idx = await ensureIndex(api, scope)
  await saveIndex(api, scope, { ...idx, notes: { ...(idx.notes || {}), [meta.id]: meta } })

  return { meta }
}

export async function maybeAutoCleanupTrash(api: Api, scope: VaultScope, days: number): Promise<{ deletedCount: number }> {
  const d = Math.floor(Number(days))
  if (!(d > 0)) return { deletedCount: 0 }
  if (scope !== 'library') return { deletedCount: 0 }

  const items = await listTrashItems(api, scope)
  const cutoff = Date.now() - d * 24 * 60 * 60 * 1000
  let deletedCount = 0

  for (const item of items) {
    if (!(item.deletedAtMs > 0) || item.deletedAtMs > cutoff) continue
    try {
      await permanentlyDeleteNoteDir(api, scope, item.id, item.dir)
      deletedCount++
    } catch {
    }
  }

  return { deletedCount }
}
