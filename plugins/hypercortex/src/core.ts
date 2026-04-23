import { NOTE_MANIFEST_FILE, createNoteManifest, type HyperCortexNoteManifestV1 } from './noteSchema'
import type { HyperCortexShortcutBindingsV1 } from './shortcuts'

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

export type HyperCortexMetadataV1 = {
  version: 1
  allNotesLayout?: 'list' | 'grid' | 'icon'
  sidebarItems?: HyperCortexSidebarItemV1[]
  openTabKeys?: string[]
  tabGroupByTabKey?: Record<string, string>
  activeTabKey?: string
  tabsCollapsed?: boolean
  tabsMode?: 'manual' | 'hover'
  tabGroups?: HyperCortexTabGroupV1[]
  workspaces?: HyperCortexWorkspaceV1[]
  activeWorkspaceId?: string
  shortcuts?: HyperCortexShortcutBindingsV1
  // When enabled, a "?" button appears in the top bar to show configured shortcuts.
  shortcutHintsEnabled?: boolean
  trashEnabled?: boolean
  trashAutoDeleteDays?: number
}

type TauriLike = { invoke: (req: { command: string; payload?: any }) => Promise<any> }

function createToast() {
  let el: HTMLDivElement | null = null
  let timer = 0 as any

  function ensure() {
    if (typeof document === 'undefined') return null
    if (el && el.isConnected) return el
    el = document.createElement('div')
    el.id = '__fastWindowHyperCortexToast'
    el.style.position = 'fixed'
    el.style.left = '50%'
    el.style.bottom = '24px'
    el.style.transform = 'translateX(-50%)'
    el.style.maxWidth = 'min(520px, calc(100vw - 24px))'
    el.style.padding = '10px 12px'
    el.style.borderRadius = '10px'
    el.style.background = 'rgba(0,0,0,0.82)'
    el.style.color = '#fff'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1.4'
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.28)'
    el.style.zIndex = '999999'
    el.style.opacity = '0'
    el.style.transition = 'opacity 160ms ease'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
    return el
  }

  return (message: any) => {
    const d = ensure()
    if (!d) return
    const text = String(message ?? '').trim()
    if (!text) return
    d.textContent = text
    d.style.opacity = '1'
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!d.isConnected) return
      d.style.opacity = '0'
    }, 1800)
  }
}

export function createCompatApi(baseApi: any): Api {
  const base = baseApi || {}
  const tauri: TauriLike | null = base?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const baseToast =
    base && base.ui && typeof base.ui.showToast === 'function' ? ((m: string) => base.ui.showToast(m)) : null
  const toast = createToast()

  const api: Api = {
    ...base,
    ui: {
      ...(base.ui || {}),
      showToast: (message: string) => {
        const m = String(message ?? '').trim()
        if (!m) return
        if (baseToast) return baseToast(m)
        toast(m)
      },
      startDragging: async () => {
        try {
          await tauri.invoke({ command: 'plugin:window|start_dragging', payload: {} })
        } catch (e: any) {
          const msg = String(e?.message || e || '无法拖拽')
          if (baseToast) return baseToast(msg)
          console.log(`[HyperCortex] ${msg}`)
        }
      },
    },
    clipboard: {
      ...(base.clipboard || {}),
      writeText: async (text: string) => {
        const s = String(text ?? '')
        await tauri.invoke({ command: 'plugin:clipboard-manager|write_text', payload: { text: s } })
      },
    },
    files: {
      ...(base.files || {}),
      getLibraryDir: async () => {
        return tauri.invoke({ command: 'plugin_get_library_dir', payload: { pluginId: PLUGIN_ID } })
      },
      pickLibraryDir: async () => {
        return tauri.invoke({ command: 'plugin_pick_library_dir', payload: { pluginId: PLUGIN_ID } })
      },
      openDir: async (dir: string) => {
        const s = String(dir || '').trim()
        if (!s) throw new Error('dir 不能为空')
        return tauri.invoke({ command: 'plugin_open_dir', payload: { pluginId: PLUGIN_ID, dir: s } })
      },
      listDir: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_list_dir', payload: { pluginId: PLUGIN_ID, req } })
      },
      readText: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_read_text', payload: { pluginId: PLUGIN_ID, req } })
      },
      writeText: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_write_text', payload: { pluginId: PLUGIN_ID, req } })
      },
      readBase64: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_read_base64', payload: { pluginId: PLUGIN_ID, req } })
      },
      writeBase64: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_write_base64', payload: { pluginId: PLUGIN_ID, req } })
      },
      rename: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_rename', payload: { pluginId: PLUGIN_ID, req } })
      },
      delete: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_delete', payload: { pluginId: PLUGIN_ID, req } })
      },
      deleteTree: async (req: any) => {
        return tauri.invoke({ command: 'plugin_files_delete_tree', payload: { pluginId: PLUGIN_ID, req } })
      },
      pickImages: async (maxCount?: number | null) => {
        return tauri.invoke({
          command: 'plugin_pick_images',
          payload: { pluginId: PLUGIN_ID, maxCount: maxCount == null ? null : Number(maxCount) },
        })
      },
    },
  }

  return api
}

let __hypercortexApiCache: Api | null = null

