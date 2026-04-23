import type { AiDrawFastWindowApi } from '../bridge/tauriCompat'
import {
  DEFAULT_REQUEST_TIMEOUT_SEC,
  UI_MODE_LOCAL_EDIT,
  UI_MODE_NORMAL,
  defaultRefLibraryIndex,
  defaultPromptLibrary,
  defaultProvider,
  normalizeRefLibraryIndex,
  normalizePromptLibrary,
  normalizePromptHistory,
  normalizePromptHistoryLimit,
  normalizeRequestTimeoutSec,
  normalizeSettings,
  normalizeUiMode,
  resolveModel,
  type AiDrawProvider,
  type AiDrawSettingsV1,
  type PromptLibraryFolder,
  type PromptLibraryPrompt,
  type PromptLibraryV1,
  type RefLibraryFolder,
  type RefLibraryIndexV1,
  type UiMode,
} from '../core/schema'
import { normalizeImageDataUrlOrBase64, inferImageMimeFromBase64 } from '../core/images'
import {
  cropDataUrlByPixels,
  loadImageFromDataUrl,
  normalizeSelRect,
  selRectToPixels,
  shrinkRefImageDataUrl,
  compositePatchToBase,
  type PickedImage,
} from '../core/imageCanvas'
import { formatBytes, id, isHttpBaseUrl, normalizeBatchCount, trimSlash } from '../core/utils'
import { buildMultipartFormDataBytes, base64ToBytes, bytesToBase64, inferExtFromMime } from '../core/multipart'
import { parseErrorBody, parseImageDataUrlFromHttpBodyText } from '../core/httpParse'
import { formatAiDrawError } from '../core/errorFormat'

const STORAGE_KEY = 'settings'
const PROMPT_LIBRARY_KEY = 'promptLibrary'
const REF_LIBRARY_INDEX_KEY = 'refLibraryIndex'
const BG_SAVED_RESULTS_KEY = 'bgSavedResults'
const BG_SAVE_REQUESTS_KEY = 'bgSaveRequests'
const BG_SAVE_RESPONSES_KEY = 'bgSaveResponses'

const MAX_BATCH_COUNT = 20
const MAX_REF_IMAGES = 8
const TASK_POLL_INTERVAL = 1200
const TASK_KIND_HTTP_REQUEST = 'http.request'
const MAX_TASK_JSON_BODY_CHARS = 10 * 1024 * 1024
const REF_SHRINK_MAX_DIMENSION = 960
const REF_SHRINK_IF_OVER_BYTES = 900 * 1024

export type AiDrawTaskItem = { id: string; status: string; prompt: string; at: number }
export type AiDrawImageHistoryItem = {
  savedPath: string
  // Full image data URL (shared by main output view and batch preview).
  dataUrl: string
  loading?: boolean
  error?: string
}

export type AiDrawEditState = {
  baseName: string
  baseDataUrl: string
  baseW: number
  baseH: number
  sel: { x: number; y: number; w: number; h: number } | null
}

export type AiDrawControllerState = {
  loading: boolean
  submitting: boolean
  error: string
  prompt: string
  batchCount: string
  refImages: PickedImage[]
  refLibrary: {
    loading: boolean
    busy: boolean
    paths: string[]
    itemsByPath: Record<string, { dataUrl: string; loading: boolean; error: string }>
    indexLoading: boolean
    index: RefLibraryIndexV1 | null
  }
  data: AiDrawSettingsV1 | null
  outputDir: string
  savedPath: string
  imageDataUrl: string
  imageHistory: AiDrawImageHistoryItem[]
  imageHistoryIndex: number
  tasks: AiDrawTaskItem[]
  promptHistory: string[]
  promptHistoryIndex: number
  promptHistoryDraft: string
  promptLib: { loading: boolean; data: PromptLibraryV1 | null }
  uiMode: UiMode
  edit: AiDrawEditState
}

type Listener = () => void

export type AiDrawController = {
  getState: () => AiDrawControllerState
  getRevision: () => number
  subscribe: (fn: Listener) => () => void
  init: () => Promise<void>

  setPrompt: (text: string) => void
  setBatchCount: (text: string) => void
  switchPromptHistory: (direction: -1 | 1) => void

  setUiMode: (mode: UiMode) => Promise<void>

  pickRefImages: () => Promise<void>
  addRefImagesFromFiles: (files: File[]) => Promise<void>
  removeRefImage: (refId: string) => void
  clearRefImages: () => void
  refreshRefLibrary: () => Promise<void>
  ensureRefLibraryItemLoaded: (path: string) => void
  importRefLibraryFromPicker: () => Promise<void>
  deleteRefLibraryItem: (path: string) => Promise<void>
  deleteRefLibraryItems: (paths: string[]) => Promise<void>
  addRefImageFromLibrary: (path: string) => Promise<void>
  loadRefLibraryIndex: () => Promise<void>
  setRefLibraryView: (view: { kind: 'all' | 'folder'; folderId?: string }) => Promise<void>
  addRefFolder: (name?: string, parentId?: string | null) => Promise<void>
  renameRefFolder: (folderId: string, name: string) => Promise<void>
  deleteRefFolder: (folderId: string) => Promise<void>
  setRefItemFolderIds: (path: string, folderIds: string[]) => Promise<void>

  pickEditImage: () => Promise<void>
  clearEditImage: () => void
  setEditSelection: (sel: { x: number; y: number; w: number; h: number } | null) => void

  generate: () => Promise<void>
  cancelTask: (taskId: string) => Promise<void>
  cancelAllTasks: () => Promise<void>

  refreshImageHistory: (preferPath?: string) => Promise<void>
  switchImageHistory: (direction: -1 | 1) => Promise<void>
  ensureImageHistoryItemLoaded: (savedPath: string) => void

  pickOutputDir: () => Promise<void>
  openOutputDir: () => Promise<void>

  copyImage: () => Promise<void>
  saveImage: () => Promise<void>
  deleteCurrentOutputImage: () => Promise<void>

  setActiveProviderId: (providerId: string) => Promise<void>
  addProvider: () => Promise<void>
  deleteProvider: (providerId: string) => Promise<void>
  saveProvider: (providerId: string, next: Partial<AiDrawProvider> & { modelsText?: string }) => Promise<void>

  loadPromptLibrary: () => Promise<void>
  setActivePromptFolderId: (folderId: string) => Promise<void>
  addPromptFolder: (name?: string) => Promise<void>
  renamePromptFolder: (folderId: string, name: string) => Promise<void>
  deletePromptFolder: (folderId: string) => Promise<void>
  addPromptToActiveFolder: (text: string) => Promise<void>
  deletePrompt: (folderId: string, promptId: string) => Promise<void>
  usePromptText: (text: string) => void

  savePluginSettings: (patch: Partial<Pick<AiDrawSettingsV1, 'autoSave' | 'shrinkRefImages' | 'promptHistoryLimit' | 'requestTimeoutSec'>>) => Promise<void>
  clearPromptHistory: () => Promise<void>

  deletePromptHistoryItem: (text: string) => Promise<void>
  deletePromptHistoryItems: (texts: string[]) => Promise<void>
}

function isTaskDone(status: string) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

function parseModelsText(text: any) {
  const raw = String(text ?? '')
  const lines = raw.split(/\r?\n/g).map((x) => String(x || '').trim()).filter(Boolean)
  const out: string[] = []
  for (const s of lines) {
    if (!out.includes(s)) out.push(s)
    if (out.length >= 200) break
  }
  return out
}

function activeProvider(data: AiDrawSettingsV1 | null): AiDrawProvider | null {
  if (!data) return null
  const pid = String(data.activeProviderId || '')
  const ps = Array.isArray(data.providers) ? data.providers : []
  return ps.find((p) => p && p.id === pid) || ps[0] || null
}

function requestTimeoutMs(data: AiDrawSettingsV1 | null) {
  const sec = normalizeRequestTimeoutSec(data?.requestTimeoutSec ?? DEFAULT_REQUEST_TIMEOUT_SEC)
  return sec * 1000
}

