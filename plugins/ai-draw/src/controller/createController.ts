import type { AiDrawGateway } from '../gateway/types'
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
import { normalizeImageDataUrlOrBase64 } from '../core/images'
import {
  cropDataUrlByPixels,
  loadImageFromDataUrl,
  normalizeSelRect,
  selRectToPixels,
  shrinkRefImageDataUrl,
  compositePatchToBase,
  type PickedImage,
} from '../core/imageCanvas'
import { id, isHttpBaseUrl, normalizeBatchCount, trimSlash } from '../core/utils'
import { formatAiDrawError } from '../core/errorFormat'
import type { AiDrawGenerationDebugRecord, AiDrawGenerationTask } from '../shared/domain'
import {
  normalizeTaskHistory,
  normalizeTaskHistoryLimit,
  normalizeTaskHistoryStatus,
  taskHistorySuccessFromStatus,
  type AiDrawTaskHistoryItem,
} from '../core/taskHistory'

const MAX_BATCH_COUNT = 20
const MAX_REF_IMAGES = 8
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

export type AiDrawDebugRecord = AiDrawGenerationDebugRecord & { status?: string }

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
  taskHistory: AiDrawTaskHistoryItem[]
  promptHistory: string[]
  promptHistoryIndex: number
  promptHistoryDraft: string
  promptLib: { loading: boolean; data: PromptLibraryV1 | null }
  uiMode: UiMode
  edit: AiDrawEditState
  lastDebugRecord: AiDrawDebugRecord | null
}

type Listener = () => void
type SortDropPosition = 'before' | 'after'

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
  moveRefFolder: (folderId: string, targetFolderId: string, position: SortDropPosition) => Promise<void>
  setRefItemFolderIds: (path: string, folderIds: string[]) => Promise<void>
  moveRefLibraryItemInFolder: (folderId: string, path: string, targetPath: string, position: SortDropPosition) => Promise<void>

  pickEditImage: () => Promise<void>
  clearEditImage: () => void
  setEditSelection: (sel: { x: number; y: number; w: number; h: number } | null) => void

  generate: () => Promise<void>
  cancelTask: (taskId: string) => Promise<void>
  cancelAllTasks: () => Promise<void>
  clearTaskHistory: () => Promise<void>

  refreshImageHistory: (preferPath?: string) => Promise<void>
  switchImageHistory: (direction: -1 | 1) => Promise<void>
  ensureImageHistoryItemLoaded: (savedPath: string) => void

  pickOutputDir: () => Promise<void>
  openOutputDir: () => Promise<void>

  copyImage: () => Promise<void>
  saveImage: () => Promise<void>
  deleteCurrentOutputImage: () => Promise<void>
  deleteOutputImages: (paths: string[]) => Promise<void>

  setActiveProviderId: (providerId: string) => Promise<void>
  addProvider: () => Promise<void>
  duplicateProvider: (providerId: string, next?: Partial<AiDrawProvider> & { modelsText?: string }) => Promise<void>
  deleteProvider: (providerId: string) => Promise<void>
  moveProvider: (providerId: string, targetProviderId: string, position: SortDropPosition) => Promise<void>
  saveProvider: (providerId: string, next: Partial<AiDrawProvider> & { modelsText?: string }) => Promise<void>

  loadPromptLibrary: () => Promise<void>
  setActivePromptFolderId: (folderId: string) => Promise<void>
  addPromptFolder: (name?: string) => Promise<void>
  renamePromptFolder: (folderId: string, name: string) => Promise<void>
  deletePromptFolder: (folderId: string) => Promise<void>
  movePromptFolder: (folderId: string, targetFolderId: string, position: SortDropPosition) => Promise<void>
  addPromptToActiveFolder: (text: string) => Promise<void>
  deletePrompt: (folderId: string, promptId: string) => Promise<void>
  movePrompt: (folderId: string, promptId: string, targetPromptId: string, position: SortDropPosition) => Promise<void>
  usePromptText: (text: string) => void

  savePluginSettings: (patch: Partial<Pick<AiDrawSettingsV1, 'autoSave' | 'shrinkRefImages' | 'debugMode' | 'promptHistoryLimit' | 'taskHistoryLimit' | 'requestTimeoutSec'>>) => Promise<void>
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

function moveArrayItemRelative<T>(items: T[], getKey: (item: T) => string, activeKey: string, overKey: string, position: SortDropPosition) {
  if (!activeKey || !overKey || activeKey === overKey) return items
  const fromIndex = items.findIndex((item) => getKey(item) === activeKey)
  const overIndex = items.findIndex((item) => getKey(item) === overKey)
  if (fromIndex < 0 || overIndex < 0) return items
  const next = items.slice()
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) return items
  let insertIndex = next.findIndex((item) => getKey(item) === overKey)
  if (insertIndex < 0) return items
  if (position === 'after') insertIndex += 1
  next.splice(insertIndex, 0, moved)
  return next
}

function activeProvider(data: AiDrawSettingsV1 | null): AiDrawProvider | null {
  if (!data) return null
  const pid = String(data.activeProviderId || '')
  const ps = Array.isArray(data.providers) ? data.providers : []
  return ps.find((p) => p && p.id === pid) || ps[0] || null
}

function createDuplicateProviderName(existingProviders: AiDrawProvider[], sourceName: string) {
  const baseName = String(sourceName || '').trim() || '供应商'
  const names = new Set(existingProviders.map((provider) => String(provider.name || '').trim()).filter(Boolean))
  const firstName = `${baseName} 副本`
  if (!names.has(firstName)) return firstName
  let index = 2
  while (names.has(`${baseName} 副本 ${index}`)) index += 1
  return `${baseName} 副本 ${index}`
}