export function getApi(): Api {
  if (__hypercortexApiCache) return __hypercortexApiCache
  __hypercortexApiCache = createCompatApi((window as any).fastWindow)
  return __hypercortexApiCache
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

export async function sha256Hex(dataUrlOrBase64: string): Promise<string> {
  const s = String(dataUrlOrBase64 || '').trim()
  const b64 = s.startsWith('data:') ? s.split(',', 2)[1] || '' : s
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const hash = await crypto.subtle.digest('SHA-256', bin)
  const out = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return out
}

export function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;]+);base64,/.exec(String(dataUrl || '').trim())
  return m ? String(m[1] || '').toLowerCase() : ''
}

export function extFromMime(mime: string): string {
  const m = String(mime || '').toLowerCase()
  if (m === 'image/jpeg') return 'jpg'
  if (m === 'image/png') return 'png'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/svg+xml') return 'svg'

  if (m === 'audio/mpeg') return 'mp3'
  if (m === 'audio/wav') return 'wav'
  if (m === 'audio/ogg') return 'ogg'
  if (m === 'audio/flac') return 'flac'
  if (m === 'audio/aac') return 'aac'
  if (m === 'audio/mp4') return 'm4a'

  if (m === 'video/mp4') return 'mp4'
  if (m === 'video/webm') return 'webm'
  if (m === 'video/quicktime') return 'mov'

  if (m === 'application/pdf') return 'pdf'
  if (m === 'text/plain') return 'txt'
  if (m === 'text/csv') return 'csv'
  if (m === 'application/zip') return 'zip'
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  return ''
}

export function mimeFromExt(ext: string): string {
  const e = String(ext || '')
    .toLowerCase()
    .replace(/^\./, '')
    .trim()

  if (e === 'jpg') return 'image/jpeg'
  if (e === 'png') return 'image/png'
  if (e === 'webp') return 'image/webp'
  if (e === 'gif') return 'image/gif'
  if (e === 'svg') return 'image/svg+xml'

  if (e === 'mp3') return 'audio/mpeg'
  if (e === 'wav') return 'audio/wav'
  if (e === 'ogg') return 'audio/ogg'
  if (e === 'flac') return 'audio/flac'
  if (e === 'aac') return 'audio/aac'
  if (e === 'm4a') return 'audio/mp4'

  if (e === 'mp4') return 'video/mp4'
  if (e === 'webm') return 'video/webm'
  if (e === 'mov') return 'video/quicktime'

  if (e === 'pdf') return 'application/pdf'
  if (e === 'txt') return 'text/plain'
  if (e === 'csv') return 'text/csv'
  if (e === 'zip') return 'application/zip'
  if (e === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (e === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (e === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

  return ''
}

export function kindFromMime(mime: string): string {
  const m = String(mime || '').toLowerCase().trim()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return 'document'
}

export const ACCEPTED_FILE_EXTENSIONS = [
  'jpg',
  'png',
  'webp',
  'gif',
  'svg',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'aac',
  'm4a',
  'mp4',
  'webm',
  'mov',
  'pdf',
  'txt',
  'csv',
  'zip',
  'docx',
  'xlsx',
  'pptx',
] as const

export function acceptString(): string {
  return ACCEPTED_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')
}

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

function normalizeManifest(input: any): HyperCortexNoteManifestV1 {
  const id = String(input?.id || '').trim()
  if (!id) throw new Error('笔记 manifest 缺少 id')
  return createNoteManifest({
    id,
    title: input?.title,
    tags: Array.isArray(input?.tags) ? input.tags : [],
    createdAtMs: Number(input?.createdAtMs),
    updatedAtMs: Number(input?.updatedAtMs),
    schemaVersion: Number(input?.schemaVersion),
    resources: Array.isArray(input?.resources) ? input.resources : [],
  })
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

export async function rebuildIndexFromFs(api: Api, scope: VaultScope, idx: HyperCortexIndexV1): Promise<HyperCortexIndexV1> {
  await ensureVaultDirs(api, scope)
  const monthDirs = await api.files.listDir({ scope, dir: NOTES_DIR }).catch(() => [])
  const nextNotes: Record<string, NoteMeta> = {}

  for (const monthDir of monthDirs) {
    if (!monthDir.isDirectory) continue
    const packageDirs = await api.files.listDir({ scope, dir: `${NOTES_DIR}/${monthDir.name}` }).catch(() => [])
    for (const packageEntry of packageDirs) {
      if (!packageEntry.isDirectory) continue
      const packageDir = `${NOTES_DIR}/${monthDir.name}/${packageEntry.name}`
      try {
        const raw = await api.files.readText({ scope, path: `${packageDir}/${NOTE_MANIFEST_FILE}` })
        const manifest = normalizeManifest(JSON.parse(raw || 'null'))
        nextNotes[manifest.id] = {
          id: manifest.id,
          title: manifest.title,
          dir: packageDir,
          createdAtMs: Number(manifest.createdAtMs) > 0 ? Number(manifest.createdAtMs) : packageEntry.modifiedMs || Date.now(),
          updatedAtMs: Number(manifest.updatedAtMs) > 0 ? Number(manifest.updatedAtMs) : packageEntry.modifiedMs || Date.now(),
        }
      } catch {
      }
    }
  }

  const next: HyperCortexIndexV1 = { ...idx, notes: nextNotes }
  await saveIndex(api, scope, next).catch(() => {})
  return next
}
