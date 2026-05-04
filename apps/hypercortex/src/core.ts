import type { HyperCortexShortcutBindingsV1 } from './shortcuts'
export { acceptString, extFromMime, kindFromMime, mimeFromDataUrl, mimeFromExt } from './assetFileTypes'

export type VaultScope = 'library' | 'data'

export type Api = {
  __meta?: { runtime?: 'ui' | 'background' }
  host?: { back?: () => Promise<void> | void }
  ui: {
    showToast: (message: string) => Promise<void> | void
    back?: () => Promise<void> | void
    startDragging?: () => Promise<void> | void
  }
  clipboard: {
    writeText: (text: string) => Promise<void>
  }
  files: {
    getLibraryDir: () => Promise<string>
    pickLibraryDir: () => Promise<string | null>
    openDir: (dir: string) => Promise<void>
    listDir: (req: { scope: VaultScope; dir?: string | null }) => Promise<
      { name: string; isDirectory: boolean; isFile: boolean; size: number; modifiedMs: number }[]
    >
    readText: (req: { scope: VaultScope; path: string }) => Promise<string>
    writeText: (req: { scope: VaultScope; path: string; text: string; overwrite?: boolean | null }) => Promise<string>
    readBase64: (req: { scope: VaultScope; path: string }) => Promise<string>
    writeBase64: (req: { scope: VaultScope; path: string; dataUrlOrBase64: string; overwrite?: boolean | null }) => Promise<string>
    rename: (req: { scope: VaultScope; from: string; to: string; overwrite?: boolean | null }) => Promise<void>
    delete: (req: { scope: VaultScope; path: string }) => Promise<void>
    deleteTree: (req: { scope: VaultScope; path: string }) => Promise<void>
    pickImages: (maxCount?: number | null) => Promise<{ name: string; dataUrl: string }[]>
  }
}

export type NoteMeta = {
  id: string
  title: string
  description: string
  dir: string
  createdAtMs: number
  updatedAtMs: number
}

export type HyperCortexIndexV1 = {
  version: 1
  notes: Record<string, NoteMeta>
}

export const NOTES_DIR = 'Notes'
export const ASSETS_DIR = 'Assets'
export const INDEX_FILE = 'hypercortex-index.json'
export const METADATA_FILE = 'hypercortex-metadata.json'
export const REFS_INDEX_FILE = 'hypercortex-refs.json'
export const PLUGIN_ID = 'hypercortex'

export type HyperCortexTabGroupV1 = {
  id: string
  title: string
  color: string
  collapsed?: boolean
}

export type HyperCortexSidebarItemV1 =
  | { type: 'tab'; tabKey: string }
  | {
      type: 'group'
      id: string
      title: string
      color: string
      collapsed?: boolean
      tabKeys: string[]
    }

export type HyperCortexWorkspaceV1 = {
  id: string
  title: string
  sidebarItems: HyperCortexSidebarItemV1[]
  tabGroups: HyperCortexTabGroupV1[]
  openTabKeys: string[]
  tabGroupByTabKey: Record<string, string>
  activeTabKey: string
}

export type HyperCortexHtmlFaceDisplayModeV1 = 'natural' | 'fit-window' | 'fixed-fit'
export type HyperCortexSidebarSortModeV1 = 'precision' | 'sortable'

export type HyperCortexMetadataV1 = {
  version: 1
  allNotesLayout?: 'list' | 'grid' | 'icon'
  sidebarItems?: HyperCortexSidebarItemV1[]
  openTabKeys?: string[]
  tabGroupByTabKey?: Record<string, string>
  activeTabKey?: string
  tabsCollapsed?: boolean
  tabsMode?: 'manual' | 'hover'
  sidebarSortMode?: HyperCortexSidebarSortModeV1
  tabGroups?: HyperCortexTabGroupV1[]
  workspaces?: HyperCortexWorkspaceV1[]
  activeWorkspaceId?: string
  shortcuts?: HyperCortexShortcutBindingsV1
  // When enabled, a "?" button appears in the top bar to show configured shortcuts.
  shortcutHintsEnabled?: boolean
  htmlFaceDisplayMode?: HyperCortexHtmlFaceDisplayModeV1
  htmlFaceFixedScaleDefault?: number
  trashEnabled?: boolean
  trashAutoDeleteDays?: number
}

export function nowId(): string {
  const d = new Date()
  const pad = (n: number, w: number) => String(n).padStart(w, '0')
  return (
    pad(d.getFullYear(), 4) +
    pad(d.getMonth() + 1, 2) +
    pad(d.getDate(), 2) +
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2) +
    pad(d.getSeconds(), 2) +
    pad(d.getMilliseconds(), 3)
  )
}

export function safeTitleForFile(title: string): string {
  const raw = String(title || '').trim().replace(/\s+/g, ' ')
  const base = raw || '未命名'
  let s = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  s = s.replace(/[. ]+$/g, '').trim()
  if (!s) s = '未命名'
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s || '未命名'
}

