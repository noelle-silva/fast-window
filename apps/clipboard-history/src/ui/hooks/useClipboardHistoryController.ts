import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createClipboardHistoryGateway } from '../../gateway'
import { createHostGateway } from '../../gateway/hostGateway'
import type { ClipboardHistoryGateway, HostGateway } from '../../gateway/types'
import { CLIPBOARD_HISTORY_COMMANDS, normalizeClipboardHistoryCommand } from '../../shared/appCommands'
import { CLIPBOARD_PAGE_SIZE } from '../../shared/constants'
import {
  buildPathIds as domainBuildPathIds,
  canMoveInto as domainCanMoveInto,
  ensureCollections as domainEnsureCollections,
  folderLabelById as domainFolderLabelById,
  getNode as domainGetNode,
  isFolder as domainIsFolder,
  listChildren as domainListChildren,
  searchItems as domainSearchItems,
} from '../../shared/collectionsDomain'
import {
  historyUniqKey as domainHistoryUniqKey,
  isDeleted as domainIsDeleted,
  normalizeDeletedMap as domainNormalizeDeletedMap,
  normalizeHistoryItems as domainNormalizeHistoryItems,
  normalizeSettings as domainNormalizeSettings,
} from '../../shared/historyDomain'
import { isDataUrl, pickImagePath } from '../../shared/imagePaths'
import type {
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardHistorySnapshot,
  ClipboardImageDraft,
  CollectionImageContent,
  CollectionItemContentInput,
  CollectionNode,
  LegacyDataImportReport,
  OrphanImageCleanupReport,
  OrphanImageReport,
} from '../../shared/types'
import {
  createClipboardHistoryUiState,
  type ClipboardHistoryUiState,
  type ClipboardHistoryView,
  type FolderSearchScope,
  type MovePickerAction,
} from '../state'
import { formatError, historyKey, isDeleteArmed, nowMs } from '../clipboardUiUtils'

type PickedDir = { dir: string }
type FwLaunchInfo = { launched?: boolean; standalone?: boolean; mode?: string }
type DataDirStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}
type BootStatus = 'booting' | 'ready' | 'error'
type EditDialogDraft = ClipboardHistoryUiState['editDialog']
type MovePickerDraft = ClipboardHistoryUiState['movePicker']
type PickedImage = { dataUrl: string; mime: string; sourceName?: string }

export type ClipboardHistoryController = {
  state: ClipboardHistoryUiState
  bootStatus: BootStatus
  bootError: string
  dataDirStatus: DataDirStatus | null
  standaloneLaunch: boolean
  host: HostGateway
  isReady: boolean
  setView(view: ClipboardHistoryView): void
  setClipboardSearchQuery(query: string): void
  setClipboardLimit(limit: number): void
  setFolderSearchQuery(query: string): void
  setFolderSearchScope(scope: FolderSearchScope): void
  toggleFolderSearchScope(): void
  setShowSettings(show: boolean): void
  toggleSettings(): void
  setShowRecentMenu(show: boolean): void
  setShowClearHistoryConfirm(show: boolean): void
  openRecentFolder(folderId: string): void
  clearHistory(): Promise<void>
  updateSettings(settings: ClipboardHistorySettings): Promise<void>
  pickDataDir(): Promise<void>
  importLegacyData(): Promise<void>
  scanOrphanImages(): Promise<OrphanImageReport | null>
  deleteOrphanImages(): Promise<OrphanImageCleanupReport | null>
  getNode(id: string): CollectionNode | null
  isFolder(id: string): boolean
  listChildren(folderId: string): CollectionNode[]
  searchItems(query: string, scope: FolderSearchScope): ReturnType<typeof domainSearchItems>
  buildPathIds(folderId: string): string[]
  folderLabelById(folderId: string): string
  canMoveInto(targetFolderId: string, movingId: string): boolean
  navigateFolder(folderId: string): void
  navigateBack(): void
  navigateForward(): void
  createFolder(name: string): Promise<void>
  createItem(): Promise<void>
  updateFolderName(folderId: string, name: string): Promise<void>
  updateItem(itemId: string, title: string, content: CollectionItemContentInput): Promise<void>
  deleteNode(nodeId: string): Promise<void>
  moveNode(movingId: string, toParentId: string, toIndex?: number): Promise<void>
  copyItem(itemId: string, toParentId: string): Promise<void>
  copyFolderItem(itemId: string): Promise<void>
  copyHistoryItem(item: ClipboardHistoryItem): Promise<void>
  deleteHistoryItem(item: ClipboardHistoryItem): Promise<void>
  collectionImageUrl(image: CollectionImageContent): string
  loadCollectionImage(image: CollectionImageContent): Promise<string>
  clipboardImageUrl(item: ClipboardHistoryItem): string
  loadClipboardImage(item: ClipboardHistoryItem): Promise<string>
  toggleClipboardExpanded(key: string): void
  isHistoryExpanded(key: string): boolean
  isDeleteArmed(id: string): boolean
  armDelete(id: string): void
  setDraftFolderName(value: string): void
  setShowFolderEditor(show: boolean): void
  resetFolderDraft(): void
  setDraftTitle(value: string): void
  setDraftContent(value: string): void
  setDraftImage(image: ClipboardImageDraft | null): void
  pasteDraftImage(): Promise<void>
  pickDraftImage(): Promise<void>
  setShowItemEditor(show: boolean): void
  resetItemDraft(): void
  setContextMenu(open: boolean, nodeId?: string, x?: number, y?: number): void
  closeContextMenu(): void
  openEditDialog(nodeId: string): void
  closeDialogs(): void
  setEditDialogDraft(draft: Partial<EditDialogDraft>): void
  pasteEditDialogImage(): Promise<void>
  pickEditDialogImage(): Promise<void>
  saveEditDialog(): Promise<void>
  openMovePicker(movingId: string, action: MovePickerAction): void
  setMovePickerQuery(query: string): void
  pickMoveTarget(toParentId: string): Promise<void>
  saveRecentFolder(folderId: string): void
  setLegacyImportReport(report: LegacyDataImportReport | null): void
}

