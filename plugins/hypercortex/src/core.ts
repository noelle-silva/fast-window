export type VaultScope = 'library' | 'output'

export type Api = {
  __meta?: { runtime?: 'ui' | 'background' }
  host?: { back?: () => Promise<void> | void }
  ui: { showToast: (message: string) => Promise<void> | void; back?: () => Promise<void> | void }
  files: {
    getLibraryDir: () => Promise<string>
    // legacy: 用于兼容旧库（曾存放在 output scope 下）
    getOutputDir: () => Promise<string>
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
    pickImages: (maxCount?: number | null) => Promise<{ name: string; dataUrl: string }[]>
  }
}

export type NoteMeta = {
  id: string
  title: string
  file: string
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
export const PLUGIN_ID = 'hypercortex'

type TauriLike = { invoke: (req: { command: string; payload?: any }) => Promise<any> }

export function createCompatApi(baseApi: any): Api {
  const base = baseApi || {}
  const tauri: TauriLike | null = base?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const baseToast =
    base && base.ui && typeof base.ui.showToast === 'function' ? ((m: string) => base.ui.showToast(m)) : null

  const api: Api = {
    ...base,
    ui: {
      ...(base.ui || {}),
      showToast: (message: string) => {
        const m = String(message ?? '').trim()
        if (!m) return
        if (baseToast) return baseToast(m)
        console.log(`[HyperCortex] ${m}`)
      },
    },
    files: {
      ...(base.files || {}),
      getLibraryDir: async () => {
        return tauri.invoke({ command: 'plugin_get_library_dir', payload: { pluginId: PLUGIN_ID } })
      },
      getOutputDir: async () => {
        return tauri.invoke({ command: 'plugin_get_output_dir', payload: { pluginId: PLUGIN_ID } })
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

export function noteFilename(id: string, title: string): string {
  return `${id}_${safeTitleForFile(title)}.html`
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

export function noteDirForId(id: string): string {
  return `${NOTES_DIR}/${noteMonthFolderFromIdOrNow(id)}`
}

export function noteRelPath(id: string, title: string): string {
  return `${noteDirForId(id)}/${noteFilename(id, title)}`
}

export function parseNoteFilename(name: string): { id: string; title: string } | null {
  const lower = name.toLowerCase()
  if (!(lower.endsWith('.html') || lower.endsWith('.htm'))) return null
  const base = name.replace(/\.html?$/i, '')
  const idx = base.indexOf('_')
  if (idx <= 0) return null
  const id = base.slice(0, idx).trim()
  if (!/^\d{8,}$/.test(id)) return null
  const title = base.slice(idx + 1).trim()
  return { id, title: title || '未命名' }
}

export function escapeHtml(s: string): string {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildNoteHtmlDoc(meta: { id: string; title: string; contentHtml: string }): string {
  const title = String(meta.title || '未命名').trim() || '未命名'
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="hypercortex-note-id" content="${escapeHtml(meta.id)}" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.6; margin: 22px; }
      img { max-width: 100%; height: auto; }
      pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      pre { padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 10px; overflow: auto; }
      blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #e5e7eb; color: #374151; }
    </style>
  </head>
  <body>
    <div id="hypercortex-content">${meta.contentHtml || ''}</div>
  </body>
</html>`
}

function relPrefixToRootFromFile(file: string): string {
  const parts = String(file || '')
    .replaceAll('\\', '/')
    .split('/')
    .slice(0, -1)
    .filter(Boolean)
  return parts.length ? '../'.repeat(parts.length) : ''
}

export function normalizeEditorHtmlForSave(html: string, noteFile: string): string {
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html || ''}</div>`, 'text/html')
  const root = doc.getElementById('__root__')
  if (!root) return html || ''

  const prefix = relPrefixToRootFromFile(noteFile)
  const imgs = Array.from(root.querySelectorAll('img'))
  for (const img of imgs) {
    const assetRel = (img.getAttribute('data-hypercortex-asset') || '').trim()
    if (assetRel) {
      img.setAttribute('src', `${prefix}${assetRel.replace(/^[./]+/, '')}`)
    }
  }
  return root.innerHTML
}

export async function sha256Hex(dataUrlOrBase64: string): Promise<string> {
  const s = String(dataUrlOrBase64 || '').trim()
  const b64 = s.startsWith('data:') ? (s.split(',', 2)[1] || '') : s
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
  return ''
}

export function monthFolder(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export async function ensureVaultDirs(api: Api, scope: VaultScope): Promise<void> {
  await api.files.listDir({ scope, dir: NOTES_DIR }).catch(() => {})
  await api.files.listDir({ scope, dir: ASSETS_DIR }).catch(() => {})
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
      if (!ent.isFile) continue
      if (parseNoteFilename(ent.name)) return true
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
    return parsed as HyperCortexIndexV1
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

export async function rebuildIndexFromFs(api: Api, scope: VaultScope, idx: HyperCortexIndexV1): Promise<HyperCortexIndexV1> {
  await ensureVaultDirs(api, scope)
  const monthDirs = await api.files.listDir({ scope, dir: NOTES_DIR })
  const nextNotes: Record<string, NoteMeta> = {}

  for (const monthDir of monthDirs) {
    if (!monthDir.isDirectory) continue
    const items = await api.files.listDir({ scope, dir: `${NOTES_DIR}/${monthDir.name}` }).catch(() => [])
    for (const ent of items) {
      if (!ent.isFile) continue
      const parsed = parseNoteFilename(ent.name)
      if (!parsed) continue

      const file = `${NOTES_DIR}/${monthDir.name}/${ent.name}`
      const existing = idx.notes[parsed.id]
      const createdAtMs = existing?.createdAtMs ?? ent.modifiedMs ?? Date.now()
      const updatedAtMs = ent.modifiedMs ?? existing?.updatedAtMs ?? createdAtMs
      nextNotes[parsed.id] = {
        id: parsed.id,
        title: parsed.title,
        file,
        createdAtMs,
        updatedAtMs,
      }
    }
  }

  const next: HyperCortexIndexV1 = { ...idx, notes: nextNotes }
  await saveIndex(api, scope, next).catch(() => {})
  return next
}

export async function readNoteDoc(
  api: Api,
  scope: VaultScope,
  file: string,
): Promise<{ title: string; contentHtml: string }> {
  const raw = await api.files.readText({ scope, path: file })
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const title = String(doc.querySelector('title')?.textContent || '').trim() || '未命名'
  const root = doc.getElementById('hypercortex-content')
  const content = root ? root.innerHTML : (doc.body?.innerHTML || '')

  const wrap = new DOMParser().parseFromString(`<div id="__root__">${content}</div>`, 'text/html')
  const r = wrap.getElementById('__root__')
  if (!r) return { title, contentHtml: content }

  const imgs = Array.from(r.querySelectorAll('img'))
  for (const img of imgs) {
    const src = (img.getAttribute('src') || '').trim()
    if (!src) continue
    const rel = src.replace(/^[./]+/, '')
    if (!rel.startsWith(`${ASSETS_DIR}/`)) continue

    img.setAttribute('data-hypercortex-asset', rel)
    img.setAttribute('data-hypercortex-src', src)
    try {
      const dataUrl = await api.files.readBase64({ scope, path: rel })
      if (String(dataUrl || '').startsWith('data:')) {
        img.setAttribute('src', dataUrl)
      }
    } catch {}
  }

  return { title, contentHtml: r.innerHTML }
}