function getRefItemFolderIdsFromIndex(index: RefLibraryIndexV1, path: string) {
  const raw = index.folderIdsByPath?.[path]
  return Array.isArray(raw) ? raw.map((x) => String(x || '').trim()).filter(Boolean) : []
}

export function createAiDrawController(gateway: AiDrawGateway): AiDrawController {
  const {
    host,
    clipboard,
    settingsStore,
    taskHistoryStore,
    promptLibraryStore,
    referenceLibraryIndexStore,
    outputImages,
    referenceImages,
    generation,
  } = gateway
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

  function activeProviderSnapshot() {
    const provider = activeProvider(state.data)
    return {
      providerId: String(provider?.id || '').trim(),
      providerName: String(provider?.name || '').trim(),
      model: resolveModel(provider),
    }
  }

  async function saveTaskHistory() {
    const limit = state.data?.taskHistoryLimit
    state.taskHistory = normalizeTaskHistory(state.taskHistory, limit)
    await taskHistoryStore.write(state.taskHistory)
  }

  function updateTaskHistoryInMemory(next: AiDrawTaskHistoryItem) {
    const id = String(next.id || '').trim()
    if (!id) return false
    const normalized = normalizeTaskHistory([next], state.data?.taskHistoryLimit)[0]
    if (!normalized) return false
    const list = Array.isArray(state.taskHistory) ? state.taskHistory.slice() : []
    const idx = list.findIndex((item) => String(item?.id || '').trim() === id)
    const prev = idx >= 0 ? list[idx] : null
    const changed = JSON.stringify(prev || null) !== JSON.stringify(normalized)
    if (idx >= 0) list[idx] = normalized
    else list.unshift(normalized)
    state.taskHistory = normalizeTaskHistory(list, state.data?.taskHistoryLimit)
    return changed
  }

  async function upsertTaskHistory(next: AiDrawTaskHistoryItem) {
    const changed = updateTaskHistoryInMemory(next)
    await saveTaskHistory().catch(() => {})
    if (changed) notify()
  }

  async function recordTaskCreationFailure(input: {
    id: string
    prompt: string
    mode: 'normal' | 'local-edit'
    requestAt?: number
    providerId?: string
    providerName?: string
    model?: string
    failureReason: string
  }) {
    const itemId = String(input.id || '').trim()
    if (!itemId) return
    const snap = activeProviderSnapshot()
    await upsertTaskHistory({
      id: itemId,
      taskId: '',
      mode: input.mode,
      requestAt: Number.isFinite(Number(input.requestAt)) ? Number(input.requestAt) : Date.now(),
      updatedAt: Date.now(),
      providerId: String(input.providerId || snap.providerId || '').trim(),
      providerName: String(input.providerName || snap.providerName || '').trim(),
      model: String(input.model || snap.model || '').trim(),
      prompt: String(input.prompt || ''),
      status: 'failed',
      success: false,
      failureReason: String(input.failureReason || '创建后台任务失败'),
    })
  }

  function getTaskHistoryItemByTaskId(taskId: string) {
    const tid = String(taskId || '').trim()
    if (!tid) return null
    return state.taskHistory.find((item) => String(item?.taskId || '').trim() === tid) || null
  }

  async function recordTaskHistoryStart(input: {
    taskId: string
    prompt: string
    mode: 'normal' | 'local-edit'
    requestAt?: number
    providerId?: string
    providerName?: string
    model?: string
  }) {
    const taskId = String(input.taskId || '').trim()
    if (!taskId) return
    const snap = activeProviderSnapshot()
    await upsertTaskHistory({
      id: taskId,
      taskId,
      mode: input.mode,
      requestAt: Number.isFinite(Number(input.requestAt)) ? Number(input.requestAt) : Date.now(),
      updatedAt: Date.now(),
      providerId: String(input.providerId || snap.providerId || '').trim(),
      providerName: String(input.providerName || snap.providerName || '').trim(),
      model: String(input.model || snap.model || '').trim(),
      prompt: String(input.prompt || ''),
      status: 'pending',
      success: null,
      failureReason: '',
    })
  }

  async function recordTaskHistoryStatus(task: any, patch?: { prompt?: string; failureReason?: string }) {
    const taskId = String(task?.id || '').trim()
    if (!taskId) return
    const prev = getTaskHistoryItemByTaskId(taskId)
    const snap = activeProviderSnapshot()
    const status = normalizeTaskHistoryStatus(task?.status)
    const failureReason = typeof patch?.failureReason === 'string' ? patch.failureReason : String(prev?.failureReason || '')
    await upsertTaskHistory({
      id: prev?.id || taskId,
      taskId,
      mode: prev?.mode || 'normal',
      requestAt: Number(prev?.requestAt || Date.now()),
      updatedAt: Date.now(),
      providerId: String(prev?.providerId || snap.providerId || '').trim(),
      providerName: String(prev?.providerName || snap.providerName || '').trim(),
      model: String(prev?.model || snap.model || '').trim(),
      prompt: typeof patch?.prompt === 'string' ? patch.prompt : String(prev?.prompt || ''),
      status,
      success: taskHistorySuccessFromStatus(status),
      failureReason: status === 'failed' ? failureReason : '',
    })
  }

  function updateDebugRecordFromTask(task: any, fallbackStatus?: AiDrawDebugRecord['status']) {
    const taskId = String(task?.id || '').trim()
    if (!taskId || !task?.debug) return
    const taskStatusRaw = String(task?.status || '').trim()
    const nextStatus: AiDrawDebugRecord['status'] =
      taskStatusRaw === 'pending' || taskStatusRaw === 'running' || taskStatusRaw === 'succeeded' || taskStatusRaw === 'failed' || taskStatusRaw === 'canceled' || taskStatusRaw === 'canceling'
        ? taskStatusRaw
        : fallbackStatus || 'unknown'
    state.lastDebugRecord = { ...task.debug,
      status: nextStatus,
    }
    notify()
  }

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
      const job = outputImages.read(p)
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
  let taskPolling = false
  let unsubscribeGeneration: (() => void) | null = null

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
    taskHistory: [],
    promptHistory: [],
    promptHistoryIndex: -1,
    promptHistoryDraft: '',
    promptLib: { loading: false, data: null },
    uiMode: UI_MODE_NORMAL,
    edit: { baseName: '', baseDataUrl: '', baseW: 0, baseH: 0, sel: null },
    lastDebugRecord: null,
  }

  function notify() {
    revision++
    for (const fn of listeners) fn()
  }

  async function saveSettings() {
    if (!state.data) return
    await settingsStore.write(state.data)
  }

  async function saveRefLibraryIndex() {
    const d = state.refLibrary.index
    if (!d) return
    await referenceLibraryIndexStore.write(d).catch((e: any) => {
      host.toast(`参考图库收藏夹保存失败：${String(e?.message || e)}`)
    })
  }

  async function savePromptLibrary() {
    const d = state.promptLib.data
    if (!d) return
    await promptLibraryStore.write(d).catch(() => {})
  }

  async function clearTaskHistory() {
    state.taskHistory = []
    await taskHistoryStore.write([]).catch(() => {})
    notify()
  }

  async function loadRefLibraryIndex() {
    if (state.refLibrary.indexLoading) return
    state.refLibrary.indexLoading = true
    notify()
    try {
      const raw = await referenceLibraryIndexStore.read().catch(() => null)
      const loaded = normalizeRefLibraryIndex(raw)
      const cur = ensureRefLibraryIndexData()

      // 只在“当前内存态为空”时，从磁盘补齐，避免加载晚到覆盖用户刚创建的数据。
      if (!cur.folders.length && loaded.folders.length) cur.folders = loaded.folders
      if (!Object.keys(cur.folderIdsByPath || {}).length && Object.keys(loaded.folderIdsByPath || {}).length) {
        cur.folderIdsByPath = loaded.folderIdsByPath
      }
      if (!Object.keys(cur.folderItemOrderByFolderId || {}).length && Object.keys(loaded.folderItemOrderByFolderId || {}).length) {
        cur.folderItemOrderByFolderId = loaded.folderItemOrderByFolderId
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
    if (!d2.folderItemOrderByFolderId || typeof d2.folderItemOrderByFolderId !== 'object') d2.folderItemOrderByFolderId = {}
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

  function getOrderedRefFolderPaths(d: RefLibraryIndexV1, folderId: string, allPaths?: string[]) {
    const fid = String(folderId || '').trim()
    if (!fid) return []
    const paths = Array.isArray(allPaths) ? allPaths : state.refLibrary.paths
    const members = paths.filter((p) => getRefItemFolderIdsFromIndex(d, p).includes(fid))
    if (!members.length) return []
    const memberSet = new Set(members)
    const rawOrder = Array.isArray(d.folderItemOrderByFolderId?.[fid]) ? d.folderItemOrderByFolderId[fid] : []
    const ordered: string[] = []
    for (const item of rawOrder) {
      const path = String(item || '').trim()
      if (!path || !memberSet.has(path) || ordered.includes(path)) continue
      ordered.push(path)
    }
    for (const path of members) {
      if (!ordered.includes(path)) ordered.push(path)
    }
    return ordered
  }

  function syncRefFolderItemOrder(d: RefLibraryIndexV1, folderId: string, allPaths?: string[]) {
    const fid = String(folderId || '').trim()
    if (!fid) return
    const ordered = getOrderedRefFolderPaths(d, fid, allPaths)
    if (ordered.length) d.folderItemOrderByFolderId[fid] = ordered
    else delete d.folderItemOrderByFolderId[fid]
  }

  function cleanupRefFolderItemOrder(d: RefLibraryIndexV1, allPaths?: string[]) {
    const paths = Array.isArray(allPaths) ? allPaths : state.refLibrary.paths
    const validFolderIds = new Set(d.folders.map((f) => f.id))
    const raw = d.folderItemOrderByFolderId && typeof d.folderItemOrderByFolderId === 'object' ? d.folderItemOrderByFolderId : {}
    const next: Record<string, string[]> = {}
    for (const folderId of Object.keys(raw)) {
      if (!validFolderIds.has(folderId)) continue
      const ordered = getOrderedRefFolderPaths(d, folderId, paths)
      if (ordered.length) next[folderId] = ordered
    }
    d.folderItemOrderByFolderId = next
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
    for (const folderId2 of del) delete d.folderItemOrderByFolderId[folderId2]
    cleanupRefFolderItemOrder(d)

    if (d.activeView.kind === 'folder' && del.has(d.activeView.folderId)) {
      d.activeView = { kind: 'all', folderId: '' }
    }
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function moveRefFolder(folderId: string, targetFolderId: string, position: SortDropPosition) {
    const d = ensureRefLibraryIndexData()
    const fid = String(folderId || '').trim()
    const targetId = String(targetFolderId || '').trim()
    if (!fid || !targetId || fid === targetId) return
    const source = d.folders.find((x) => x.id === fid)
    const target = d.folders.find((x) => x.id === targetId)
    if (!source || !target) return
    if (String(source.parentId || '') !== String(target.parentId || '')) return
    const next = moveArrayItemRelative(d.folders, (item) => item.id, fid, targetId, position)
    if (next === d.folders) return
    d.folders = next
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function setRefItemFolderIds(path: string, folderIds: string[]) {
    const d = ensureRefLibraryIndexData()
    const p = String(path || '').trim()
    if (!p) return
    const prevFolderIds = getRefItemFolderIdsFromIndex(d, p)
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
    const affected = new Set<string>([...prevFolderIds, ...out])
    for (const folderId2 of affected) syncRefFolderItemOrder(d, folderId2)
    notify()
    void saveRefLibraryIndex().catch(() => {})
  }

  async function moveRefLibraryItemInFolder(folderId: string, path: string, targetPath: string, position: SortDropPosition) {
    const d = ensureRefLibraryIndexData()
    const fid = String(folderId || '').trim()
    const activePath = String(path || '').trim()
    const overPath = String(targetPath || '').trim()
    if (!fid || !activePath || !overPath || activePath === overPath) return
    const ordered = getOrderedRefFolderPaths(d, fid)
    const next = moveArrayItemRelative(ordered, (item) => item, activePath, overPath, position)
    if (next === ordered) return
    d.folderItemOrderByFolderId[fid] = next
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

    const loaded = await outputImages.read(state.savedPath).catch(() => '')
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
    const paths = await outputImages.list().catch(() => [])
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

        if (localCtx) {
          localEditContextByTaskId.delete(taskId)
          const patch = String(task?.imageDataUrl || '').trim()
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
            const savedPath = await outputImages.saveBase64(finalDataUrl).catch(() => '')
            if (savedPath) {
              state.savedPath = savedPath
              await refreshImageHistoryFromOutputDir(state.savedPath)
              host.toast('已生成并保存')
            }
            await recordTaskHistoryStatus(task)
          } else {
            host.toast('已生成（已贴回选区）')
            await recordTaskHistoryStatus(task)
          }
          return
        }

        const savedPath = String(task?.savedPath || '').trim()
        const generatedDataUrl = String(task?.imageDataUrl || '').trim()
        if (savedPath) {
          state.savedPath = savedPath
          await refreshImageHistoryFromOutputDir(state.savedPath)
          host.toast('已生成并保存')
          await recordTaskHistoryStatus(task)
          return
        }
        if (!generatedDataUrl) throw new Error('未拿到图片数据（b64_json）')

        state.imageDataUrl = generatedDataUrl
        state.savedPath = ''
        notify()
        host.toast('已生成')
        await recordTaskHistoryStatus(task)
        return
      } catch (e: any) {
        const msg = String(e?.message || e || '生成失败')
        state.error = formatAiDrawError({ hint: '生成失败', stage: '处理任务结果', rawMessage: msg })
        await recordTaskHistoryStatus({ ...task, status: 'failed' }, { failureReason: msg })
        notify()
        host.toast(`生成失败：${msg}`)
        return
      }
    }

    if (status === 'failed') {
      const taskErr = String((task as any)?.error || '').trim()
      const msg = formatAiDrawError({
        hint: '生成失败',
        stage: '后台任务执行',
        taskError: taskErr,
        rawMessage: taskErr || '请求失败',
      })
      state.error = msg
      await recordTaskHistoryStatus(task, { failureReason: String(taskErr || '请求失败') })
      notify()
      host.toast(`生成失败：${String(taskErr || '请求失败')}`)
      return
    }

    if (status === 'canceled' || status === 'canceling') {
      await recordTaskHistoryStatus(task)
    }
  }

  async function pollTasks() {
    if (taskPolling) return
    const active = getActiveTasks()
    if (!active.length) return

    taskPolling = true
    try {
      const infos = await Promise.all(active.map((t) => generation.get(String(t.id || '')).catch(() => null)))
      let changed = false
      for (const info of infos) {
        if (!info) continue
        const tid = String(info.id || '').trim()
        if (!tid) continue
        const st = String(info.status || '')
        if (upsertTask({ id: tid, status: st })) changed = true
        if (isTaskDone(st)) {
          updateDebugRecordFromTask(info)
          await applyTaskCompletion(info)
          removeTask(tid)
          changed = true
        }
      }
      if (changed) notify()
    } finally {
      taskPolling = false
    }
  }

  async function generateNormal() {
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

    try {
      const refImages = []
      const rawRefs = (Array.isArray(state.refImages) ? state.refImages : []).slice(0, MAX_REF_IMAGES)
      for (const image of rawRefs) {
        const dataUrl = String(image?.dataUrl || '').trim()
        if (!dataUrl.startsWith('data:image/')) continue
        const safeUrl = isShrinkRefImagesEnabled()
          ? await shrinkRefImageDataUrl(dataUrl, { maxDimension: REF_SHRINK_MAX_DIMENSION, ifOverBytes: REF_SHRINK_IF_OVER_BYTES }).catch(() => dataUrl)
          : dataUrl
        if (safeUrl.startsWith('data:image/')) refImages.push({ name: String(image?.name || '图片'), dataUrl: safeUrl, sourcePath: String((image as any)?.sourcePath || '') || undefined })
      }
      if (String(p?.protocol || 'images') !== 'chat' && refImages.length) host.toast('已选参考图：自动使用 /images/edits（多图参考）')

      const tasks = await generation.createNormal({
        provider: p,
        prompt,
        refImages,
        batchCount: batch,
        autoSave: !!state.data?.autoSave,
        shrinkRefImages: isShrinkRefImagesEnabled(),
        debugMode: !!state.data?.debugMode,
        requestTimeoutSec: normalizeRequestTimeoutSec(state.data?.requestTimeoutSec ?? DEFAULT_REQUEST_TIMEOUT_SEC),
      })
      const requestAt = Date.now()
      const providerSnapshot = activeProviderSnapshot()
      const ids: string[] = []
      for (const task of tasks) {
        const taskId = String(task?.id || '').trim()
        if (!taskId) {
          continue
        }
        ids.push(taskId)
        upsertTask({ id: taskId, status: String(task.status || 'pending'), prompt, at: task.createdAt || Date.now() })
        await recordTaskHistoryStart({
          taskId,
          prompt,
          mode: 'normal',
          requestAt,
          providerId: providerSnapshot.providerId,
          providerName: providerSnapshot.providerName,
          model: providerSnapshot.model,
        })
      }

      if (!ids.length) throw new Error('创建后台任务失败')
      if (state.data) {
        state.data.pendingTaskId = ids[ids.length - 1]
        await saveSettings().catch(() => {})
      }
      state.submitting = false
      notify()
    } catch (e: any) {
      const providerSnapshot = activeProviderSnapshot()
      await recordTaskCreationFailure({
        id: `submit-failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        prompt,
        mode: 'normal',
        requestAt: Date.now(),
        providerId: providerSnapshot.providerId,
        providerName: providerSnapshot.providerName,
        model: providerSnapshot.model,
        failureReason: String(e?.message || e || '请求失败'),
      })
      state.submitting = false
      state.error = formatAiDrawError({
        hint: '生成失败',
        stage: '创建后台任务',
        rawMessage: String(e?.message || e || '请求失败'),
      })
      notify()
    }
  }

  async function generateLocalEdit() {
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

      const refForSend: Array<{ name: string; dataUrl: string; sourcePath?: string }> = []
      for (const u of refUrls) {
        const safeUrl = isShrinkRefImagesEnabled()
          ? await shrinkRefImageDataUrl(u, { maxDimension: REF_SHRINK_MAX_DIMENSION, ifOverBytes: REF_SHRINK_IF_OVER_BYTES }).catch(() => u)
          : u
        if (String(safeUrl || '').startsWith('data:image/')) refForSend.push({ name: '参考图', dataUrl: safeUrl })
      }

      const created = await generation.createLocalEdit({
        provider: p,
        prompt,
        cropImage: { name: state.edit.baseName || '选区图片', dataUrl: cropForSend, width: selPx.w, height: selPx.h },
        refImages: refForSend,
        autoSave: false,
        shrinkRefImages: isShrinkRefImagesEnabled(),
        debugMode: !!state.data?.debugMode,
        requestTimeoutSec: normalizeRequestTimeoutSec(state.data?.requestTimeoutSec ?? DEFAULT_REQUEST_TIMEOUT_SEC),
      })

      const taskId = String(created && (created as any).id ? (created as any).id : '').trim()
      if (!taskId) throw new Error('创建后台任务失败')

      localEditContextByTaskId.set(taskId, { baseDataUrl: baseUrl, selPx })
      upsertTask({ id: taskId, status: String(created.status || 'pending'), prompt, at: created.createdAt || Date.now() })
      const providerSnapshot = activeProviderSnapshot()
      await recordTaskHistoryStart({
        taskId,
        prompt,
        mode: 'local-edit',
        requestAt: Date.now(),
        providerId: providerSnapshot.providerId,
        providerName: providerSnapshot.providerName,
        model: providerSnapshot.model,
      })
      state.submitting = false
      notify()
    } catch (e: any) {
      const providerSnapshot = activeProviderSnapshot()
      await recordTaskCreationFailure({
        id: `submit-failed-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        prompt,
        mode: 'local-edit',
        requestAt: Date.now(),
        providerId: providerSnapshot.providerId,
        providerName: providerSnapshot.providerName,
        model: providerSnapshot.model,
        failureReason: String(e?.message || e || '请求失败'),
      })
      state.submitting = false
      state.error = formatAiDrawError({
        hint: '生成失败',
        stage: '提交局部任务',
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
      host.toast(`参考图最多 ${MAX_REF_IMAGES} 张`)
      return
    }
    const picked = await referenceImages.pick(remaining).catch((e: any) => {
      host.toast(`选择图片失败：${String(e?.message || e)}`)
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
    if (merged.length < state.refImages.length + out.length) host.toast(`参考图最多 ${MAX_REF_IMAGES} 张`)
    state.refImages = merged
    notify()
  }

  async function addRefImagesFromFiles(files: File[]) {
    const list = Array.isArray(files) ? files : []
    const remaining = MAX_REF_IMAGES - (Array.isArray(state.refImages) ? state.refImages.length : 0)
    if (remaining <= 0) {
      host.toast(`参考图最多 ${MAX_REF_IMAGES} 张`)
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
      host.toast('未识别到图片')
      return
    }

    const merged = state.refImages.concat(out).slice(0, MAX_REF_IMAGES)
    if (merged.length < state.refImages.length + out.length) host.toast(`参考图最多 ${MAX_REF_IMAGES} 张`)
    state.refImages = merged
    notify()
  }

  async function pickEditImage() {
    const picked = await referenceImages.pick(1).catch((e: any) => {
      host.toast(`选择图片失败：${String(e?.message || e)}`)
      return []
    })
    const it = Array.isArray(picked) && picked[0] ? picked[0] : null
    const name = typeof it?.name === 'string' ? it.name : ''
    const raw = typeof (it as any)?.dataUrl === 'string' ? (it as any).dataUrl : typeof (it as any)?.data_url === 'string' ? (it as any).data_url : ''
    const u = normalizeImageDataUrlOrBase64(raw)
    if (!u.startsWith('data:image/')) return host.toast('图片数据无效（需要 data URL 或 base64）')

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
      host.toast(`解析图片失败：${String(e?.message || e)}`)
    }
  }

  async function refreshRefLibrary() {
    if (state.refLibrary.loading) return
    state.refLibrary.loading = true
    notify()
    try {
      const paths = await referenceImages.list().catch(() => [])
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
        const before = JSON.stringify(idx.folderItemOrderByFolderId || {})
        cleanupRefFolderItemOrder(idx, list)
        if (before !== JSON.stringify(idx.folderItemOrderByFolderId || {})) changed = true
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
        const dataUrl = await referenceImages.read(p).catch(() => '')
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
      const picked = await referenceImages.pick(12).catch((e: any) => {
        host.toast(`选择图片失败：${String(e?.message || e)}`)
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
          const savedPath = await referenceImages.saveBase64(u)
          if (savedPath) ok++
          else failed++
        } catch (e: any) {
          failed++
          if (!firstError) firstError = String(e?.message || e || 'unknown')
        }
      }
      if (ok && failed) host.toast(`已导入 ${ok} 张，失败 ${failed} 张${firstError ? `：${firstError}` : ''}`)
      else if (ok) host.toast(`已导入 ${ok} 张到参考图库`)
      else if (failed) host.toast(`导入失败：${firstError || '请稍后重试'}`)
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
      await referenceImages.delete(p).catch((e: any) => {
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
    if (idx) {
      const before = JSON.stringify(idx.folderItemOrderByFolderId || {})
      cleanupRefFolderItemOrder(idx)
      if (before !== JSON.stringify(idx.folderItemOrderByFolderId || {})) changed = true
    }
    if (changed) void saveRefLibraryIndex().catch(() => {})

    const batch = uniq.length > 1
    if (ok && failed) host.toast(`已删除 ${ok} 张，失败 ${failed} 张${firstError ? `：${firstError}` : ''}`)
    else if (ok && batch) host.toast(`已删除 ${ok} 张`)
    else if (failed) host.toast(`删除失败：${firstError || '请稍后重试'}`)

    await refreshRefLibrary()
  }

  function removeRefImagesBySourcePath(path: string) {
    const p = String(path || '').trim()
    if (!p) return false
    const next = state.refImages.filter((x) => String((x as any)?.sourcePath || '').trim() !== p)
    if (next.length === state.refImages.length) return false
    state.refImages = next
    return true
  }

  async function addRefImageFromLibrary(path: string) {
    const p = String(path || '').trim()
    if (!p) return
    if (removeRefImagesBySourcePath(p)) {
      notify()
      return
    }
    if (state.refImages.length >= MAX_REF_IMAGES) return host.toast(`参考图最多 ${MAX_REF_IMAGES} 张`)
    const name = p.split(/[\\/]/).pop() || p
    const slot = state.refLibrary.itemsByPath[p]
    if (slot && slot.dataUrl) {
      state.refImages = state.refImages.concat([{ id: id('ref'), name, dataUrl: slot.dataUrl, sourcePath: p }]).slice(0, MAX_REF_IMAGES)
      notify()
      return
    }
    const dataUrl = await referenceImages.read(p).catch(() => '')
    const u = normalizeImageDataUrlOrBase64(dataUrl)
    if (!u.startsWith('data:image/')) return host.toast('图片数据无效')
    state.refLibrary.itemsByPath[p] = { dataUrl: u, loading: false, error: '' }
    state.refImages = state.refImages.concat([{ id: id('ref'), name, dataUrl: u, sourcePath: p }]).slice(0, MAX_REF_IMAGES)
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
    const picked = await outputImages.pickOutputDir().catch((e: any) => {
      host.toast(`选择目录失败：${String(e?.message || e)}`)
      return null
    })
    if (!picked) return
    state.outputDir = String(picked || '')
    host.toast('输出目录已更新')
    await refreshImageHistoryFromOutputDir()
  }

  async function openOutputDir() {
    await outputImages.openOutputDir().catch((e: any) => host.toast(`打开目录失败：${String(e?.message || e)}`))
  }

  async function copyImage() {
    if (!state.imageDataUrl) return
    await clipboard.writeImage(state.imageDataUrl).then(
      () => host.toast('已复制图片到剪贴板'),
      (e: any) => host.toast(`复制失败：${String(e?.message || e)}`),
    )
  }

  async function saveImage() {
    if (!state.imageDataUrl) return
    const p = await outputImages.saveBase64(state.imageDataUrl).catch((e: any) => {
      host.toast(`保存失败：${String(e?.message || e)}`)
      return ''
    })
    if (!p) return
    state.savedPath = p
    await refreshImageHistoryFromOutputDir(state.savedPath)
    notify()
    host.toast('已保存图片')
  }

  async function deleteCurrentOutputImage() {
    const idx = Number(state.imageHistoryIndex)
    const list = Array.isArray(state.imageHistory) ? state.imageHistory : []
    const item = Number.isFinite(idx) && idx >= 0 ? list[idx] : null
    const path = String(item?.savedPath || '').trim() || String(state.savedPath || '').trim()
    if (!path) {
      host.toast('暂无可删除的已保存图片')
      return
    }

    // 删除后尽量停留在“邻近”的图片，而不是总是跳到最新。
    let preferPath = ''
    if (item && list.length) {
      const next = idx < list.length - 1 ? String(list[idx + 1]?.savedPath || '') : ''
      const prev = idx > 0 ? String(list[idx - 1]?.savedPath || '') : ''
      preferPath = next || prev
    }

    await outputImages.delete(path).catch((e: any) => {
      host.toast(`删除失败：${String(e?.message || e)}`)
      throw e
    })

    if (state.savedPath === path) state.savedPath = ''
    if (state.imageDataUrl && item) {
      // UI 上显示的是从 imageHistory 读取的图片，删除后强制刷新。
      state.imageDataUrl = ''
    }

    await refreshImageHistoryFromOutputDir(preferPath)
    notify()
    host.toast('已删除')
  }

  async function deleteOutputImages(paths: string[]) {
    const raw = Array.isArray(paths) ? paths : []
    const uniq: string[] = []
    for (const x of raw) {
      const p = String(x || '').trim()
      if (!p) continue
      if (!uniq.includes(p)) uniq.push(p)
      if (uniq.length >= 5000) break
    }
    if (!uniq.length) return

    const currentPath = String(state.savedPath || '').trim()
    const currentIndex = Number(state.imageHistoryIndex)
    const currentItem = Number.isFinite(currentIndex) && currentIndex >= 0 ? state.imageHistory[currentIndex] : null
    const currentVisiblePath = String(currentItem?.savedPath || '').trim()
    const deletingCurrent = uniq.includes(currentVisiblePath || currentPath)

    let preferPath = ''
    if (deletingCurrent && currentItem && state.imageHistory.length) {
      for (let i = currentIndex + 1; i < state.imageHistory.length; i++) {
        const p = String(state.imageHistory[i]?.savedPath || '').trim()
        if (p && !uniq.includes(p)) {
          preferPath = p
          break
        }
      }
      if (!preferPath) {
        for (let i = currentIndex - 1; i >= 0; i--) {
          const p = String(state.imageHistory[i]?.savedPath || '').trim()
          if (p && !uniq.includes(p)) {
            preferPath = p
            break
          }
        }
      }
    }

    let ok = 0
    let failed = 0
    let firstError = ''

    for (const p of uniq) {
      let success = true
      await outputImages.delete(p).catch((e: any) => {
        success = false
        failed++
        if (!firstError) firstError = String(e?.message || e || 'unknown')
      })
      if (success) ok++
    }

    if (ok && uniq.includes(currentPath)) state.savedPath = ''
    if (ok && deletingCurrent) state.imageDataUrl = ''

    const batch = uniq.length > 1
    if (ok && failed) host.toast(`已删除 ${ok} 张，失败 ${failed} 张${firstError ? `：${firstError}` : ''}`)
    else if (ok && batch) host.toast(`已删除 ${ok} 张`)
    else if (failed) host.toast(`删除失败：${firstError || '请稍后重试'}`)

    await refreshImageHistoryFromOutputDir(preferPath)
    notify()
  }

  async function cancelTask(taskId: string) {
    const tid = String(taskId || '').trim()
    if (!tid) return
    upsertTask({ id: tid, status: 'canceling' })
    await recordTaskHistoryStatus({ id: tid, status: 'canceling' })
    notify()
    await generation.cancel(tid).catch(() => {})
    void pollTasks()
  }

  async function cancelAllTasks() {
    const active = getActiveTasks()
    if (!active.length) return
    for (const t of active) {
      upsertTask({ id: t.id, status: 'canceling' })
      await recordTaskHistoryStatus({ id: t.id, status: 'canceling' }, { prompt: String(t.prompt || '') })
    }
    notify()
    await Promise.allSettled(active.map((t) => generation.cancel(t.id)))
    void pollTasks()
  }

  async function setUiMode(mode: UiMode) {
    if (!state.data) return
    state.data.uiMode = mode
    state.uiMode = mode
    await saveSettings().catch(() => {})
    notify()
  }

  async function savePluginSettings(patch: Partial<Pick<AiDrawSettingsV1, 'autoSave' | 'shrinkRefImages' | 'debugMode' | 'promptHistoryLimit' | 'taskHistoryLimit' | 'requestTimeoutSec'>>) {
    if (!state.data) return
    if (typeof patch.autoSave === 'boolean') state.data.autoSave = patch.autoSave
    if (typeof patch.shrinkRefImages === 'boolean') state.data.shrinkRefImages = patch.shrinkRefImages
    if (typeof patch.debugMode === 'boolean') state.data.debugMode = patch.debugMode
    if (patch.promptHistoryLimit != null) state.data.promptHistoryLimit = normalizePromptHistoryLimit(patch.promptHistoryLimit)
    if (patch.taskHistoryLimit != null) state.data.taskHistoryLimit = normalizeTaskHistoryLimit(patch.taskHistoryLimit)
    if (patch.requestTimeoutSec != null) state.data.requestTimeoutSec = normalizeRequestTimeoutSec(patch.requestTimeoutSec)
    state.promptHistory = normalizePromptHistory(state.data.promptHistory, state.data.promptHistoryLimit)
    state.taskHistory = normalizeTaskHistory(state.taskHistory, state.data.taskHistoryLimit)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    await saveSettings().catch(() => {})
    await saveTaskHistory().catch(() => {})
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

  async function duplicateProvider(providerId: string, next?: Partial<AiDrawProvider> & { modelsText?: string }) {
    if (!state.data) return
    const pid = String(providerId || '').trim()
    if (!pid) return
    const sourceIndex = state.data.providers.findIndex((x) => x.id === pid)
    if (sourceIndex < 0) return
    const source = state.data.providers[sourceIndex]
    if (!source) return

    const patch: any = { ...(next || {}) }
    if (typeof patch.modelsText === 'string') {
      patch.models = parseModelsText(patch.modelsText)
      delete patch.modelsText
    }

    const duplicate = {
      ...source,
      ...patch,
      id: defaultProvider().id,
      name: createDuplicateProviderName(state.data.providers, String((patch as any).name || source.name || '供应商')),
    }
    const normalizedDuplicate = normalizeSettings({
      ...state.data,
      providers: [duplicate],
      activeProviderId: duplicate.id,
    }).providers[0]
    if (!normalizedDuplicate) return

    const nextProviders = state.data.providers.slice()
    nextProviders.splice(sourceIndex + 1, 0, normalizedDuplicate)
    state.data.providers = nextProviders
    state.data.activeProviderId = normalizedDuplicate.id
    await saveSettings().catch(() => {})
    notify()
  }

  async function deleteProvider(providerId: string) {
    if (!state.data) return
    if (state.data.providers.length <= 1) {
      host.toast('至少保留一个供应商')
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

  async function moveProvider(providerId: string, targetProviderId: string, position: SortDropPosition) {
    if (!state.data) return
    const pid = String(providerId || '').trim()
    const targetId = String(targetProviderId || '').trim()
    if (!pid || !targetId || pid === targetId) return
    const next = moveArrayItemRelative(state.data.providers, (item) => item.id, pid, targetId, position)
    if (next === state.data.providers) return
    state.data.providers = next
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
    const raw = await promptLibraryStore.read().catch(() => null)
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
    if (d.folders.length <= 1) return host.toast('至少保留一个收藏夹')
    const fid = String(folderId || '').trim()
    d.folders = d.folders.filter((x) => x.id !== fid)
    if (!d.folders.length) d.folders = defaultPromptLibrary().folders
    if (!d.folders.some((x) => x.id === d.activeFolderId)) d.activeFolderId = d.folders[0].id
    await savePromptLibrary().catch(() => {})
    notify()
  }

  async function movePromptFolder(folderId: string, targetFolderId: string, position: SortDropPosition) {
    const d = ensurePromptLibraryData()
    const fid = String(folderId || '').trim()
    const targetId = String(targetFolderId || '').trim()
    if (!fid || !targetId || fid === targetId) return
    const next = moveArrayItemRelative(d.folders, (item) => item.id, fid, targetId, position)
    if (next === d.folders) return
    d.folders = next
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

  async function movePrompt(folderId: string, promptId: string, targetPromptId: string, position: SortDropPosition) {
    const d = ensurePromptLibraryData()
    const fid = String(folderId || '').trim()
    const pid = String(promptId || '').trim()
    const targetId = String(targetPromptId || '').trim()
    if (!fid || !pid || !targetId || pid === targetId) return
    const f = d.folders.find((x) => x.id === fid)
    if (!f) return
    const next = moveArrayItemRelative(f.prompts, (item) => item.id, pid, targetId, position)
    if (next === f.prompts) return
    f.prompts = next
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

    const saved = await settingsStore.read().catch(() => null)
    state.data = normalizeSettings(saved)
    const taskHistorySaved = await taskHistoryStore.read().catch(() => null)
    state.taskHistory = normalizeTaskHistory(taskHistorySaved, state.data.taskHistoryLimit)
    state.uiMode = normalizeUiMode(state.data.uiMode)
    state.promptHistory = normalizePromptHistory(state.data.promptHistory, state.data.promptHistoryLimit)
    state.promptHistoryIndex = -1
    state.promptHistoryDraft = ''
    await saveSettings().catch(() => {})

    state.outputDir = await outputImages.getOutputDir().catch(() => '')

    state.tasks = []
    unsubscribeGeneration?.()
    unsubscribeGeneration = generation.subscribe((event) => {
      const task = (event as any)?.task as AiDrawGenerationTask | undefined
      if (!task?.id) return
      upsertTask({ id: task.id, status: task.status, prompt: task.prompt, at: task.createdAt })
      updateDebugRecordFromTask(task)
      if (isTaskDone(task.status)) {
        void applyTaskCompletion(task).finally(() => {
          removeTask(task.id)
          notify()
        })
      } else {
        notify()
      }
    })

    const pending = await generation.list(50).catch(() => [])
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
    moveRefFolder,
    setRefItemFolderIds,
    moveRefLibraryItemInFolder,

    pickEditImage,
    clearEditImage,
    setEditSelection,

    generate,
    cancelTask,
    cancelAllTasks,
    clearTaskHistory,

    refreshImageHistory: refreshImageHistoryFromOutputDir,
    switchImageHistory,
    ensureImageHistoryItemLoaded,

    pickOutputDir,
    openOutputDir,

    copyImage,
    saveImage,
    deleteCurrentOutputImage,
    deleteOutputImages,

    setActiveProviderId,
    addProvider,
    duplicateProvider,
    deleteProvider,
    moveProvider,
    saveProvider,

    loadPromptLibrary,
    setActivePromptFolderId,
    addPromptFolder,
    renamePromptFolder,
    deletePromptFolder,
    movePromptFolder,
    addPromptToActiveFolder,
    deletePrompt,
    movePrompt,
    usePromptText,

    savePluginSettings,
    clearPromptHistory,

    deletePromptHistoryItem,
    deletePromptHistoryItems,
  }
}