export function noteMonthFolderFromIdOrNow(id: string): string {
  const s = String(id || '').trim()
  if (/^\d{6,}$/.test(s)) {
    const y = s.slice(0, 4)
    const m = s.slice(4, 6)
    if (/^\d{4}$/.test(y) && /^(0[1-9]|1[0-2])$/.test(m)) return `${y}-${m}`
  }
  return monthFolder()
}

export { escapeHtml } from './html'
export type { HyperCortexNoteDoc } from './noteSchema'

export function monthFolder(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export async function ensureVaultDirs(api: Api, scope: VaultScope): Promise<void> {
  await api.files.listDir({ scope, dir: NOTES_DIR }).catch(() => {})
  await api.files.listDir({ scope, dir: ASSETS_DIR }).catch(() => {})
  // 附件新结构：Assets/(images|videos|docs)/YYYY-MM/...
  await api.files.listDir({ scope, dir: `${ASSETS_DIR}/images` }).catch(() => {})
  await api.files.listDir({ scope, dir: `${ASSETS_DIR}/videos` }).catch(() => {})
  await api.files.listDir({ scope, dir: `${ASSETS_DIR}/docs` }).catch(() => {})
}

export async function probeHasVault(api: Api, scope: VaultScope): Promise<boolean> {
  const root = await api.files.listDir({ scope, dir: null }).catch(() => [])
  if (root.some(ent => ent.isFile && ent.name === INDEX_FILE)) return true
  const hasNotesDir = root.some(ent => ent.isDirectory && ent.name === NOTES_DIR)
  if (!hasNotesDir) return false

  const notes = await api.files.listDir({ scope, dir: NOTES_DIR }).catch(() => [])
  for (const monthDir of notes) {
    if (!monthDir.isDirectory) continue
    const items = await api.files.listDir({ scope, dir: `${NOTES_DIR}/${monthDir.name}` }).catch(() => [])
    for (const ent of items) {
      if (!ent.isDirectory) continue
      const packageDir = `${NOTES_DIR}/${monthDir.name}/${ent.name}`
      const packageItems = await api.files.listDir({ scope, dir: packageDir }).catch(() => [])
      if (packageItems.some(item => item.isFile && item.name === NOTE_MANIFEST_FILE)) return true
    }
  }
  return false
}

export async function tryLoadIndex(api: Api, scope: VaultScope): Promise<HyperCortexIndexV1 | null> {
  try {
    const raw = await api.files.readText({ scope, path: INDEX_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.version !== 1) return null
    if (!parsed.notes || typeof parsed.notes !== 'object') return null

    const notes = Object.fromEntries(
      Object.entries(parsed.notes)
        .map(([id, value]) => {
          const note = value as any
          const dir = String(note?.dir || '').trim()
          if (!dir) throw new Error('index note dir 缺失')
          return [
            id,
            {
              id: String(note?.id || id).trim(),
              title: String(note?.title || '').trim() || '未命名',
              description: String(note?.description ?? '').trim(),
              dir,
              createdAtMs: Number(note?.createdAtMs) > 0 ? Number(note.createdAtMs) : 0,
              updatedAtMs: Number(note?.updatedAtMs) > 0 ? Number(note.updatedAtMs) : 0,
            } satisfies NoteMeta,
          ]
        }),
    )

    return { version: 1, notes }
  } catch {
    return null
  }
}

export async function ensureIndex(api: Api, scope: VaultScope): Promise<HyperCortexIndexV1> {
  const existing = await tryLoadIndex(api, scope)
  if (existing) return existing
  const fresh: HyperCortexIndexV1 = { version: 1, notes: {} }
  await api.files
    .writeText({ scope, path: INDEX_FILE, text: JSON.stringify(fresh, null, 2), overwrite: true })
    .catch(() => {})
  return fresh
}

export async function saveIndex(api: Api, scope: VaultScope, idx: HyperCortexIndexV1): Promise<void> {
  await api.files.writeText({ scope, path: INDEX_FILE, text: JSON.stringify(idx, null, 2), overwrite: true })
}

export async function tryLoadMetadata(api: Api): Promise<HyperCortexMetadataV1 | null> {
  try {
    const raw = await api.files.readText({ scope: 'data', path: METADATA_FILE })
    const parsed = JSON.parse(raw || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.version !== 1) return null
    return parsed as HyperCortexMetadataV1
  } catch {
    return null
  }
}

export async function ensureMetadata(api: Api): Promise<HyperCortexMetadataV1> {
  const existing = await tryLoadMetadata(api)
  if (existing) return existing
  const fresh: HyperCortexMetadataV1 = { version: 1 }
  await api.files.writeText({ scope: 'data', path: METADATA_FILE, text: JSON.stringify(fresh, null, 2), overwrite: true }).catch(() => {})
  return fresh
}

export async function saveMetadata(api: Api, meta: HyperCortexMetadataV1): Promise<void> {
  await api.files.writeText({ scope: 'data', path: METADATA_FILE, text: JSON.stringify(meta, null, 2), overwrite: true })
}