export function createAiDrawController(api: AiDrawFastWindowApi): AiDrawController {
  const listeners = new Set<Listener>()
  const localEditContextByTaskId = new Map<string, { baseDataUrl: string; selPx: { x: number; y: number; w: number; h: number } }>()
  const imageLoadByPath = new Map<string, Promise<string>>()

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!(file instanceof File)) return reject(new Error('file 无效'))
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(new Error('读取图片失败'))
      r.readAsDataURL(file)
    })
  }

  // 批量预览读图：复用参考图库同款懒加载与并发限流机制。
  const imageThumbQueue: string[] = []
  const imageThumbQueued = new Set<string>()
  let imageThumbActive = 0
  let imageThumbDrainTimer: any = null
  const IMAGE_THUMB_MAX_CONCURRENT = 8

  const scheduleDrainImageThumbQueue = () => {
    if (imageThumbDrainTimer) return
    imageThumbDrainTimer = setTimeout(() => {
      imageThumbDrainTimer = null
      drainImageThumbQueue()
    }, 0)
  }

  const drainImageThumbQueue = () => {
    while (imageThumbActive < IMAGE_THUMB_MAX_CONCURRENT && imageThumbQueue.length) {
      const p = String(imageThumbQueue.pop() || '').trim()
      if (!p) continue
      imageThumbQueued.delete(p)

      const item = state.imageHistory.find((x) => String(x?.savedPath || '').trim() === p)
      if (!item) continue
      if (item.dataUrl) continue
      if (item.loading) continue
      if (imageLoadByPath.has(`thumb:${p}`)) continue

      item.loading = true
      item.error = ''
      notify()

      imageThumbActive++
      const job = api.files.images.read({ scope: 'output', path: p })
        .then((x) => normalizeImageDataUrlOrBase64(x))
        .finally(() => {
          imageLoadByPath.delete(`thumb:${p}`)
          imageThumbActive = Math.max(0, imageThumbActive - 1)
          scheduleDrainImageThumbQueue()
        })

      imageLoadByPath.set(`thumb:${p}`, job)
      void job.then((u) => {
        const latest = state.imageHistory.find((x) => String(x?.savedPath || '').trim() === p)
        if (!latest) return

        if (!u || !u.startsWith('data:image/')) {
          latest.loading = false
          latest.error = '加载失败'
          notify()
          return
        }

        latest.dataUrl = u
        latest.loading = false
        latest.error = ''
        notify()
      }).catch(() => {
        const latest = state.imageHistory.find((x) => String(x?.savedPath || '').trim() === p)
        if (!latest) return
        latest.loading = false
        latest.error = '加载失败'
        notify()
      })
    }
  }

  let revision = 0
  let taskPollTimer: any = null
  let taskPolling = false
  let bgSaveWatchTimer: any = null
  let bgSaveWatchTaskId = ''
  let bgSaveWatchStartedAt = 0

  const state: AiDrawControllerState = {
    loading: true,
    submitting: false,
    error: '',
    prompt: '',
    batchCount: '1',
    refImages: [],
    refLibrary: { loading: false, busy: false, paths: [], itemsByPath: {}, indexLoading: false, index: null },
    data: null,
    outputDir: '',
    savedPath: '',
    imageDataUrl: '',
    imageHistory: [],
    imageHistoryIndex: -1,
    tasks: [],
    promptHistory: [],
    promptHistoryIndex: -1,
    promptHistoryDraft: '',
    promptLib: { loading: false, data: null },
    uiMode: UI_MODE_NORMAL,
    edit: { baseName: '', baseDataUrl: '', baseW: 0, baseH: 0, sel: null },
  }

  function notify() {
    revision++
    for (const fn of listeners) fn()
  }

  async function saveSettings() {
    if (!state.data) return
    await api.storage.set(STORAGE_KEY, state.data)
  }

  async function saveRefLibraryIndex() {
    const d = state.refLibrary.index
    if (!d) return
    await api.storage.set(REF_LIBRARY_INDEX_KEY, d).catch((e: any) => {
      api.ui.showToast(`参考图库收藏夹保存失败：${String(e?.message || e)}`)
    })
  }

  async function savePromptLibrary() {
    const d = state.promptLib.data
    if (!d) return
    await api.storage.set(PROMPT_LIBRARY_KEY, d).catch(() => {})
  }

  async function loadRefLibraryIndex() {
    if (state.refLibrary.indexLoading) return
    state.refLibrary.indexLoading = true
    notify()
    try {
      const raw = await api.storage.get(REF_LIBRARY_INDEX_KEY).catch(() => null)
      const loaded = normalizeRefLibraryIndex(raw)
      const cur = ensureRefLibraryIndexData()

      // 只在“当前内存态为空”时，从磁盘补齐，避免加载晚到覆盖用户刚创建的数据。
      if (!cur.folders.length && loaded.folders.length) cur.folders = loaded.folders
      if (!Object.keys(cur.folderIdsByPath || {}).length && Object.keys(loaded.folderIdsByPath || {}).length) {
        cur.folderIdsByPath = loaded.folderIdsByPath
      }
      if (cur.activeView.kind === 'all' && loaded.activeView.kind === 'folder') {
        cur.activeView = loaded.activeView
      }
      await saveRefLibraryIndex().catch(() => {})
    } finally {
      state.refLibrary.indexLoading = false
      notify()
    }
  }

  function ensureRefLibraryIndexData() {
    if (!state.refLibrary.index) state.refLibrary.index = defaultRefLibraryIndex()
    const d = state.refLibrary.index
    if (!Array.isArray(d.folders)) state.refLibrary.index = defaultRefLibraryIndex()
    const d2 = state.refLibrary.index
    if (!Array.isArray(d2.folders)) d2.folders = []
    if (!d2.activeView || typeof d2.activeView !== 'object') d2.activeView = { kind: 'all', folderId: '' }
    if (String((d2.activeView as any).kind || '') !== 'folder') d2.activeView = { kind: 'all', folderId: '' }
    const activeFolderId = String((d2.activeView as any).folderId || '').trim()
    if (d2.activeView.kind === 'folder' && activeFolderId && d2.folders.some((f) => f.id === activeFolderId)) {
      d2.activeView.folderId = activeFolderId
    } else {
      d2.activeView = { kind: 'all', folderId: '' }
    }
    return d2
  }

  function computeFolderDescendants(folderId: string, folders: RefLibraryFolder[]) {
    const childrenByParent = new Map<string, string[]>()
    for (const f of folders) {
      const pid = f.parentId || ''
      const arr = childrenByParent.get(pid) || []
      arr.push(f.id)
      childrenByParent.set(pid, arr)
    }
    const out = new Set<string>()
    const stack = [folderId]
    while (stack.length) {
      const cur = stack.pop() || ''
      if (!cur) continue
      const kids = childrenByParent.get(cur) || []
      for (const k of kids) {
        if (out.has(k)) continue
        out.add(k)
        stack.push(k)
      }
    }
    return out
  }

  async function setRefLibraryView(view: { kind: 'all' | 'folder'; folderId?: string }) {
    const d = ensureRefLibraryIndexData()
    const kind = view.kind === 'folder' ? 'folder' : 'all'
    const fidRaw = String(view.folderId || '').trim()
    const fid = d.folders.some((f) => f.id === fidRaw) ? fidRaw : ''
    d.activeView = kind === 'folder' && fid ? { kind: 'folder', folderId: fid } : { kind: 'all', folderId: '' }
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function addRefFolder(name?: string, parentId?: string | null) {
    const d = ensureRefLibraryIndexData()
    const pidRaw = String(parentId ?? '').trim()
    const pid = pidRaw && d.folders.some((f) => f.id === pidRaw) ? pidRaw : null
    const f: RefLibraryFolder = { id: id('rlf'), name: String(name || '').trim() || '收藏夹', parentId: pid, at: Date.now() }
    d.folders.unshift(f)
    d.activeView = { kind: 'folder', folderId: f.id }
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function renameRefFolder(folderId: string, name: string) {
    const d = ensureRefLibraryIndexData()
    const fid = String(folderId || '').trim()
    const f = d.folders.find((x) => x.id === fid)
    if (!f) return
    f.name = String(name || '').trim() || '收藏夹'
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function deleteRefFolder(folderId: string) {
    const d = ensureRefLibraryIndexData()
    const fid = String(folderId || '').trim()
    if (!fid) return
    const del = new Set<string>([fid])
    for (const x of computeFolderDescendants(fid, d.folders)) del.add(x)

    d.folders = d.folders.filter((x) => !del.has(x.id))
    const nextMap: Record<string, string[]> = {}
    for (const [p, ids] of Object.entries(d.folderIdsByPath || {})) {
      const keep = (Array.isArray(ids) ? ids : []).filter((x) => !del.has(String(x || '').trim()))
      if (keep.length) nextMap[p] = keep
    }
    d.folderIdsByPath = nextMap

    if (d.activeView.kind === 'folder' && del.has(d.activeView.folderId)) {
      d.activeView = { kind: 'all', folderId: '' }
    }
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function setRefItemFolderIds(path: string, folderIds: string[]) {
    const d = ensureRefLibraryIndexData()
    const p = String(path || '').trim()
    if (!p) return
    const valid = new Set(d.folders.map((x) => x.id))
    const out: string[] = []
    const raw = Array.isArray(folderIds) ? folderIds : []
    for (const x of raw) {
      const fid = String(x || '').trim()
      if (!fid) continue
      if (!valid.has(fid)) continue
      if (!out.includes(fid)) out.push(fid)
      if (out.length >= 50) break
    }
    if (out.length) d.folderIdsByPath[p] = out
    else delete d.folderIdsByPath[p]
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  function syncPromptHistoryToData(persist: boolean) {
    if (!state.data) return
    state.data.promptHistory = state.promptHistory.slice()
    if (!persist) return
    void saveSettings().catch(() => {})
  }

  function addPromptHistory(text: string) {
    const raw = String(text || '').trim()
    if (!raw) return
    const existed = state.promptHistory.indexOf(raw)
    if (existed >= 0) state.promptHistory.splice(existed, 1)
    state.promptHistory.push(raw)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''

    const limit = normalizePromptHistoryLimit(state.data?.promptHistoryLimit)
    if (state.promptHistory.length > limit) {
      state.promptHistory = state.promptHistory.slice(state.promptHistory.length - limit)
      state.promptHistoryIndex = -1
      state.promptHistoryDraft = ''
    }

    syncPromptHistoryToData(true)
  }

  async function deletePromptHistoryItems(texts: string[]) {
    const raw = Array.isArray(texts) ? texts : []
    const del = new Set<string>()
    for (const t of raw) {
      const s = String(t || '').trim()
      if (s) del.add(s)
      if (del.size >= 500) break
    }
    if (!del.size) return

    state.promptHistory = state.promptHistory.filter((x) => !del.has(String(x || '').trim()))
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    syncPromptHistoryToData(true)
    notify()
  }

  async function deletePromptHistoryItem(text: string) {
    const s = String(text || '').trim()
    if (!s) return
    await deletePromptHistoryItems([s])
  }

  function canSwitchPromptPrev() {
    if (!state.promptHistory.length) return false
    return state.promptHistoryIndex === -1 || state.promptHistoryIndex > 0
  }

  function canSwitchPromptNext() {
    if (!state.promptHistory.length) return false
    if (state.promptHistoryIndex === -1) return false
    if (state.promptHistoryIndex < state.promptHistory.length - 1) return true
    const draft = String(state.promptHistoryDraft || '').trim()
    const latest = String(state.promptHistory[state.promptHistory.length - 1] || '').trim()
    return draft !== latest
  }

  function switchPromptHistory(direction: -1 | 1) {
    if (!state.promptHistory.length) return
    const step = direction < 0 ? -1 : 1

    if (step < 0 && state.promptHistoryIndex === -1) {
      state.promptHistoryDraft = String(state.prompt || '')
      state.promptHistoryIndex = state.promptHistory.length - 1
      state.prompt = String(state.promptHistory[state.promptHistoryIndex] || '')
      notify()
      return
    }

    if (step > 0 && state.promptHistoryIndex === -1) return

    const next = state.promptHistoryIndex + step
    if (next >= state.promptHistory.length) {
      const draft = String(state.promptHistoryDraft || '').trim()
      const latest = String(state.promptHistory[state.promptHistory.length - 1] || '').trim()
      if (draft && draft === latest) {
        state.promptHistoryIndex = state.promptHistory.length - 1
        state.prompt = String(state.promptHistory[state.promptHistoryIndex] || '')
        notify()
        return
      }
      state.promptHistoryIndex = -1
      state.prompt = state.promptHistoryDraft
      state.promptHistoryDraft = ''
      notify()
      return
    }

    if (next < 0) return
    state.promptHistoryIndex = next
    state.prompt = String(state.promptHistory[next] || '')
    notify()
  }

  function stopTaskPolling() {
    if (taskPollTimer) {
      clearTimeout(taskPollTimer)
      taskPollTimer = null
    }
    taskPolling = false
  }

  function upsertTask(item: Partial<AiDrawTaskItem> & { id: string }) {
    const tid = String(item.id || '').trim()
    if (!tid) return false

    const list = Array.isArray(state.tasks) ? state.tasks : []
    const idx = list.findIndex((x) => x && x.id === tid)
    const prev = idx >= 0 ? list[idx] : null
    const status = Object.prototype.hasOwnProperty.call(item, 'status')
      ? String(item.status || '').trim() || 'pending'
      : String(prev?.status || 'pending')
    const prompt = Object.prototype.hasOwnProperty.call(item, 'prompt') ? String(item.prompt || '') : String(prev?.prompt || '')
    const at = Object.prototype.hasOwnProperty.call(item, 'at') ? Number(item.at) : Number(prev?.at || Date.now())

    const merged: AiDrawTaskItem = { id: tid, status, prompt, at: Number.isFinite(at) ? at : Date.now() }
    const changed = !prev || prev.status !== merged.status || prev.prompt !== merged.prompt || prev.at !== merged.at

    if (idx >= 0) list[idx] = merged
    else list.unshift(merged)
    state.tasks = list.slice(0, 50)
    return changed
  }

  function removeTask(taskId: string) {
    const tid = String(taskId || '').trim()
    if (!tid) return false
    const list = Array.isArray(state.tasks) ? state.tasks : []
    const next = list.filter((x) => x && x.id !== tid)
    state.tasks = next
    return next.length !== list.length
  }

  function getActiveTasks() {
    const list = Array.isArray(state.tasks) ? state.tasks : []
    return list.filter((t) => t && !isTaskDone(String(t.status || '')))
  }

  async function getBackgroundSavedPath(taskId: string) {
    const tid = String(taskId || '').trim()
    if (!tid) return ''
    const raw = await api.storage.get(BG_SAVED_RESULTS_KEY).catch(() => null)
    const map = raw && typeof raw === 'object' ? { ...(raw as any) } : {}
    const hit = (map as any)[tid]
    const path = hit && typeof hit.savedPath === 'string' ? String(hit.savedPath).trim() : ''
    return path || ''
  }

  function sleepMs(ms: any) {
    const t = Number(ms)
    const safe = Number.isFinite(t) && t > 0 ? t : 0
    return new Promise((resolve) => setTimeout(resolve, safe))
  }

  async function waitBackgroundSavedPath(taskId: string, timeoutMs = 4500, intervalMs = 250) {
    const tid = String(taskId || '').trim()
    if (!tid) return ''
    const startedAt = Date.now()
    const timeout = Number(timeoutMs)
    const interval = Number(intervalMs)
    while (Date.now() - startedAt < (Number.isFinite(timeout) && timeout > 0 ? timeout : 0)) {
      const hit = await getBackgroundSavedPath(tid)
      if (hit) return hit
      await sleepMs(Number.isFinite(interval) && interval > 0 ? interval : 250)
    }
    return ''
  }

  async function waitBackgroundSaveResponse(reqId: string, timeoutMs = 6000, intervalMs = 250) {
    const rid = String(reqId || '').trim()
    if (!rid) return ''
    const startedAt = Date.now()
    const timeout = Number(timeoutMs)
    const interval = Number(intervalMs)
    while (Date.now() - startedAt < (Number.isFinite(timeout) && timeout > 0 ? timeout : 0)) {
      const raw = await api.storage.get(BG_SAVE_RESPONSES_KEY).catch(() => null)
      const map = raw && typeof raw === 'object' ? (raw as any) : null
      const hit = map && map[rid] ? map[rid] : null
      const p = hit && typeof hit.savedPath === 'string' ? String(hit.savedPath).trim() : ''
      if (p) return p
      await sleepMs(Number.isFinite(interval) && interval > 0 ? interval : 250)
    }
    return ''
  }

  async function enqueueBackgroundSave(dataUrl: string) {
    const data = String(dataUrl || '').trim()
    if (!data) return ''
    const rid = `save-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const raw = await api.storage.get(BG_SAVE_REQUESTS_KEY).catch(() => null)
    const map = raw && typeof raw === 'object' ? { ...(raw as any) } : {}
    ;(map as any)[rid] = { dataUrl: data, at: Date.now(), by: 'ui' }
    await api.storage.set(BG_SAVE_REQUESTS_KEY, map).catch(() => {})
    return rid
  }

  function stopBackgroundSavedPathWatcher() {
    if (bgSaveWatchTimer) {
      clearTimeout(bgSaveWatchTimer)
      bgSaveWatchTimer = null
    }
    bgSaveWatchTaskId = ''
    bgSaveWatchStartedAt = 0
  }

  async function tickBackgroundSavedPathWatcher() {
    const tid = String(bgSaveWatchTaskId || '').trim()
    if (!tid) return stopBackgroundSavedPathWatcher()
    if (state.savedPath) return stopBackgroundSavedPathWatcher()
    const startedAt = Number(bgSaveWatchStartedAt) || 0
    if (startedAt && Date.now() - startedAt > 2 * 60 * 1000) return stopBackgroundSavedPathWatcher()

    const hit = await getBackgroundSavedPath(tid).catch(() => '')
    if (hit) {
      if (!state.savedPath) {
        state.error = ''
        state.savedPath = String(hit || '')
        await refreshImageHistoryFromOutputDir(state.savedPath)
        notify()
        api.ui.showToast('已生成并保存')
      }
      stopBackgroundSavedPathWatcher()
      return
    }

    bgSaveWatchTimer = setTimeout(() => {
      void tickBackgroundSavedPathWatcher()
    }, 900)
  }

  function startBackgroundSavedPathWatcher(taskId: string) {
    const tid = String(taskId || '').trim()
    if (!tid) return
    if (bgSaveWatchTaskId === tid && bgSaveWatchTimer) return
    stopBackgroundSavedPathWatcher()
    bgSaveWatchTaskId = tid
    bgSaveWatchStartedAt = Date.now()
    bgSaveWatchTimer = setTimeout(() => void tickBackgroundSavedPathWatcher(), 900)
  }

  async function applyImageHistoryIndex(index: number) {
    const idx = Number(index)
    if (!Number.isFinite(idx) || idx < 0) return
    const item = state.imageHistory[idx]
    if (!item) return
    state.imageHistoryIndex = idx
    state.savedPath = String(item.savedPath || '')

    if (item.dataUrl) {
      state.imageDataUrl = item.dataUrl
      item.loading = false
      item.error = ''
      notify()
      return
    }

    state.imageDataUrl = ''
    item.loading = true
    item.error = ''
    notify()

    const loaded = await api.files.images.read({ scope: 'output', path: state.savedPath }).catch(() => '')
    if (!loaded) {
      item.loading = false
      item.error = '加载失败'
      notify()
      return
    }
    if (state.imageHistoryIndex !== idx) return
    item.dataUrl = String(loaded).trim()
    state.imageDataUrl = item.dataUrl
    item.loading = false
    item.error = ''
    notify()
  }

  async function refreshImageHistoryFromOutputDir(preferPath = '') {
    const paths = await api.files.images.list({ scope: 'output' }).catch(() => [])
    const list = (Array.isArray(paths) ? paths : []).map((x) => String(x || '').trim()).filter(Boolean)
    const prevByPath = new Map(
      (Array.isArray(state.imageHistory) ? state.imageHistory : [])
        .map((it) => [String(it?.savedPath || '').trim(), it] as const)
        .filter(([p]) => !!p),
    )
    state.imageHistory = list.reverse().map((savedPath) => {
      const prev = prevByPath.get(savedPath)
      return prev || { savedPath, dataUrl: '', loading: false, error: '' }
    })

    // 列表刷新后，清空旧的排队任务，避免队列堆积与加载无效项。
    imageThumbQueue.length = 0
    imageThumbQueued.clear()

    if (!state.imageHistory.length) {
      state.imageHistoryIndex = -1
      state.imageDataUrl = ''
      state.savedPath = ''
      notify()
      return
    }

    let target = String(preferPath || '').trim()
    if (!target) target = String(state.savedPath || '').trim()

    let index = state.imageHistory.length - 1
    if (target) {
      const found = state.imageHistory.findIndex((it) => String(it.savedPath || '') === target)
      if (found >= 0) index = found
    }
    await applyImageHistoryIndex(index)
  }

  function ensureImageHistoryItemLoaded(savedPath: string) {
    const p = String(savedPath || '').trim()
    if (!p) return

    const item = state.imageHistory.find((x) => String(x?.savedPath || '').trim() === p)
    if (!item) return
    if (item.dataUrl) return
    if (item.loading) return
    if (imageLoadByPath.has(`thumb:${p}`)) return

    // 去重入队，交给 drain 按并发上限执行。
    if (imageThumbQueued.has(p)) return
    imageThumbQueued.add(p)
    // 最近请求优先，滚动时更贴近用户视线。
    imageThumbQueue.push(p)
    scheduleDrainImageThumbQueue()
  }

  async function switchImageHistory(direction: -1 | 1) {
    if (!state.imageHistory.length) return
    const step = direction < 0 ? -1 : 1
    if (step < 0 && state.imageHistoryIndex === -1) {
      await applyImageHistoryIndex(state.imageHistory.length - 1)
      return
    }
    const next = state.imageHistoryIndex + step
    if (next < 0 || next >= state.imageHistory.length) return
    await applyImageHistoryIndex(next)
  }

  function isShrinkRefImagesEnabled() {
    return !(state.data && state.data.shrinkRefImages === false)
  }

  async function applyTaskCompletion(task: any) {
    const status = String(task?.status || '')
    const taskId = String(task?.id || '').trim()

    if (status === 'succeeded') {
      try {
        const localCtx = taskId ? localEditContextByTaskId.get(taskId) : null
        const tagsRaw = task?.meta && Array.isArray(task.meta.tags) ? task.meta.tags : []
        const tags = Array.isArray(tagsRaw) ? tagsRaw.map((x) => String(x || '').trim()).filter(Boolean) : []

        if (localCtx) {
          localEditContextByTaskId.delete(taskId)
          const r = task && task.result && typeof task.result === 'object' ? task.result : {}
          const httpStatus = Number(r.status)
          const bodyText = typeof r.body === 'string' ? r.body : ''
          if (!Number.isFinite(httpStatus)) throw new Error('请求失败：无响应')
          if (httpStatus < 200 || httpStatus >= 300) throw new Error(`HTTP ${httpStatus}：${parseErrorBody(bodyText)}`)

          const patch = parseImageDataUrlFromHttpBodyText(bodyText)
          if (!patch) throw new Error('未拿到图片数据（请确保服务端返回 base64 图片）')

          const finalDataUrl = await compositePatchToBase(localCtx.baseDataUrl, patch, localCtx.selPx)
          if (!finalDataUrl) throw new Error('合成失败：无法把结果贴回原图')

          // 局部模式：输出图与底图分离展示。
          // - 不替换底图（state.edit.baseDataUrl）
          // - 不清空选区（state.edit.sel）
          state.imageDataUrl = finalDataUrl
          state.savedPath = ''
          notify()

          if (state.data && state.data.autoSave) {
            const rid = await enqueueBackgroundSave(finalDataUrl).catch(() => '')
            if (!rid) throw new Error('保存失败：无法发起后台保存')
            api.ui.showToast('已生成（保存中…）')
            const savedPath = await waitBackgroundSaveResponse(rid).catch(() => '')
            if (savedPath) {
              state.savedPath = savedPath
              await refreshImageHistoryFromOutputDir(state.savedPath)
              api.ui.showToast('已生成并保存')
            }
          } else {
            api.ui.showToast('已生成（已贴回选区）')
          }
          return
        }

        if (tags.includes('local-edit') || tags.includes('no-autosave')) {
          throw new Error('局部绘图任务已完成，但上下文已丢失（请重新生成）')
        }

        const bgSavedPath = state.data && state.data.autoSave ? await getBackgroundSavedPath(taskId) : ''
        if (bgSavedPath) {
          state.savedPath = bgSavedPath
          await refreshImageHistoryFromOutputDir(state.savedPath)
          stopBackgroundSavedPathWatcher()
          api.ui.showToast('已生成并保存')
          return
        }

        const r = task && task.result && typeof task.result === 'object' ? task.result : {}
        const httpStatus = Number(r.status)
        const bodyText = typeof r.body === 'string' ? r.body : ''
        if (!Number.isFinite(httpStatus)) throw new Error('请求失败：无响应')
        if (httpStatus < 200 || httpStatus >= 300) throw new Error(`HTTP ${httpStatus}：${parseErrorBody(bodyText)}`)

        const dataUrl = parseImageDataUrlFromHttpBodyText(bodyText)
        if (!dataUrl) {
          try {
            const j = JSON.parse(String(bodyText || '{}'))
            const item = (Array.isArray(j?.data) && j.data[0]) || (Array.isArray(j?.images) && j.images[0]) || null
            if (item?.url) throw new Error('服务端返回 url（宿主无法下载二进制）。请配置为返回 base64（b64_json / b64_png / data_url）。')
          } catch {}
          throw new Error('未拿到图片数据（b64_json）')
        }

        const generatedDataUrl = String(dataUrl).trim()
        if (state.data && state.data.autoSave) {
          state.imageDataUrl = generatedDataUrl
          state.savedPath = ''
          notify()

          const waited = await waitBackgroundSavedPath(taskId, 20000, 250)
          if (waited) {
            state.savedPath = waited
            await refreshImageHistoryFromOutputDir(state.savedPath)
            stopBackgroundSavedPathWatcher()
            api.ui.showToast('已生成并保存')
            return
          }

          startBackgroundSavedPathWatcher(taskId)
          api.ui.showToast('已生成（等待后台保存…）')
          return
        }

        state.imageDataUrl = generatedDataUrl
        state.savedPath = ''
        notify()
        api.ui.showToast('已生成')
        return
      } catch (e: any) {
        const msg = String(e?.message || e || '生成失败')
        state.error = formatAiDrawError({ hint: '生成失败', stage: '处理任务结果', rawMessage: msg })
        notify()
        api.ui.showToast(`生成失败：${msg}`)
        return
      }
    }

    if (status === 'failed') {
      const rr = task && task.result && typeof task.result === 'object' ? task.result : null
      const taskErr = String((task as any)?.error || '').trim()
      const rawHttpStatus = rr ? Number(rr.status) : NaN
      const rawBodyText = rr && typeof rr.body === 'string' ? rr.body : ''
      const body = typeof rawBodyText === 'string' ? rawBodyText : ''
      const err = body ? parseErrorBody(body) : ''
      const msg = formatAiDrawError({
        hint: '生成失败',
        stage: '后台任务执行',
        httpStatus: Number.isFinite(rawHttpStatus) ? rawHttpStatus : null,
        serverMessage: err,
        taskError: taskErr,
        rawMessage: taskErr || (!Number.isFinite(rawHttpStatus) ? '请求失败：无响应/无状态' : ''),
      })
      state.error = msg
      notify()
      api.ui.showToast(`生成失败：${String(err || taskErr || '请求失败')}`)
      return
    }
  }

  async function pollTasks() {
    if (taskPolling) return
    const active = getActiveTasks()
    if (!active.length) {
      stopTaskPolling()
      return
    }

    taskPolling = true
    try {
      const infos = await Promise.all(active.map((t) => api.task.get(String(t.id || '')).catch(() => null)))
      let changed = false
      for (const info of infos) {
        if (!info) continue
        const tid = String(info.id || '').trim()
        if (!tid) continue
        const st = String(info.status || '')
        if (upsertTask({ id: tid, status: st })) changed = true
        if (isTaskDone(st)) {
          await applyTaskCompletion(info)
          removeTask(tid)
          changed = true
        }
      }
      if (changed) notify()
    } finally {
      taskPolling = false
      if (getActiveTasks().length) {
        taskPollTimer = setTimeout(() => void pollTasks(), TASK_POLL_INTERVAL)
      }
    }
  }

  async function generateNormal() {
    stopBackgroundSavedPathWatcher()

    const prompt = String(state.prompt || '').trim()
    if (!prompt) {
      state.error = '请输入提示词'
      notify()
      return
    }

    const p = activeProvider(state.data)
    const baseUrl = trimSlash(String(p?.baseUrl || ''))
    const apiKey = String(p?.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) {
      state.error = '请先在设置里配置 Base URL（http:// 或 https://）'
      notify()
      return
    }
    if (!apiKey) {
      state.error = '请先在设置里填写 API Key'
      notify()
      return
    }
    const model = resolveModel(p)
    if (!model) {
      state.error = '请先配置模型'
      notify()
      return
    }

    const rawBatch = String(state.batchCount || '')
    const batch = normalizeBatchCount(rawBatch, MAX_BATCH_COUNT)
    if (String(batch) !== rawBatch.trim()) state.batchCount = String(batch)

    state.submitting = true
    state.error = ''
    addPromptHistory(prompt)
    notify()

    const protocol = String(p?.protocol || 'images') === 'chat' ? 'chat' : 'images'
    const refUrls = (Array.isArray(state.refImages) ? state.refImages : [])
      .map((x) => String(x && x.dataUrl ? x.dataUrl : '').trim())
      .filter((x) => x.startsWith('data:image/'))
      .slice(0, MAX_REF_IMAGES)

    const refForSend: string[] = []
    for (const u of refUrls) {
      const safeUrl = isShrinkRefImagesEnabled()
        ? await shrinkRefImageDataUrl(u, { maxDimension: REF_SHRINK_MAX_DIMENSION, ifOverBytes: REF_SHRINK_IF_OVER_BYTES }).catch(() => u)
        : u
      if (String(safeUrl || '').startsWith('data:image/')) refForSend.push(safeUrl)
    }

    const useEdits = protocol === 'images' && refForSend.length
    if (useEdits) api.ui.showToast('已选参考图：自动使用 /images/edits（多图参考）')

    const chatUserContent = refForSend.length
      ? [{ type: 'text', text: prompt }, ...refForSend.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : prompt

    const size = String(p?.size || '').trim() || '1024x1024'
    const protocolKind = protocol === 'chat' ? 'chat' : useEdits ? 'images-edits' : 'images'

    let req: any = null
    let debugBodyText = ''
    if (protocolKind === 'chat') {
      const body = JSON.stringify({
        model,
        messages: [
          ...(String(p?.chatSystemPrompt || '').trim()
            ? [{ role: 'system', content: String(p?.chatSystemPrompt || '').trim() }]
            : []),
          { role: 'user', content: chatUserContent },
        ],
        temperature: 0.2,
      })
      if (body.length > MAX_TASK_JSON_BODY_CHARS) {
        state.submitting = false
        api.ui.showToast('请求体过大：请减少参考图/换更小图片')
        state.error = `请求体过大（约 ${formatBytes(body.length)}）。请减少参考图数量/换更小图片（建议裁剪或压缩），再试一次。`
        notify()
        return
      }
      req = {
        mode: 'task',
        method: 'POST',
        url: `${baseUrl}/chat/completions`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        timeoutMs: requestTimeoutMs(state.data),
      }
      debugBodyText = body
    } else if (protocolKind === 'images-edits') {
      const boundary = `fast-window-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const parts: any[] = [
        { name: 'model', value: model },
        { name: 'prompt', value: prompt },
        { name: 'size', value: size },
        { name: 'response_format', value: 'b64_json' },
      ]
      for (let i = 0; i < refForSend.length; i++) {
        const url = refForSend[i]
        const mime = inferImageMimeFromBase64(url) || 'image/png'
        const ext = inferExtFromMime(mime)
        const dataBytes = base64ToBytes(url)
        parts.push({ name: 'image[]', filename: `ref-${i + 1}.${ext}`, contentType: mime, dataBytes })
      }
      const mpBytes = buildMultipartFormDataBytes(boundary, parts)
      if (mpBytes.length > MAX_TASK_JSON_BODY_CHARS) {
        state.submitting = false
        api.ui.showToast('请求体过大：请减少参考图/换更小图片')
        state.error = `请求体过大（约 ${formatBytes(mpBytes.length)}）。请减少参考图数量/换更小图片（建议裁剪或压缩），再试一次。`
        notify()
        return
      }
      req = {
        mode: 'task',
        method: 'POST',
        url: `${baseUrl}/images/edits`,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${apiKey}` },
        bodyBase64: bytesToBase64(mpBytes),
        timeoutMs: requestTimeoutMs(state.data),
      }
      debugBodyText = `[multipart/form-data] fields=model,prompt,size,response_format; images=${refForSend.length}; bytes=${formatBytes(mpBytes.length)}`
    } else {
      const body = JSON.stringify({ model, prompt, size, n: 1, response_format: 'b64_json' })
      if (body.length > MAX_TASK_JSON_BODY_CHARS) {
        state.submitting = false
        api.ui.showToast('请求体过大：请减少参考图/换更小图片')
        state.error = `请求体过大（约 ${formatBytes(body.length)}）。请减少参考图数量/换更小图片（建议裁剪或压缩），再试一次。`
        notify()
        return
      }
      req = {
        mode: 'task',
        method: 'POST',
        url: `${baseUrl}/images/generations`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        timeoutMs: requestTimeoutMs(state.data),
      }
      debugBodyText = body
    }

    try {
      const results = await Promise.allSettled(Array.from({ length: batch }, () => api.net.request({ ...req })))
      const ids: string[] = []
      let failed = 0
      const rejectReasons: string[] = []
      for (const r of results) {
        if (r.status !== 'fulfilled') {
          failed++
          const reasonText = String((r as any)?.reason?.message ?? (r as any)?.reason ?? '').trim()
          if (reasonText) rejectReasons.push(reasonText)
          continue
        }
        const taskId = String((r as any).value && (r as any).value.id ? (r as any).value.id : '').trim()
        if (!taskId) {
          failed++
          continue
        }
        ids.push(taskId)
        upsertTask({ id: taskId, status: 'pending', prompt, at: Date.now() })
      }

      if (!ids.length) throw new Error('创建后台任务失败')
      if (failed) api.ui.showToast(`部分任务创建失败：${failed} 个`)
      if (failed && rejectReasons.length) {
        state.error = formatAiDrawError({
          hint: `部分任务创建失败：${failed} 个`,
          stage: '创建后台任务',
          method: String(req?.method || ''),
          url: String(req?.url || ''),
          timeoutMs: typeof req?.timeoutMs === 'number' ? req.timeoutMs : null,
          rawMessage: rejectReasons[0],
        })
      }

      if (state.data) {
        state.data.pendingTaskId = ids[ids.length - 1]
        await saveSettings().catch(() => {})
      }
      state.submitting = false
      notify()
      void pollTasks()
    } catch (e: any) {
      state.submitting = false
      state.error = formatAiDrawError({
        hint: '生成失败',
        stage: '创建后台任务',
        method: String(req?.method || ''),
        url: String(req?.url || ''),
        timeoutMs: typeof req?.timeoutMs === 'number' ? req.timeoutMs : null,
        rawMessage: String(e?.message || e || '请求失败'),
      })
      notify()
    }
  }

  async function generateLocalEdit() {
    stopBackgroundSavedPathWatcher()
    const prompt = String(state.prompt || '').trim()
    if (!prompt) {
      state.error = '请输入提示词'
      notify()
      return
    }

    const baseUrl = String(state.edit?.baseDataUrl || '').trim()
    if (!baseUrl.startsWith('data:image/')) {
      state.error = '请先选择一张图片'
      notify()
      return
    }

    const selPx = selRectToPixels(state.edit?.sel, state.edit?.baseW, state.edit?.baseH)
    if (!selPx) {
      state.error = '请在图片上拖拽选择矩形区域'
      notify()
      return
    }

    const p = activeProvider(state.data)
    const base = trimSlash(String(p?.baseUrl || ''))
    const apiKey = String(p?.apiKey || '').trim()
    if (!isHttpBaseUrl(base)) {
      state.error = '请先在设置里配置 Base URL（http:// 或 https://）'
      notify()
      return
    }
    if (!apiKey) {
      state.error = '请先在设置里填写 API Key'
      notify()
      return
    }
    if (String(p?.protocol || 'images') !== 'chat') {
      state.error = '局部修改需要 chat 协议（/chat/completions）'
      notify()
      return
    }

    const model = resolveModel(p)
    if (!model) {
      state.error = '请先配置模型'
      notify()
      return
    }

    state.submitting = true
    state.error = ''
    addPromptHistory(prompt)
    notify()

    try {
      const cropPng = await cropDataUrlByPixels(baseUrl, selPx)
      if (!cropPng) throw new Error('裁剪失败：无法生成选区图片')
      const cropForSend = isShrinkRefImagesEnabled()
        ? await shrinkRefImageDataUrl(cropPng, { maxDimension: REF_SHRINK_MAX_DIMENSION, ifOverBytes: REF_SHRINK_IF_OVER_BYTES }).catch(() => cropPng)
        : cropPng

      const refUrls = (Array.isArray(state.refImages) ? state.refImages : [])
        .map((x) => String(x && x.dataUrl ? x.dataUrl : '').trim())
        .filter((x) => x.startsWith('data:image/'))
        .slice(0, MAX_REF_IMAGES)

      const instruction =
        `请根据要求修改图片：${prompt}\n` +
        `图 1 是需要修改的“选区图片”；后续图片（如果有）是参考图（风格/细节参考）。\n` +
        `只输出一张最终图片（PNG），尺寸必须与输入图片一致。\n` +
        `输出格式必须是 data URL（data:image/png;base64,...）或 JSON（{\"data_url\":\"...\"} / {\"b64_png\":\"...\"} / {\"b64_json\":\"...\"}），不要输出其它文字。`

      const refForSend: string[] = []
      for (const u of refUrls) {
        const safeUrl = isShrinkRefImagesEnabled()
          ? await shrinkRefImageDataUrl(u, { maxDimension: REF_SHRINK_MAX_DIMENSION, ifOverBytes: REF_SHRINK_IF_OVER_BYTES }).catch(() => u)
          : u
        if (String(safeUrl || '').startsWith('data:image/')) refForSend.push(safeUrl)
      }

      const body = JSON.stringify({
        model,
        messages: [
          ...(String(p?.chatSystemPrompt || '').trim()
            ? [{ role: 'system', content: String(p?.chatSystemPrompt || '').trim() }]
            : []),
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: cropForSend } },
              ...refForSend.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          },
        ],
        temperature: 0.2,
      })

      if (body.length > MAX_TASK_JSON_BODY_CHARS) {
        throw new Error(`请求体过大（约 ${formatBytes(body.length)}）。请缩小选区/减少参考图/换更小图片。`)
      }

      const created = await api.task.create({
        kind: TASK_KIND_HTTP_REQUEST,
        meta: { tags: ['no-autosave', 'local-edit'] },
        payload: {
          method: 'POST',
          url: `${base}/chat/completions`,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body,
          timeoutMs: requestTimeoutMs(state.data),
        },
      })

      const taskId = String(created && (created as any).id ? (created as any).id : '').trim()
      if (!taskId) throw new Error('创建后台任务失败')

      localEditContextByTaskId.set(taskId, { baseDataUrl: baseUrl, selPx })
      upsertTask({ id: taskId, status: 'pending', prompt, at: Date.now() })
      state.submitting = false
      notify()
      void pollTasks()
    } catch (e: any) {
      state.submitting = false
      state.error = formatAiDrawError({
        hint: '生成失败',
        stage: '提交局部任务',
        method: 'POST',
        url: `${trimSlash(String(p?.baseUrl || ''))}/chat/completions`,
        timeoutMs: requestTimeoutMs(state.data),
        rawMessage: String(e?.message || e || '请求失败'),
      })
      notify()
    }
  }

  async function generate() {
    const mode = normalizeUiMode(state.data?.uiMode)
    if (mode === UI_MODE_LOCAL_EDIT) {
      await generateLocalEdit()
      return
    }
    await generateNormal()
  }

  async function pickRefImages() {
    const remaining = MAX_REF_IMAGES - (Array.isArray(state.refImages) ? state.refImages.length : 0)
    if (remaining <= 0) {
      api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
      return
    }
    const picked = await api.files.pickImages(remaining).catch((e: any) => {
      api.ui.showToast(`选择图片失败：${String(e?.message || e)}`)
      return []
    })
    const list = Array.isArray(picked) ? picked : []
    const out: PickedImage[] = []
    for (const it of list) {
      const name = typeof (it as any)?.name === 'string' ? (it as any).name : ''
      const raw =
        typeof (it as any)?.dataUrl === 'string'
          ? (it as any).dataUrl
          : typeof (it as any)?.data_url === 'string'
            ? (it as any).data_url
            : typeof (it as any)?.base64 === 'string'
              ? (it as any).base64
              : ''
      const u = normalizeImageDataUrlOrBase64(raw)
      if (!u.startsWith('data:image/')) continue
      out.push({ id: id('ref'), name: String(name || ''), dataUrl: u })
      if (out.length >= remaining) break
    }

    if (!out.length) return
    const merged = state.refImages.concat(out).slice(0, MAX_REF_IMAGES)
    if (merged.length < state.refImages.length + out.length) api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
    state.refImages = merged
    notify()
  }

  async function addRefImagesFromFiles(files: File[]) {
    const list = Array.isArray(files) ? files : []
    const remaining = MAX_REF_IMAGES - (Array.isArray(state.refImages) ? state.refImages.length : 0)
    if (remaining <= 0) {
      api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
      return
    }

    const out: PickedImage[] = []
    for (const f of list.slice(0, remaining)) {
      try {
        const dataUrl = await readFileAsDataUrl(f)
        const u = normalizeImageDataUrlOrBase64(dataUrl)
        if (!u.startsWith('data:image/')) continue
        out.push({ id: id('ref'), name: String(f?.name || '图片'), dataUrl: u })
      } catch (_) {}
    }
    if (!out.length) {
      api.ui.showToast('未识别到图片')
      return
    }

    const merged = state.refImages.concat(out).slice(0, MAX_REF_IMAGES)
    if (merged.length < state.refImages.length + out.length) api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
    state.refImages = merged
    notify()
  }

  async function pickEditImage() {
    const picked = await api.files.pickImages(1).catch((e: any) => {
      api.ui.showToast(`选择图片失败：${String(e?.message || e)}`)
      return []
    })
    const it = Array.isArray(picked) && picked[0] ? picked[0] : null
    const name = typeof it?.name === 'string' ? it.name : ''
    const raw = typeof (it as any)?.dataUrl === 'string' ? (it as any).dataUrl : typeof (it as any)?.data_url === 'string' ? (it as any).data_url : ''
    const u = normalizeImageDataUrlOrBase64(raw)
    if (!u.startsWith('data:image/')) return api.ui.showToast('图片数据无效（需要 data URL 或 base64）')

    try {
      const img = await loadImageFromDataUrl(u)
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      state.edit.baseName = String(name || '图片')
      state.edit.baseDataUrl = u
      state.edit.baseW = Number(w) || 0
      state.edit.baseH = Number(h) || 0
      state.edit.sel = null
      state.error = ''
      notify()
    } catch (e: any) {
      api.ui.showToast(`解析图片失败：${String(e?.message || e)}`)
    }
  }

  async function refreshRefLibrary() {
    if (state.refLibrary.loading) return
    state.refLibrary.loading = true
    notify()
    try {
      const paths = await api.files.images.list({ scope: 'data' }).catch(() => [])
      const list = (Array.isArray(paths) ? paths : []).map((x) => String(x || '').trim()).filter(Boolean)
      state.refLibrary.paths = list
      // 清理已不存在的缓存，避免无限增长
      const next: AiDrawControllerState['refLibrary']['itemsByPath'] = {}
      for (const p of list) {
        next[p] = state.refLibrary.itemsByPath[p] || { dataUrl: '', loading: false, error: '' }
      }
      state.refLibrary.itemsByPath = next

      const idx = state.refLibrary.index
      if (idx && idx.folderIdsByPath && typeof idx.folderIdsByPath === 'object') {
        let changed = false
        for (const k of Object.keys(idx.folderIdsByPath)) {
          if (!list.includes(k)) {
            delete idx.folderIdsByPath[k]
            changed = true
          }
        }
        if (changed) void saveRefLibraryIndex().catch(() => {})
      }
    } finally {
      state.refLibrary.loading = false
      notify()
    }
  }

  function ensureRefLibraryItemLoaded(path: string) {
    const p = String(path || '').trim()
    if (!p) return
    const slot = state.refLibrary.itemsByPath[p] || (state.refLibrary.itemsByPath[p] = { dataUrl: '', loading: false, error: '' })
    if (slot.dataUrl) return
    if (slot.loading) return
    slot.loading = true
    slot.error = ''
    notify()

    Promise.resolve()
      .then(async () => {
        const dataUrl = await api.files.images.read({ scope: 'data', path: p }).catch(() => '')
        const u = normalizeImageDataUrlOrBase64(dataUrl)
        if (!u.startsWith('data:image/')) throw new Error('图片数据无效')
        slot.dataUrl = u
      })
      .catch((e: any) => {
        slot.error = String(e?.message || e || '加载失败')
      })
      .finally(() => {
        slot.loading = false
        notify()
      })
  }

  async function importRefLibraryFromPicker() {
    if (state.refLibrary.busy) return
    state.refLibrary.busy = true
    notify()
    try {
      const picked = await api.files.pickImages(12).catch((e: any) => {
        api.ui.showToast(`选择图片失败：${String(e?.message || e)}`)
        return []
      })
      const list = Array.isArray(picked) ? picked : []
      let ok = 0
      let failed = 0
      let firstError = ''
      for (const it of list) {
        const raw =
          typeof (it as any)?.dataUrl === 'string'
            ? (it as any).dataUrl
            : typeof (it as any)?.data_url === 'string'
              ? (it as any).data_url
              : typeof (it as any)?.base64 === 'string'
                ? (it as any).base64
                : ''
        const u = normalizeImageDataUrlOrBase64(raw)
        if (!u.startsWith('data:image/')) continue
        try {
          const savedPath = await api.files.images.writeBase64({ scope: 'data', dataUrlOrBase64: u })
          if (savedPath) ok++
          else failed++
        } catch (e: any) {
          failed++
          if (!firstError) firstError = String(e?.message || e || 'unknown')
        }
      }
      if (ok && failed) api.ui.showToast(`已导入 ${ok} 张，失败 ${failed} 张${firstError ? `：${firstError}` : ''}`)
      else if (ok) api.ui.showToast(`已导入 ${ok} 张到参考图库`)
      else if (failed) api.ui.showToast(`导入失败：${firstError || '请稍后重试'}`)
      await refreshRefLibrary()
    } finally {
      state.refLibrary.busy = false
      notify()
    }
  }

  async function deleteRefLibraryItem(path: string) {
    await deleteRefLibraryItems([path])
  }

  async function deleteRefLibraryItems(paths: string[]) {
    const raw = Array.isArray(paths) ? paths : []
    const uniq: string[] = []
    for (const x of raw) {
      const p = String(x || '').trim()
      if (!p) continue
      if (!uniq.includes(p)) uniq.push(p)
      if (uniq.length >= 5000) break
    }
    if (!uniq.length) return

    let ok = 0
    let failed = 0
    let firstError = ''

    for (const p of uniq) {
      let success = true
      await api.files.images.delete({ scope: 'data', path: p }).catch((e: any) => {
        success = false
        failed++
        if (!firstError) firstError = String(e?.message || e || 'unknown')
      })
      if (success) ok++
    }

    const idx = state.refLibrary.index
    let changed = false
    if (idx?.folderIdsByPath) {
      for (const p of uniq) {
        if (!Object.prototype.hasOwnProperty.call(idx.folderIdsByPath, p)) continue
        delete idx.folderIdsByPath[p]
        changed = true
      }
    }
    if (changed) void saveRefLibraryIndex().catch(() => {})

    const batch = uniq.length > 1
    if (ok && failed) api.ui.showToast(`已删除 ${ok} 张，失败 ${failed} 张${firstError ? `：${firstError}` : ''}`)
    else if (ok && batch) api.ui.showToast(`已删除 ${ok} 张`)
    else if (failed) api.ui.showToast(`删除失败：${firstError || '请稍后重试'}`)

    await refreshRefLibrary()
  }

  async function addRefImageFromLibrary(path: string) {
    const p = String(path || '').trim()
    if (!p) return
    if (state.refImages.length >= MAX_REF_IMAGES) return api.ui.showToast(`参考图最多 ${MAX_REF_IMAGES} 张`)
    const slot = state.refLibrary.itemsByPath[p]
    if (slot && slot.dataUrl) {
      state.refImages = state.refImages.concat([{ id: id('ref'), name: p.split('/').pop() || p, dataUrl: slot.dataUrl }]).slice(0, MAX_REF_IMAGES)
      notify()
      return
    }
    const dataUrl = await api.files.images.read({ scope: 'data', path: p }).catch(() => '')
    const u = normalizeImageDataUrlOrBase64(dataUrl)
    if (!u.startsWith('data:image/')) return api.ui.showToast('图片数据无效')
    state.refLibrary.itemsByPath[p] = { dataUrl: u, loading: false, error: '' }
    state.refImages = state.refImages.concat([{ id: id('ref'), name: p.split('/').pop() || p, dataUrl: u }]).slice(0, MAX_REF_IMAGES)
    notify()
  }

  function clearEditImage() {
    state.edit.baseName = ''
    state.edit.baseDataUrl = ''
    state.edit.baseW = 0
    state.edit.baseH = 0
    state.edit.sel = null
    state.error = ''
    notify()
  }

  function setEditSelection(sel: { x: number; y: number; w: number; h: number } | null) {
    state.edit.sel = sel ? normalizeSelRect(sel) : null
    notify()
  }

  async function pickOutputDir() {
    const picked = await api.files.pickOutputDir().catch((e: any) => {
      api.ui.showToast(`选择目录失败：${String(e?.message || e)}`)
      return null
    })
    if (!picked) return
    state.outputDir = String(picked || '')
    api.ui.showToast('输出目录已更新')
    await refreshImageHistoryFromOutputDir()
  }

  async function openOutputDir() {
    await api.files.openOutputDir().catch((e: any) => api.ui.showToast(`打开目录失败：${String(e?.message || e)}`))
  }

  async function copyImage() {
    if (!state.imageDataUrl) return
    await api.clipboard.writeImage(state.imageDataUrl).then(
      () => api.ui.showToast('已复制图片到剪贴板'),
      (e: any) => api.ui.showToast(`复制失败：${String(e?.message || e)}`),
    )
  }

  async function saveImage() {
    if (!state.imageDataUrl) return
    const rid = await enqueueBackgroundSave(state.imageDataUrl).catch(() => '')
    if (!rid) return api.ui.showToast('保存失败：无法发起后台保存')
    api.ui.showToast('已请求后台保存…')
    const p = await waitBackgroundSaveResponse(rid).catch(() => '')
    if (!p) return
    state.savedPath = p
    await refreshImageHistoryFromOutputDir(state.savedPath)
    notify()
    api.ui.showToast('已保存图片')
  }

  async function deleteCurrentOutputImage() {
    const idx = Number(state.imageHistoryIndex)
    const list = Array.isArray(state.imageHistory) ? state.imageHistory : []
    const item = Number.isFinite(idx) && idx >= 0 ? list[idx] : null
    const path = String(item?.savedPath || '').trim() || String(state.savedPath || '').trim()
    if (!path) {
      api.ui.showToast('暂无可删除的已保存图片')
      return
    }

    // 删除后尽量停留在“邻近”的图片，而不是总是跳到最新。
    let preferPath = ''
    if (item && list.length) {
      const next = idx < list.length - 1 ? String(list[idx + 1]?.savedPath || '') : ''
      const prev = idx > 0 ? String(list[idx - 1]?.savedPath || '') : ''
      preferPath = next || prev
    }

    await api.files.images.delete({ scope: 'output', path }).catch((e: any) => {
      api.ui.showToast(`删除失败：${String(e?.message || e)}`)
      throw e
    })

    if (state.savedPath === path) state.savedPath = ''
    if (state.imageDataUrl && item) {
      // UI 上显示的是从 imageHistory 读取的图片，删除后强制刷新。
      state.imageDataUrl = ''
    }

    await refreshImageHistoryFromOutputDir(preferPath)
    notify()
    api.ui.showToast('已删除')
  }

  async function cancelTask(taskId: string) {
    const tid = String(taskId || '').trim()
    if (!tid) return
    upsertTask({ id: tid, status: 'canceling' })
    notify()
    await api.task.cancel(tid).catch(() => {})
    void pollTasks()
  }

  async function cancelAllTasks() {
    const active = getActiveTasks()
    if (!active.length) return
    for (const t of active) {
      upsertTask({ id: t.id, status: 'canceling' })
    }
    notify()
    await Promise.allSettled(active.map((t) => api.task.cancel(t.id)))
    void pollTasks()
  }

  async function setUiMode(mode: UiMode) {
    if (!state.data) return
    state.data.uiMode = mode
    state.uiMode = mode
    await saveSettings().catch(() => {})
    notify()
  }

  async function savePluginSettings(patch: Partial<Pick<AiDrawSettingsV1, 'autoSave' | 'shrinkRefImages' | 'promptHistoryLimit' | 'requestTimeoutSec'>>) {
    if (!state.data) return
    if (typeof patch.autoSave === 'boolean') state.data.autoSave = patch.autoSave
    if (typeof patch.shrinkRefImages === 'boolean') state.data.shrinkRefImages = patch.shrinkRefImages
    if (patch.promptHistoryLimit != null) state.data.promptHistoryLimit = normalizePromptHistoryLimit(patch.promptHistoryLimit)
    if (patch.requestTimeoutSec != null) state.data.requestTimeoutSec = normalizeRequestTimeoutSec(patch.requestTimeoutSec)
    state.promptHistory = normalizePromptHistory(state.data.promptHistory, state.data.promptHistoryLimit)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    await saveSettings().catch(() => {})
    notify()
  }

  async function clearPromptHistory() {
    state.promptHistory = []
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    syncPromptHistoryToData(true)
    notify()
  }

  async function setActiveProviderId(providerId: string) {
    if (!state.data) return
    const pid = String(providerId || '').trim()
    if (!pid) return
    if (!state.data.providers.some((x) => x.id === pid)) return
    state.data.activeProviderId = pid
    await saveSettings().catch(() => {})
    notify()
  }

  async function addProvider() {
    if (!state.data) return
    const p = defaultProvider()
    state.data.providers.unshift(p)
    state.data.activeProviderId = p.id
    await saveSettings().catch(() => {})
    notify()
  }

  async function deleteProvider(providerId: string) {
    if (!state.data) return
    if (state.data.providers.length <= 1) {
      api.ui.showToast('至少保留一个供应商')
      return
    }
    const pid = String(providerId || '').trim()
    if (!pid) return
    state.data.providers = state.data.providers.filter((x) => x.id !== pid)
    if (!state.data.providers.length) state.data.providers = [defaultProvider()]
    if (!state.data.providers.some((x) => x.id === state.data!.activeProviderId)) {
      state.data.activeProviderId = state.data.providers[0].id
    }
    await saveSettings().catch(() => {})
    notify()
  }

  async function saveProvider(providerId: string, next: Partial<AiDrawProvider> & { modelsText?: string }) {
    if (!state.data) return
    const pid = String(providerId || '').trim()
    if (!pid) return
    const p = state.data.providers.find((x) => x.id === pid)
    if (!p) return

    const patch: any = { ...next }
    if (typeof (next as any).modelsText === 'string') {
      patch.models = parseModelsText((next as any).modelsText)
      delete patch.modelsText
    }

    const merged = { ...p, ...patch }
    const normalized = normalizeSettings({ ...state.data, providers: state.data.providers.map((x) => (x.id === pid ? merged : x)) })
    state.data = normalized
    state.uiMode = normalizeUiMode(state.data.uiMode)
    await saveSettings().catch(() => {})
    notify()
  }

  async function loadPromptLibrary() {
    state.promptLib.loading = true
    notify()
    const raw = await api.storage.get(PROMPT_LIBRARY_KEY).catch(() => null)
    state.promptLib.data = normalizePromptLibrary(raw)
    state.promptLib.loading = false
    await savePromptLibrary().catch(() => {})
    notify()
  }

  function ensurePromptLibraryData() {
    if (!state.promptLib.data) state.promptLib.data = defaultPromptLibrary()
    const d = state.promptLib.data
    if (!Array.isArray(d.folders) || !d.folders.length) state.promptLib.data = defaultPromptLibrary()
    const d2 = state.promptLib.data
    if (!d2.activeFolderId) d2.activeFolderId = d2.folders[0].id
    return d2
  }

  async function setActivePromptFolderId(folderId: string) {
    const d = ensurePromptLibraryData()
    const fid = String(folderId || '').trim()
    if (!fid) return
    if (!d.folders.some((f) => f.id === fid)) return
    d.activeFolderId = fid
    await savePromptLibrary().catch(() => {})
    notify()
  }

  async function addPromptFolder(name?: string) {
    const d = ensurePromptLibraryData()
    const f: PromptLibraryFolder = { id: id('plf'), name: String(name || '').trim() || '收藏夹', prompts: [] }
    d.folders.unshift(f)
    d.activeFolderId = f.id
    await savePromptLibrary().catch(() => {})
    notify()
  }

  async function renamePromptFolder(folderId: string, name: string) {
    const d = ensurePromptLibraryData()
    const fid = String(folderId || '').trim()
    const f = d.folders.find((x) => x.id === fid)
    if (!f) return
    f.name = String(name || '').trim() || '收藏夹'
    await savePromptLibrary().catch(() => {})
    notify()
  }

  async function deletePromptFolder(folderId: string) {
    const d = ensurePromptLibraryData()
    if (d.folders.length <= 1) return api.ui.showToast('至少保留一个收藏夹')
    const fid = String(folderId || '').trim()
    d.folders = d.folders.filter((x) => x.id !== fid)
    if (!d.folders.length) d.folders = defaultPromptLibrary().folders
    if (!d.folders.some((x) => x.id === d.activeFolderId)) d.activeFolderId = d.folders[0].id
    await savePromptLibrary().catch(() => {})
    notify()
  }

  async function addPromptToActiveFolder(text: string) {
    const d = ensurePromptLibraryData()
    const raw = String(text || '').trim()
    if (!raw) return
    const fid = String(d.activeFolderId || '').trim()
    const f = d.folders.find((x) => x.id === fid) || d.folders[0]
    if (!f) return
    const p: PromptLibraryPrompt = { id: id('plp'), text: raw, at: Date.now() }
    f.prompts.unshift(p)
    f.prompts = f.prompts.slice(0, 200)
    await savePromptLibrary().catch(() => {})
    notify()
  }

  async function deletePrompt(folderId: string, promptId: string) {
    const d = ensurePromptLibraryData()
    const fid = String(folderId || '').trim()
    const pid = String(promptId || '').trim()
    const f = d.folders.find((x) => x.id === fid)
    if (!f) return
    f.prompts = f.prompts.filter((p) => p.id !== pid)
    await savePromptLibrary().catch(() => {})
    notify()
  }

  function usePromptText(text: string) {
    const raw = String(text || '')
    state.prompt = raw
    notify()
  }

  async function init() {
    state.loading = true
    notify()

    const saved = await api.storage.get(STORAGE_KEY).catch(() => null)
    state.data = normalizeSettings(saved)
    state.uiMode = normalizeUiMode(state.data.uiMode)
    state.promptHistory = normalizePromptHistory(state.data.promptHistory, state.data.promptHistoryLimit)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    await saveSettings().catch(() => {})

    state.outputDir = await api.files.getOutputDir().catch(() => '')

    state.tasks = []
    const pending = await api.task.list(50).catch(() => [])
    const running = Array.isArray(pending)
      ? pending.filter((t) => !isTaskDone(String((t as any)?.status || '')))
      : []
    for (const t of running) {
      const tid = String((t as any)?.id || '').trim()
      if (!tid) continue
      upsertTask({ id: tid, status: String((t as any).status || '') })
    }

    const savedPendingTaskId = String(state.data.pendingTaskId || '').trim()
    if (savedPendingTaskId && !running.some((t) => String((t as any)?.id || '').trim() === savedPendingTaskId)) {
      state.data.pendingTaskId = ''
      await saveSettings().catch(() => {})
    }

    state.loading = false
    notify()
    await refreshImageHistoryFromOutputDir()
    await loadPromptLibrary().catch(() => {})
    await loadRefLibraryIndex().catch(() => {})
    if (getActiveTasks().length) void pollTasks()
  }

  return {
    getState: () => state,
    getRevision: () => revision,
    subscribe: (fn: Listener) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    init,

    setPrompt: (text: string) => {
      state.prompt = String(text ?? '')
      notify()
    },
    setBatchCount: (text: string) => {
      state.batchCount = String(text ?? '')
      notify()
    },
    switchPromptHistory: (direction: -1 | 1) => {
      if (direction < 0 && !canSwitchPromptPrev()) return
      if (direction > 0 && !canSwitchPromptNext()) return
      switchPromptHistory(direction)
    },

    setUiMode,

    pickRefImages,
    addRefImagesFromFiles,
    removeRefImage: (refId: string) => {
      const rid = String(refId || '').trim()
      if (!rid) return
      state.refImages = state.refImages.filter((x) => x && x.id !== rid)
      notify()
    },
    clearRefImages: () => {
      state.refImages = []
      notify()
    },
    refreshRefLibrary,
    ensureRefLibraryItemLoaded,
    importRefLibraryFromPicker,
    deleteRefLibraryItem,
    deleteRefLibraryItems,
    addRefImageFromLibrary,
    loadRefLibraryIndex,
    setRefLibraryView,
    addRefFolder,
    renameRefFolder,
    deleteRefFolder,
    setRefItemFolderIds,

    pickEditImage,
    clearEditImage,
    setEditSelection,

    generate,
    cancelTask,
    cancelAllTasks,

    refreshImageHistory: refreshImageHistoryFromOutputDir,
    switchImageHistory,
    ensureImageHistoryItemLoaded,

    pickOutputDir,
    openOutputDir,

    copyImage,
    saveImage,
    deleteCurrentOutputImage,

    setActiveProviderId,
    addProvider,
    deleteProvider,
    saveProvider,

    loadPromptLibrary,
    setActivePromptFolderId,
    addPromptFolder,
    renamePromptFolder,
    deletePromptFolder,
    addPromptToActiveFolder,
    deletePrompt,
    usePromptText,

    savePluginSettings,
    clearPromptHistory,

    deletePromptHistoryItem,
    deletePromptHistoryItems,
  }
}