function applySnapshotToState(prev: ClipboardHistoryUiState, snapshot: ClipboardHistorySnapshot): ClipboardHistoryUiState {
  if (!snapshot || typeof snapshot !== 'object') return prev
  const settings = domainNormalizeSettings(snapshot.settings)
  const deleted = domainNormalizeDeletedMap(snapshot.deleted)
  const history = domainNormalizeHistoryItems(snapshot.history, settings.maxHistory).filter((it) => !domainIsDeleted(it, deleted))
  const collections = domainEnsureCollections(snapshot.collections)
  const currentFolderId = prev.currentFolderId && domainIsFolder(collections, prev.currentFolderId)
    ? prev.currentFolderId
    : collections.rootId || 'root'
  const recentFolders = Array.isArray(snapshot.recentFolders)
    ? snapshot.recentFolders.filter((x) => typeof x === 'string')
    : []

  return {
    ...prev,
    settings,
    deleted,
    history,
    collections,
    currentFolderId,
    recentFolders,
  }
}

function pruneImageStateForKey(prev: ClipboardHistoryUiState, key: string): ClipboardHistoryUiState {
  const clipboardExpanded = { ...prev.clipboardExpanded }
  const clipboardImageCache = { ...prev.clipboardImageCache }
  const clipboardImageLoading = { ...prev.clipboardImageLoading }
  delete clipboardExpanded[key]
  delete clipboardImageCache[key]
  delete clipboardImageLoading[key]
  return { ...prev, clipboardExpanded, clipboardImageCache, clipboardImageLoading }
}

function collectionImageCacheKey(image: CollectionImageContent): string {
  return `collection:${image.reference || image.path}`
}

function createTextContent(text: string): CollectionItemContentInput {
  return { type: 'text', text }
}

function createImageContent(image: ClipboardImageDraft): CollectionItemContentInput {
  return {
    type: 'image',
    dataUrl: image.dataUrl,
    reference: image.reference,
    path: image.path,
    mime: image.mime,
    width: image.width,
    height: image.height,
    sourceName: image.sourceName,
  }
}

function imageDraftFromCollection(image: CollectionImageContent): ClipboardImageDraft {
  return {
    reference: image.reference,
    path: image.path,
    mime: image.mime,
    width: image.width,
    height: image.height,
    sourceName: image.sourceName,
  }
}

async function pickedImageToDraft(picked: PickedImage): Promise<ClipboardImageDraft> {
  const dimensions = await readImageDimensions(picked.dataUrl)
  return {
    dataUrl: picked.dataUrl,
    mime: picked.mime || 'image/png',
    width: dimensions.width,
    height: dimensions.height,
    sourceName: picked.sourceName || '图片',
  }
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('图片尺寸读取失败'))
    img.src = src
  })
}

export function useClipboardHistoryController(): ClipboardHistoryController {
  const [state, setState] = React.useState<ClipboardHistoryUiState>(() => createClipboardHistoryUiState())
  const [bootStatus, setBootStatus] = React.useState<BootStatus>('booting')
  const [bootError, setBootError] = React.useState('')
  const [dataDirStatus, setDataDirStatus] = React.useState<DataDirStatus | null>(null)
  const [standaloneLaunch, setStandaloneLaunch] = React.useState(true)
  const hostRef = React.useRef<HostGateway | null>(null)
  const gatewayRef = React.useRef<ClipboardHistoryGateway | null>(null)
  const snapshotUnsubscribeRef = React.useRef<(() => void) | null>(null)
  const pendingLaunchCommandRef = React.useRef<string | null>(null)
  const stateRef = React.useRef(state)

  stateRef.current = state
  if (!hostRef.current) hostRef.current = createHostGateway()

  const host = hostRef.current
  const isReady = bootStatus === 'ready' && !!gatewayRef.current

  const patchState = React.useCallback((patch: Partial<ClipboardHistoryUiState>) => {
    setState(prev => ({ ...prev, ...patch }))
  }, [])

  const applySnapshot = React.useCallback((snapshot: ClipboardHistorySnapshot) => {
    setState(prev => applySnapshotToState(prev, snapshot))
  }, [])

  const refreshDataDirStatus = React.useCallback(async () => {
    const status = await invoke<DataDirStatus>('data_dir_status').catch(error => ({
      dataDir: '',
      defaultDataDir: '',
      configuredDataDir: null,
      writable: false,
      error: formatError(error, '读取数据目录状态失败'),
    }))
    setDataDirStatus(status)
    return status
  }, [])

  const closeGateway = React.useCallback(() => {
    snapshotUnsubscribeRef.current?.()
    snapshotUnsubscribeRef.current = null
    gatewayRef.current?.close()
    gatewayRef.current = null
  }, [])

  const connectGateway = React.useCallback(async () => {
    closeGateway()
    const gateway = await createClipboardHistoryGateway(async () => {
      const endpoint = await invoke('backend_endpoint').catch(() => null)
      if (!endpoint) throw new Error('剪贴板历史后台未就绪')
      return endpoint
    })
    gatewayRef.current = gateway
    snapshotUnsubscribeRef.current = gateway.onSnapshot((snapshot) => applySnapshot(snapshot))
    return gateway
  }, [applySnapshot, closeGateway])

  const getNode = React.useCallback((id: string) => domainGetNode(stateRef.current.collections, id), [])
  const isFolder = React.useCallback((id: string) => domainIsFolder(stateRef.current.collections, id), [])
  const listChildren = React.useCallback((folderId: string) => domainListChildren(stateRef.current.collections, folderId), [])
  const searchItems = React.useCallback((query: string, scope: FolderSearchScope) => {
    return domainSearchItems(stateRef.current.collections, query, scope, stateRef.current.currentFolderId)
  }, [])
  const buildPathIds = React.useCallback((folderId: string) => domainBuildPathIds(stateRef.current.collections, folderId), [])
  const folderLabelById = React.useCallback((folderId: string) => domainFolderLabelById(stateRef.current.collections, folderId), [])
  const canMoveInto = React.useCallback((targetFolderId: string, movingId: string) => {
    return domainCanMoveInto(stateRef.current.collections, targetFolderId, movingId)
  }, [])

  const saveRecentFolder = React.useCallback((folderId: string) => {
    if (!folderId || !isFolder(folderId)) return
    setState(prev => ({
      ...prev,
      recentFolders: [folderId, ...prev.recentFolders.filter((id) => id !== folderId)].slice(0, 10),
    }))
    void gatewayRef.current?.collections.saveRecentFolder(folderId)
      .then(applySnapshot)
      .catch(() => {})
  }, [applySnapshot, isFolder])

  const openFolder = React.useCallback((folderId: string) => {
    if (!folderId || !isFolder(folderId)) return
    setState(prev => ({ ...prev, currentFolderId: folderId }))
    saveRecentFolder(folderId)
  }, [isFolder, saveRecentFolder])

  const navigateFolder = React.useCallback((folderId: string) => {
    if (!folderId || !isFolder(folderId)) return
    const current = stateRef.current.currentFolderId
    if (folderId === current) return
    setState(prev => ({
      ...prev,
      navBack: [...prev.navBack, prev.currentFolderId].slice(-50),
      navForward: [],
      currentFolderId: folderId,
    }))
    saveRecentFolder(folderId)
  }, [isFolder, saveRecentFolder])

  const navigateBack = React.useCallback(() => {
    const prevId = stateRef.current.navBack[stateRef.current.navBack.length - 1]
    if (!prevId || !isFolder(prevId)) return
    setState(prev => ({
      ...prev,
      navBack: prev.navBack.slice(0, -1),
      navForward: [prev.currentFolderId, ...prev.navForward].slice(0, 50),
      currentFolderId: prevId,
    }))
    saveRecentFolder(prevId)
  }, [isFolder, saveRecentFolder])

  const navigateForward = React.useCallback(() => {
    const nextId = stateRef.current.navForward[0]
    if (!nextId || !isFolder(nextId)) return
    setState(prev => ({
      ...prev,
      navForward: prev.navForward.slice(1),
      navBack: [...prev.navBack, prev.currentFolderId].slice(-50),
      currentFolderId: nextId,
    }))
    saveRecentFolder(nextId)
  }, [isFolder, saveRecentFolder])

  const handleRuntimeCommand = React.useCallback((raw: unknown) => {
    const rawCommand = String(raw || '').trim()
    if (!rawCommand) return

    const command = normalizeClipboardHistoryCommand(rawCommand)
    if (!command) {
      void host.toast(`未知命令：${rawCommand}`)
      return
    }

    if (!gatewayRef.current) {
      pendingLaunchCommandRef.current = command
      return
    }

    pendingLaunchCommandRef.current = null
    if (command === CLIPBOARD_HISTORY_COMMANDS.folders) {
      setState(prev => ({ ...prev, view: 'folders' }))
      return
    }
  }, [host])

  React.useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    async function init() {
      pendingLaunchCommandRef.current = await invoke<string | null>('fw_initial_command').catch(() => null)
      const launchInfo = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => null)
      if (!cancelled) setStandaloneLaunch(launchInfo?.standalone !== false)

      unlisten = await listen<{ command?: string }>('fw-app-command', event => {
        handleRuntimeCommand(event.payload?.command)
      })

      await invoke('app_ready').catch(() => {})
      await refreshDataDirStatus()

      try {
        const gateway = await connectGateway()
        const snapshot = await gateway.state.load()
        if (cancelled) return
        applySnapshot(snapshot)
        setBootStatus('ready')
        setBootError('')
      } catch (error) {
        if (cancelled) return
        setBootStatus('error')
        setBootError(formatError(error, '剪贴板历史启动失败'))
        await refreshDataDirStatus()
      }

      if (!cancelled && pendingLaunchCommandRef.current) {
        const command = pendingLaunchCommandRef.current
        pendingLaunchCommandRef.current = null
        handleRuntimeCommand(command)
      }
    }

    void init()

    return () => {
      cancelled = true
      unlisten?.()
      closeGateway()
    }
  }, [applySnapshot, closeGateway, connectGateway, handleRuntimeCommand, refreshDataDirStatus])

  const setView = React.useCallback((view: ClipboardHistoryView) => {
    setState(prev => ({
      ...prev,
      view,
      showSettings: false,
      showRecentMenu: false,
      showClearHistoryConfirm: false,
      clipboardLimit: view === 'clipboard' ? CLIPBOARD_PAGE_SIZE : prev.clipboardLimit,
    }))
  }, [])

  const setClipboardSearchQuery = React.useCallback((query: string) => {
    setState(prev => ({ ...prev, clipboardSearchQuery: query, clipboardLimit: CLIPBOARD_PAGE_SIZE }))
  }, [])
  const setClipboardLimit = React.useCallback((limit: number) => {
    setState(prev => ({ ...prev, clipboardLimit: Math.max(1, Math.floor(Number(limit) || CLIPBOARD_PAGE_SIZE)) }))
  }, [])

  const setFolderSearchQuery = React.useCallback((query: string) => patchState({ folderSearchQuery: query }), [patchState])
  const setFolderSearchScope = React.useCallback((scope: FolderSearchScope) => patchState({ folderSearchScope: scope }), [patchState])
  const toggleFolderSearchScope = React.useCallback(() => {
    setState(prev => ({ ...prev, folderSearchScope: prev.folderSearchScope === 'global' ? 'current' : 'global' }))
  }, [])
  const setShowSettings = React.useCallback((show: boolean) => {
    setState(prev => ({ ...prev, showSettings: show, showClearHistoryConfirm: show ? prev.showClearHistoryConfirm : false }))
  }, [])
  const toggleSettings = React.useCallback(() => {
    setState(prev => ({ ...prev, showSettings: !prev.showSettings, showClearHistoryConfirm: false }))
  }, [])
  const setShowRecentMenu = React.useCallback((show: boolean) => patchState({ showRecentMenu: show }), [patchState])
  const setShowClearHistoryConfirm = React.useCallback((show: boolean) => {
    setState(prev => ({ ...prev, showClearHistoryConfirm: show, showSettings: show ? true : prev.showSettings }))
  }, [])

  const openRecentFolder = React.useCallback((folderId: string) => {
    setState(prev => ({ ...prev, view: 'folders', showRecentMenu: false }))
    openFolder(folderId)
  }, [openFolder])

  const clearHistory = React.useCallback(async () => {
    const gateway = gatewayRef.current
    if (!gateway) return
    const snapshot = await gateway.state.clearHistory()
    setState(prev => applySnapshotToState({
      ...prev,
      showClearHistoryConfirm: false,
      clipboardExpanded: {},
      clipboardImageCache: {},
      clipboardImageLoading: {},
      clipboardLimit: CLIPBOARD_PAGE_SIZE,
    }, snapshot))
    void host.toast('已清空')
  }, [host])

  const updateSettings = React.useCallback(async (settings: ClipboardHistorySettings) => {
    const gateway = gatewayRef.current
    if (!gateway) return
    const normalized = domainNormalizeSettings(settings)
    const snapshot = await gateway.state.saveSettings(normalized)
    applySnapshot(snapshot)
  }, [applySnapshot])

  const pickDataDir = React.useCallback(async () => {
    try {
      const picked = await invoke<DataDirStatus | null>('pick_data_dir')
      if (!picked) return
      setDataDirStatus(picked)
      const gateway = await connectGateway()
      applySnapshot(await gateway.state.load())
      setBootStatus('ready')
      setBootError('')
      void host.toast('数据目录已更新')
    } catch (error) {
      await refreshDataDirStatus()
      void host.toast(formatError(error, '选择数据目录失败'))
    }
  }, [applySnapshot, connectGateway, host, refreshDataDirStatus])

  const importLegacyData = React.useCallback(async () => {
    const gateway = gatewayRef.current
    if (!gateway) return
    try {
      const picked = await invoke<PickedDir | null>('pick_legacy_data_dir')
      if (!picked?.dir) return
      const confirmed = window.confirm([
        '即将导入旧剪贴板历史数据。',
        '',
        `旧数据目录：${picked.dir}`,
        '导入会覆盖当前历史、设置和收藏夹，导入前会先备份当前数据。',
        '确认继续吗？',
      ].join('\n'))
      if (!confirmed) return
      const result = await gateway.legacy.importData(picked.dir)
      setState(prev => applySnapshotToState({ ...prev, legacyImportReport: result.report }, result.snapshot))
      void host.toast(`已导入 ${result.report.historyCount} 条历史，复制 ${result.report.copiedImages} 张图片`)
    } catch (error) {
      void host.toast(formatError(error, '导入旧数据失败'))
    }
  }, [host])

  const scanOrphanImages = React.useCallback(async (): Promise<OrphanImageReport | null> => {
    const gateway = gatewayRef.current
    if (!gateway) return null
    try {
      const report = await gateway.images.scanOrphanImages()
      void host.toast(report.orphanCount ? `发现 ${report.orphanCount} 张孤立图片` : '未发现孤立图片')
      return report
    } catch (error) {
      void host.toast(formatError(error, '检测孤立图片失败'))
      return null
    }
  }, [host])

  const deleteOrphanImages = React.useCallback(async (): Promise<OrphanImageCleanupReport | null> => {
    const gateway = gatewayRef.current
    if (!gateway) return null
    try {
      const report = await gateway.images.deleteOrphanImages()
      void host.toast(report.deletedCount ? `已删除 ${report.deletedCount} 张孤立图片` : '没有可删除的孤立图片')
      return report
    } catch (error) {
      void host.toast(formatError(error, '删除孤立图片失败'))
      return null
    }
  }, [host])

  const runCollectionMutation = React.useCallback(async (operation: (gateway: ClipboardHistoryGateway) => Promise<ClipboardHistorySnapshot>) => {
    const gateway = gatewayRef.current
    if (!gateway) return
    applySnapshot(await operation(gateway))
  }, [applySnapshot])

  const createFolder = React.useCallback(async (name: string) => {
    await runCollectionMutation(gateway => gateway.collections.createFolder(stateRef.current.currentFolderId, name))
    setState(prev => ({ ...prev, showFolderEditor: false, draftFolderName: '' }))
    void host.toast('已创建收藏夹')
  }, [host, runCollectionMutation])

  const createItem = React.useCallback(async () => {
    const { draftTitle, draftContent, draftImage } = stateRef.current
    const content = draftImage ? createImageContent(draftImage) : createTextContent(draftContent)
    if (!draftImage && !draftContent.trim()) {
      void host.toast('正文内容不能为空')
      return
    }
    await runCollectionMutation(gateway => gateway.collections.createItem(stateRef.current.currentFolderId, draftTitle, content))
    setState(prev => ({ ...prev, showItemEditor: false, draftTitle: '', draftContent: '', draftImage: null }))
    void host.toast(draftImage ? '已添加图片条目' : '已添加条目')
  }, [host, runCollectionMutation])

  const updateFolderName = React.useCallback(async (folderId: string, name: string) => {
    await runCollectionMutation(gateway => gateway.collections.updateFolder(folderId, name))
  }, [runCollectionMutation])

  const updateItem = React.useCallback(async (itemId: string, title: string, content: CollectionItemContentInput) => {
    await runCollectionMutation(gateway => gateway.collections.updateItem(itemId, title, content))
  }, [runCollectionMutation])

  const moveNode = React.useCallback(async (movingId: string, toParentId: string, toIndex?: number) => {
    await runCollectionMutation(gateway => gateway.collections.moveNode(movingId, toParentId, toIndex))
  }, [runCollectionMutation])

  const copyItem = React.useCallback(async (itemId: string, toParentId: string) => {
    await runCollectionMutation(gateway => gateway.collections.copyItem(itemId, toParentId))
  }, [runCollectionMutation])

  const deleteNode = React.useCallback(async (nodeId: string) => {
    const n = getNode(nodeId)
    if (!n) return
    if (!isDeleteArmed(stateRef.current.deleteArmedId, stateRef.current.deleteArmedAt, nodeId)) {
      setState(prev => ({ ...prev, deleteArmedId: nodeId, deleteArmedAt: nowMs() }))
      void host.toast('再点一次删除')
      return
    }
    await runCollectionMutation(gateway => gateway.collections.deleteNode(nodeId))
    setState(prev => ({ ...prev, deleteArmedId: '', deleteArmedAt: 0 }))
    void host.toast('已删除')
  }, [getNode, host, runCollectionMutation])

  const copyFolderItem = React.useCallback(async (itemId: string) => {
    const gateway = gatewayRef.current
    const it = getNode(itemId)
    if (!gateway || !it || it.type !== 'item') return
    try {
      const snapshot = it.content.type === 'image'
        ? await gateway.clipboard.writeImage({ path: it.content.reference || it.content.path })
        : await gateway.clipboard.writeText(it.content.text)
      applySnapshot(snapshot)
      void host.toast('复制成功')
    } catch (error) {
      void host.toast(formatError(error, '复制失败'))
    }
  }, [applySnapshot, getNode, host])

  const collectionImageUrl = React.useCallback((image: CollectionImageContent): string => {
    const reference = image.reference || image.path
    return reference ? gatewayRef.current?.images.outputImageUrl(reference, image.reference || image.path) || '' : ''
  }, [])

  const loadCollectionImage = React.useCallback(async (image: CollectionImageContent): Promise<string> => {
    const key = collectionImageCacheKey(image)
    if (stateRef.current.clipboardImageCache[key]) return stateRef.current.clipboardImageCache[key]
    const gateway = gatewayRef.current
    if (!gateway) throw new Error('正在连接后台')
    const reference = image.reference || image.path
    if (!reference) throw new Error('图片不可用')
    const dataUrl = String(await gateway.images.readOutputImage(reference) || '')
    if (!dataUrl) throw new Error('图片不可用')
    setState(prev => ({ ...prev, clipboardImageCache: { ...prev.clipboardImageCache, [key]: dataUrl } }))
    return dataUrl
  }, [])

  const loadClipboardImage = React.useCallback(async (item: ClipboardHistoryItem): Promise<string> => {
    const key = historyKey(item)
    if (stateRef.current.clipboardImageCache[key]) return stateRef.current.clipboardImageCache[key]
    if (isDataUrl(item.content)) {
      setState(prev => ({ ...prev, clipboardImageCache: { ...prev.clipboardImageCache, [key]: item.content } }))
      return item.content
    }
    const gateway = gatewayRef.current
    if (!gateway) throw new Error('正在连接后台')
    const path = pickImagePath(item)
    if (!path) throw new Error('图片不可用')
    setState(prev => ({ ...prev, clipboardImageLoading: { ...prev.clipboardImageLoading, [key]: true } }))
    try {
      const dataUrl = String(await gateway.images.readOutputImage(path) || '')
      if (!dataUrl) throw new Error('图片不可用')
      setState(prev => ({
        ...prev,
        clipboardImageCache: { ...prev.clipboardImageCache, [key]: dataUrl },
        clipboardImageLoading: { ...prev.clipboardImageLoading, [key]: false },
      }))
      return dataUrl
    } catch (error) {
      setState(prev => ({ ...prev, clipboardImageLoading: { ...prev.clipboardImageLoading, [key]: false } }))
      throw error
    }
  }, [])

  const clipboardImageUrl = React.useCallback((item: ClipboardHistoryItem): string => {
    if (isDataUrl(item.content)) return item.content
    const reference = pickImagePath(item)
    return reference ? gatewayRef.current?.images.outputImageUrl(reference, item.time) || '' : ''
  }, [])

  const copyHistoryItem = React.useCallback(async (item: ClipboardHistoryItem) => {
    const gateway = gatewayRef.current
    if (!gateway) return
    try {
      const snapshot = item.type === 'image'
        ? await gateway.clipboard.writeImage(await loadClipboardImage(item))
        : item.type === 'files'
          ? await gateway.clipboard.writeFiles((item.files || []).map(file => file.path).filter(Boolean))
          : await gateway.clipboard.writeText(item.content)
      applySnapshot(snapshot)
      void host.toast('复制成功')
    } catch (error) {
      void host.toast(formatError(error, '复制失败'))
    }
  }, [applySnapshot, host, loadClipboardImage])

  const deleteHistoryItem = React.useCallback(async (item: ClipboardHistoryItem) => {
    const gateway = gatewayRef.current
    if (!gateway) return
    const key = historyKey(item)
    if (!isDeleteArmed(stateRef.current.deleteArmedId, stateRef.current.deleteArmedAt, key)) {
      setState(prev => ({ ...prev, deleteArmedId: key, deleteArmedAt: nowMs() }))
      void host.toast('再点一次删除')
      return
    }
    const snapshot = await gateway.state.deleteHistoryItem(item)
    setState(prev => applySnapshotToState(pruneImageStateForKey({ ...prev, deleteArmedId: '', deleteArmedAt: 0 }, key), snapshot))
    void host.toast('已删除')
  }, [host])

  const toggleClipboardExpanded = React.useCallback((key: string) => {
    setState(prev => {
      const clipboardExpanded = { ...prev.clipboardExpanded }
      if (clipboardExpanded[key]) delete clipboardExpanded[key]
      else clipboardExpanded[key] = true
      return { ...prev, clipboardExpanded }
    })
  }, [])

  const isHistoryExpanded = React.useCallback((key: string) => !!stateRef.current.clipboardExpanded[key], [])
  const controllerIsDeleteArmed = React.useCallback((id: string) => {
    return isDeleteArmed(stateRef.current.deleteArmedId, stateRef.current.deleteArmedAt, id)
  }, [])
  const armDelete = React.useCallback((id: string) => {
    setState(prev => ({ ...prev, deleteArmedId: id, deleteArmedAt: nowMs() }))
    window.setTimeout(() => {
      setState(prev => controllerIsDeleteArmed(id) ? { ...prev, deleteArmedId: '', deleteArmedAt: 0 } : prev)
    }, 2600)
  }, [controllerIsDeleteArmed])

  const setDraftFolderName = React.useCallback((value: string) => patchState({ draftFolderName: value }), [patchState])
  const setShowFolderEditor = React.useCallback((show: boolean) => {
    setState(prev => ({
      ...prev,
      showFolderEditor: show,
      showItemEditor: show ? false : prev.showItemEditor,
      draftTitle: show ? '' : prev.draftTitle,
      draftContent: show ? '' : prev.draftContent,
      draftImage: show ? null : prev.draftImage,
      draftFolderName: show ? prev.draftFolderName : '',
    }))
  }, [])
  const resetFolderDraft = React.useCallback(() => patchState({ showFolderEditor: false, draftFolderName: '' }), [patchState])
  const setDraftTitle = React.useCallback((value: string) => patchState({ draftTitle: value }), [patchState])
  const setDraftContent = React.useCallback((value: string) => patchState({ draftContent: value }), [patchState])
  const setDraftImage = React.useCallback((image: ClipboardImageDraft | null) => patchState({ draftImage: image }), [patchState])
  const pasteDraftImage = React.useCallback(async () => {
    const gateway = gatewayRef.current
    if (!gateway) return
    try {
      const image = await gateway.images.readClipboardImage()
      setState(prev => ({ ...prev, draftImage: image, draftContent: '' }))
      void host.toast('已读取剪贴板图片')
    } catch (error) {
      void host.toast(formatError(error, '读取剪贴板图片失败'))
    }
  }, [host])
  const pickDraftImage = React.useCallback(async () => {
    try {
      const picked = await invoke<PickedImage | null>('pick_image_file')
      if (!picked?.dataUrl) return
      const image = await pickedImageToDraft(picked)
      setState(prev => ({
        ...prev,
        draftImage: image,
        draftContent: '',
      }))
    } catch (error) {
      void host.toast(formatError(error, '选择图片失败'))
    }
  }, [host])
  const setShowItemEditor = React.useCallback((show: boolean) => {
    setState(prev => ({
      ...prev,
      showItemEditor: show,
      showFolderEditor: show ? false : prev.showFolderEditor,
      draftFolderName: show ? '' : prev.draftFolderName,
      draftTitle: show ? prev.draftTitle : '',
      draftContent: show ? prev.draftContent : '',
      draftImage: show ? prev.draftImage : null,
    }))
  }, [])
  const resetItemDraft = React.useCallback(() => patchState({ showItemEditor: false, draftTitle: '', draftContent: '', draftImage: null }), [patchState])

  const setContextMenu = React.useCallback((open: boolean, nodeId = '', x = 0, y = 0) => {
    patchState({ ctxMenu: { open, nodeId, x, y }, showRecentMenu: false })
  }, [patchState])
  const closeContextMenu = React.useCallback(() => {
    setState(prev => ({ ...prev, ctxMenu: { open: false, x: 0, y: 0, nodeId: '' } }))
  }, [])

  const closeDialogs = React.useCallback(() => patchState({
    ctxMenu: { open: false, x: 0, y: 0, nodeId: '' },
    movePicker: { open: false, movingId: '', query: '', action: 'move' },
    editDialog: { open: false, nodeId: '', folderName: '', itemTitle: '', itemContent: '', itemImage: null },
  }), [patchState])

  const openEditDialog = React.useCallback((nodeId: string) => {
    const n = getNode(nodeId)
    if (!n || (n.type !== 'folder' && n.type !== 'item')) return
    patchState({
      ctxMenu: { open: false, x: 0, y: 0, nodeId: '' },
      editDialog: {
        open: true,
        nodeId,
        folderName: n.type === 'folder' ? String(n.name || '') : '',
        itemTitle: n.type === 'item' ? String(n.title || '') : '',
        itemContent: n.type === 'item' && n.content.type === 'text' ? n.content.text : '',
        itemImage: n.type === 'item' && n.content.type === 'image' ? imageDraftFromCollection(n.content) : null,
      },
    })
  }, [getNode, patchState])

  const setEditDialogDraft = React.useCallback((draft: Partial<EditDialogDraft>) => {
    setState(prev => ({ ...prev, editDialog: { ...prev.editDialog, ...draft } }))
  }, [])

  const pasteEditDialogImage = React.useCallback(async () => {
    const gateway = gatewayRef.current
    if (!gateway) return
    try {
      const image = await gateway.images.readClipboardImage()
      setState(prev => ({ ...prev, editDialog: { ...prev.editDialog, itemImage: image, itemContent: '' } }))
      void host.toast('已读取剪贴板图片')
    } catch (error) {
      void host.toast(formatError(error, '读取剪贴板图片失败'))
    }
  }, [host])

  const pickEditDialogImage = React.useCallback(async () => {
    try {
      const picked = await invoke<PickedImage | null>('pick_image_file')
      if (!picked?.dataUrl) return
      const image = await pickedImageToDraft(picked)
      setState(prev => ({ ...prev, editDialog: { ...prev.editDialog, itemImage: image, itemContent: '' } }))
    } catch (error) {
      void host.toast(formatError(error, '选择图片失败'))
    }
  }, [host])

  const saveEditDialog = React.useCallback(async () => {
    const dialog = stateRef.current.editDialog
    const n = getNode(dialog.nodeId)
    if (!n || (n.type !== 'folder' && n.type !== 'item')) {
      closeDialogs()
      return
    }
    if (n.type === 'item' && !dialog.itemImage && !dialog.itemContent.trim()) {
      void host.toast('正文内容不能为空')
      return
    }
    if (n.type === 'folder') await updateFolderName(dialog.nodeId, dialog.folderName)
    else await updateItem(dialog.nodeId, dialog.itemTitle, dialog.itemImage ? createImageContent(dialog.itemImage) : createTextContent(dialog.itemContent))
    void host.toast('已保存')
    closeDialogs()
  }, [closeDialogs, getNode, host, updateFolderName, updateItem])

  const openMovePicker = React.useCallback((movingId: string, action: MovePickerAction) => {
    const n = getNode(movingId)
    if (!n || (n.type !== 'folder' && n.type !== 'item')) return
    patchState({
      ctxMenu: { open: false, x: 0, y: 0, nodeId: '' },
      movePicker: { open: true, movingId, query: '', action },
    })
  }, [getNode, patchState])

  const setMovePickerQuery = React.useCallback((query: string) => {
    setState(prev => ({ ...prev, movePicker: { ...prev.movePicker, query } }))
  }, [])

  const pickMoveTarget = React.useCallback(async (toParentId: string) => {
    const picker: MovePickerDraft = stateRef.current.movePicker
    const action = picker.action === 'copy' ? 'copy' : 'move'
    const moving = getNode(picker.movingId)
    try {
      if (action === 'copy') {
        if (moving && moving.type === 'item') await copyItem(picker.movingId, toParentId)
      } else {
        await moveNode(picker.movingId, toParentId)
      }
      void host.toast(`${action === 'copy' ? '已复制到' : '已移动到'}：${folderLabelById(toParentId)}`)
    } catch (error) {
      void host.toast(formatError(error, action === 'copy' ? '复制失败' : '移动失败'))
    }
    closeDialogs()
  }, [closeDialogs, copyItem, folderLabelById, getNode, host, moveNode])

  const setLegacyImportReport = React.useCallback((report: LegacyDataImportReport | null) => {
    patchState({ legacyImportReport: report })
  }, [patchState])

  return {
    state,
    bootStatus,
    bootError,
    dataDirStatus,
    standaloneLaunch,
    host,
    isReady,
    setView,
    setClipboardSearchQuery,
    setClipboardLimit,
    setFolderSearchQuery,
    setFolderSearchScope,
    toggleFolderSearchScope,
    setShowSettings,
    toggleSettings,
    setShowRecentMenu,
    setShowClearHistoryConfirm,
    openRecentFolder,
    clearHistory,
    updateSettings,
    pickDataDir,
    importLegacyData,
    scanOrphanImages,
    deleteOrphanImages,
    getNode,
    isFolder,
    listChildren,
    searchItems,
    buildPathIds,
    folderLabelById,
    canMoveInto,
    navigateFolder,
    navigateBack,
    navigateForward,
    createFolder,
    createItem,
    updateFolderName,
    updateItem,
    deleteNode,
    moveNode,
    copyItem,
    copyFolderItem,
    copyHistoryItem,
    deleteHistoryItem,
    collectionImageUrl,
    loadCollectionImage,
    clipboardImageUrl,
    loadClipboardImage,
    toggleClipboardExpanded,
    isHistoryExpanded,
    isDeleteArmed: controllerIsDeleteArmed,
    armDelete,
    setDraftFolderName,
    setShowFolderEditor,
    resetFolderDraft,
    setDraftTitle,
    setDraftContent,
    setDraftImage,
    pasteDraftImage,
    pickDraftImage,
    setShowItemEditor,
    resetItemDraft,
    setContextMenu,
    closeContextMenu,
    openEditDialog,
    closeDialogs,
    setEditDialogDraft,
    pasteEditDialogImage,
    pickEditDialogImage,
    saveEditDialog,
    openMovePicker,
    setMovePickerQuery,
    pickMoveTarget,
    saveRecentFolder,
    setLegacyImportReport,
  }
}
