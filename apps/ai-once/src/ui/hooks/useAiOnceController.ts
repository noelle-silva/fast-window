import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from '../../backendClient'
import type { AppData, DataDirStatus, DirectClient, DraftImage, FwLaunchInfo, HistoryDoc, HistoryEntry, Provider, Space, Template } from '../../types'
import {
  DEFAULT_LAUNCH_INFO,
  activeProvider as getActiveProvider,
  appRequestTimeoutMs,
  activeTemplate as getActiveTemplate,
  createDefaultSpace,
  defaultModel as getDefaultModel,
  errorMessage,
  fileToDraftImage,
  historyEntryToDraftImages,
  modelCoordinate,
  nowMs,
  parseModelCoordinate,
} from '../../shared/aiOnceDomain'
import { createAiOnceUiState, type AiOnceDialog, type AiOnceUiState, type AiOnceView } from '../state'

const appWindow = getCurrentWindow()

export type AiOnceController = {
  state: AiOnceUiState
  currentSpace: Space | null
  provider: Provider | null
  template: Template | null
  providerId: string
  model: string
  models: string[]
  imageBytes: number
  providerLine: string
  historyPositionLabel: string
  isReady: boolean
  canAsk: boolean
  canCancelAsk: boolean
  canGoHistoryBack: boolean
  canGoHistoryForward: boolean
  setView(view: AiOnceView): void
  setSpacesSortMode(enabled: boolean): void
  setDialog(dialog: AiOnceDialog): void
  setError(message: string): void
  connect(options?: { restartBackend?: boolean }): Promise<void>
  pickDataDir(): Promise<void>
  openAppSettings(): void
  openSettings(): void
  openTemplates(): void
  closeDialog(): void
  setEditing(data: AppData): void
  mutateEditing(recipe: (draft: AppData) => void): void
  saveEditing(): Promise<void>
  refreshModels(): Promise<void>
  setPrompt(value: string): void
  setModelDraft(value: string): void
  setCustomModel(value: string): void
  askOnce(): Promise<void>
  cancelAsk(): void
  clearWorkbench(): void
  copyAnswer(): Promise<void>
  addImageFiles(files: FileList | File[]): Promise<void>
  removeImage(imageId: string): void
  clearImages(): void
  openSpace(spaceId: string): void
  openCreateSpaceDialog(): void
  setSpaceName(value: string): void
  createSpace(): Promise<void>
  openRenameSpace(spaceId: string): void
  setSpaceRenameName(value: string): void
  saveSpaceRename(): Promise<void>
  requestDeleteSpace(spaceId: string): void
  cancelDeleteSpace(): void
  confirmDeleteSpace(): Promise<void>
  moveSpace(spaceId: string, targetSpaceId: string, position: 'before' | 'after'): Promise<void>
  updateActiveProvider(providerId: string): Promise<void>
  updateActiveTemplate(templateId: string): Promise<void>
  goHistoryBack(): Promise<void>
  goHistoryForward(): Promise<void>
  windowActions: {
    startDragging(): Promise<void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    closeToTray(): Promise<void>
  }
}

function cloneData(data: AppData): AppData {
  return structuredClone(data) as AppData
}

function revokeImages(images: DraftImage[]) {
  for (const image of images) {
    if (image.previewUrl.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl)
  }
}

export function useAiOnceController(): AiOnceController {
  const [state, setState] = React.useState<AiOnceUiState>(() => createAiOnceUiState())
  const clientRef = React.useRef<DirectClient | null>(null)
  const askAbortRef = React.useRef<AbortController | null>(null)
  const stateRef = React.useRef(state)

  stateRef.current = state

  const currentSpace = state.data?.spaces.find(space => space.id === state.spaceId) || state.data?.spaces[0] || null
  const activeProvider = getActiveProvider(state.data)
  const template = getActiveTemplate(currentSpace)
  const activeProviderId = activeProvider?.id || ''
  const defaultCoordinate = modelCoordinate(activeProvider?.name || '', getDefaultModel(currentSpace, activeProviderId))
  const model = state.modelDraft === '__custom__'
    ? state.customModel.trim()
    : (state.modelDraft || defaultCoordinate).trim()
  const parsedModel = parseModelCoordinate(model)
  const selectedProvider = parsedModel.providerName ? state.data?.settings.providers.find(item => item.name === parsedModel.providerName) || null : null
  const provider = selectedProvider || activeProvider
  const providerId = provider?.id || ''
  const models = state.data?.settings.providers.flatMap(item => item.modelsCache.items.map(modelId => modelCoordinate(item.name, modelId))) || []
  const spaceHistory = currentSpace ? state.history.filter(entry => entry.spaceId === currentSpace.id) : []
  const historyCursorIndex = state.historyCursorId ? spaceHistory.findIndex(entry => entry.id === state.historyCursorId) : -1
  const historyPositionLabel = !spaceHistory.length ? '无历史' : historyCursorIndex >= 0 ? `${historyCursorIndex + 1}/${spaceHistory.length}` : `最近 ${spaceHistory.length}`
  const imageBytes = state.images.reduce((sum, image) => sum + image.size, 0)
  const isReady = state.phase === 'ready' && !!clientRef.current
  const canAsk = Boolean(isReady && !state.busy && !state.asking && (state.prompt.trim() || state.images.length) && selectedProvider && parsedModel.modelId)
  const canCancelAsk = Boolean(state.asking && askAbortRef.current)
  const canGoHistoryBack = Boolean(isReady && !state.busy && !state.asking && spaceHistory.length && (historyCursorIndex < 0 || historyCursorIndex < spaceHistory.length - 1))
  const canGoHistoryForward = Boolean(isReady && !state.busy && !state.asking && historyCursorIndex > 0)
  const providerLine = provider?.baseUrl || state.dataDirStatus?.dataDir || '等待后台连接'

  const patchState = React.useCallback((patch: Partial<AiOnceUiState>) => {
    setState(prev => ({ ...prev, ...patch }))
  }, [])

  const setError = React.useCallback((message: string) => {
    patchState({ error: message })
  }, [patchState])

  const refreshDataDirStatus = React.useCallback(async () => {
    const next = await invoke<DataDirStatus>('data_dir_status')
    patchState({ dataDirStatus: next })
    return next
  }, [patchState])

  const closeClient = React.useCallback(() => {
    askAbortRef.current?.abort()
    askAbortRef.current = null
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const applyData = React.useCallback((data: AppData) => {
    setState(prev => {
      const firstSpace = data.spaces[0]
      const hasCurrentSpace = !!prev.spaceId && data.spaces.some(space => space.id === prev.spaceId)
      const shouldCreateEditingDraft = (prev.dialog === 'settings' || prev.dialog === 'templates' || prev.dialog === 'app-settings') && !prev.editing
      return {
        ...prev,
        data,
        spacesSortMode: data.spaces.length > 1 ? prev.spacesSortMode : false,
        spaceId: hasCurrentSpace ? prev.spaceId : firstSpace?.id || '',
        historyCursorId: hasCurrentSpace ? prev.historyCursorId : '',
        editing: shouldCreateEditingDraft ? cloneData(data) : prev.editing,
      }
    })
  }, [])

  const loadFromClient = React.useCallback(async (client: DirectClient) => {
    const [data, history, health] = await Promise.all([
      client.request<AppData>('aiOnce.data.get'),
      client.request<HistoryDoc>('aiOnce.history.list'),
      client.request<Record<string, unknown>>('aiOnce.health'),
    ])
    const items = history.items || []
    applyData(data)
    patchState({ history: items, health })
    return items
  }, [applyData, patchState])

  const refreshHistory = React.useCallback(async (client: DirectClient) => {
    const history = await client.request<HistoryDoc>('aiOnce.history.list')
    const items = history.items || []
    const cursorId = stateRef.current.historyCursorId
    patchState({ history: items, historyCursorId: items.some(entry => entry.id === cursorId) ? cursorId : '' })
    return items
  }, [patchState])

  const connect = React.useCallback(async (options?: { restartBackend?: boolean }) => {
    closeClient()
    patchState({ busy: true, error: '', phase: 'starting' })
    let nextClient: DirectClient | null = null
    try {
      if (options?.restartBackend) await invoke('restart_backend')
      nextClient = await createDirectClient()
      clientRef.current = nextClient
      await loadFromClient(nextClient)
      await refreshDataDirStatus()
      patchState({ phase: 'ready' })
    } catch (error) {
      nextClient?.close()
      if (clientRef.current === nextClient) clientRef.current = null
      const message = errorMessage(error, '启动 AI Once 后台失败')
      patchState({ phase: 'failed', error: message })
      try {
        await refreshDataDirStatus()
      } catch (statusError) {
        patchState({ error: `${message}；数据目录状态读取失败：${errorMessage(statusError, '未知错误')}` })
      }
    } finally {
      patchState({ busy: false })
    }
  }, [closeClient, loadFromClient, patchState, refreshDataDirStatus])

  const saveData = React.useCallback(async (data: AppData) => {
    const client = clientRef.current
    if (!client) throw new Error('后台未连接')
    const saved = await client.request<AppData>('aiOnce.data.save', data)
    applyData(saved)
    await refreshHistory(client)
    return saved
  }, [applyData, refreshHistory])

  const updateData = React.useCallback(async (recipe: (draft: AppData) => void) => {
    const data = stateRef.current.data
    if (!data) throw new Error('数据尚未加载')
    const draft = cloneData(data)
    recipe(draft)
    return saveData(draft)
  }, [saveData])

  const clearImages = React.useCallback(() => {
    if (stateRef.current.busy || stateRef.current.asking) return
    setState(prev => {
      revokeImages(prev.images)
      return { ...prev, images: [], historyCursorId: '' }
    })
  }, [])

  const clearWorkbench = React.useCallback(() => {
    setState(prev => {
      revokeImages(prev.images)
      return { ...prev, prompt: '', answer: '', images: [], error: '', historyCursorId: '' }
    })
  }, [])

  const handleRuntimeCommand = React.useCallback((raw: unknown, source: 'initial' | 'runtime') => {
    const command = String(raw || '').trim()
    if (!command) return
    setState(prev => ({
      ...prev,
      initialCommand: source === 'initial' ? command : prev.initialCommand,
      runtimeCommand: source === 'runtime' ? command : prev.runtimeCommand,
    }))
    if (command === 'open-settings') {
      const data = stateRef.current.data
      if (data) patchState({ editing: cloneData(data), dialog: 'settings' })
      else patchState({ dialog: 'settings' })
      return
    }
    if (command === 'ask-once') {
      patchState({ view: 'workbench', spacesSortMode: false })
      return
    }
    if (command === 'new-prompt') {
      clearWorkbench()
      patchState({ view: 'workbench', spacesSortMode: false })
    }
  }, [clearWorkbench, patchState])

  React.useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    async function init() {
      const [launchInfo, command] = await Promise.all([
        invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO),
        invoke<string | null>('fw_initial_command').catch(() => null),
      ])
      if (cancelled) return
      patchState({ launchInfo })
      if (command) handleRuntimeCommand(command, 'initial')
      unlisten = await listen<{ command?: string }>('fw-app-command', event => {
        handleRuntimeCommand(event.payload?.command, 'runtime')
      })
      await invoke('app_ready').catch(() => {})
      await refreshDataDirStatus().catch(error => {
        patchState({ error: errorMessage(error, '读取数据目录状态失败') })
      })
      if (!cancelled) await connect()
    }

    void init()
    return () => {
      cancelled = true
      unlisten?.()
      closeClient()
      revokeImages(stateRef.current.images)
    }
  }, [closeClient, connect, handleRuntimeCommand, patchState, refreshDataDirStatus])

  const setView = React.useCallback((view: AiOnceView) => patchState({ view, spacesSortMode: view === 'spaces' ? stateRef.current.spacesSortMode : false }), [patchState])
  const setSpacesSortMode = React.useCallback((spacesSortMode: boolean) => {
    if (!spacesSortMode) {
      patchState({ spacesSortMode: false })
      return
    }
    const current = stateRef.current
    if (current.view !== 'spaces' || !current.data || current.data.spaces.length <= 1 || current.busy || current.asking) return
    patchState({ spacesSortMode: true })
  }, [patchState])
  const setDialog = React.useCallback((dialog: AiOnceDialog) => patchState({ dialog }), [patchState])
  const closeDialog = React.useCallback(() => patchState({
    dialog: '',
    editing: null,
    spaceName: '',
    spaceRename: { open: false, id: '', name: '' },
  }), [patchState])

  const openAppSettings = React.useCallback(() => {
    const data = stateRef.current.data
    patchState({ editing: data ? cloneData(data) : null, dialog: 'app-settings' })
  }, [patchState])

  const openSettings = React.useCallback(() => {
    const data = stateRef.current.data
    if (!data) {
      patchState({ error: '数据尚未加载，无法打开设置' })
      return
    }
    patchState({ editing: cloneData(data), dialog: 'settings' })
  }, [patchState])

  const openTemplates = React.useCallback(() => {
    const data = stateRef.current.data
    if (!data) {
      patchState({ error: '数据尚未加载，无法打开模板' })
      return
    }
    patchState({ editing: cloneData(data), dialog: 'templates' })
  }, [patchState])

  const setEditing = React.useCallback((data: AppData) => patchState({ editing: data }), [patchState])
  const mutateEditing = React.useCallback((recipe: (draft: AppData) => void) => {
    const editing = stateRef.current.editing
    if (!editing) return
    const draft = cloneData(editing)
    recipe(draft)
    patchState({ editing: draft })
  }, [patchState])

  const saveEditing = React.useCallback(async () => {
    const editing = stateRef.current.editing
    if (!editing) throw new Error('没有可保存的设置')
    patchState({ busy: true, error: '' })
    try {
      await saveData(editing)
      patchState({ dialog: '', editing: null })
    } catch (error) {
      patchState({ error: errorMessage(error, '保存失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [patchState, saveData])

  const refreshModels = React.useCallback(async () => {
    const client = clientRef.current
    const active = getActiveProvider(stateRef.current.data)
    if (!client || !active) {
      patchState({ error: '后台或供应商尚未就绪' })
      return
    }
    patchState({ busy: true, error: '' })
    try {
      const data = await client.request<AppData>('aiOnce.models.refresh', { providerId: active.id }, { timeoutMs: appRequestTimeoutMs(stateRef.current.data?.settings.timeouts) })
      applyData(data)
    } catch (error) {
      patchState({ error: errorMessage(error, '刷新模型失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [applyData, patchState])

  const pickDataDir = React.useCallback(async () => {
    patchState({ busy: true, error: '' })
    try {
      const picked = await invoke<DataDirStatus | null>('pick_data_dir')
      if (picked) patchState({ dataDirStatus: picked, editing: null })
      if (picked) await connect()
    } catch (error) {
      patchState({ phase: 'failed', error: errorMessage(error, '切换数据目录失败') })
      await refreshDataDirStatus().catch(() => {})
    } finally {
      patchState({ busy: false })
    }
  }, [connect, patchState, refreshDataDirStatus])

  const setPrompt = React.useCallback((prompt: string) => patchState({ prompt, historyCursorId: '' }), [patchState])
  const setModelDraft = React.useCallback((modelDraft: string) => {
    if (stateRef.current.busy || stateRef.current.asking) return
    patchState({ modelDraft, customModel: modelDraft === '__custom__' ? stateRef.current.customModel : '', historyCursorId: '' })
  }, [patchState])
  const setCustomModel = React.useCallback((customModel: string) => {
    if (stateRef.current.busy || stateRef.current.asking) return
    patchState({ customModel, historyCursorId: '' })
  }, [patchState])

  const addImageFiles = React.useCallback(async (files: FileList | File[]) => {
    if (stateRef.current.busy || stateRef.current.asking) return
    const settings = stateRef.current.data?.settings || { imageMaxCount: 6, imageMaxMb: 8 }
    const maxBytes = settings.imageMaxMb * 1024 * 1024
    const current = stateRef.current.images
    const capacity = Math.max(0, settings.imageMaxCount - current.length)
    if (capacity <= 0) {
      patchState({ error: `图片数量已达到上限：${settings.imageMaxCount} 张` })
      return
    }
    const candidates = Array.from(files)
    const valid: File[] = []
    const rejected: string[] = []
    for (const file of candidates) {
      if (!file.type.startsWith('image/')) rejected.push(`${file.name || '未命名文件'} 不是图片`)
      else if (file.size > maxBytes) rejected.push(`${file.name || '图片'} 超过 ${settings.imageMaxMb} MB`)
      else valid.push(file)
    }
    const picked = valid.slice(0, capacity)
    const overflow = Math.max(0, valid.length - picked.length)
    const nextImages = await Promise.all(picked.map(fileToDraftImage))
    setState(prev => ({ ...prev, images: [...prev.images, ...nextImages], error: rejected.concat(overflow ? [`还有 ${overflow} 张图片超过数量上限`] : []).join('；'), historyCursorId: '' }))
  }, [patchState])

  const removeImage = React.useCallback((imageId: string) => {
    if (stateRef.current.busy || stateRef.current.asking) return
    setState(prev => {
      const hit = prev.images.find(image => image.id === imageId)
      if (hit?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(hit.previewUrl)
      return { ...prev, images: prev.images.filter(image => image.id !== imageId), historyCursorId: '' }
    })
  }, [])

  const askOnce = React.useCallback(async () => {
    if (stateRef.current.busy || stateRef.current.asking) return
    const client = clientRef.current
    const data = stateRef.current.data
    const space = data?.spaces.find(item => item.id === stateRef.current.spaceId) || data?.spaces[0] || null
    const active = getActiveProvider(data || null)
    const selectedTemplate = getActiveTemplate(space)
    const modelValue = stateRef.current.modelDraft === '__custom__'
      ? stateRef.current.customModel.trim()
      : (stateRef.current.modelDraft || modelCoordinate(active?.name || '', getDefaultModel(space, active?.id || ''))).trim()
    const parsedModel = parseModelCoordinate(modelValue)
    const selectedProvider = data?.settings.providers.find(item => item.name === parsedModel.providerName) || null
    if (!client || !data || !space || !selectedProvider) {
      patchState({ error: '后台、空间或供应商尚未就绪' })
      return
    }
    if (!stateRef.current.prompt.trim() && !stateRef.current.images.length) {
      patchState({ error: '请输入问题或添加图片' })
      return
    }
    if (!parsedModel.modelId) {
      patchState({ error: '请选择或填写模型' })
      return
    }
    const askAbort = new AbortController()
    askAbortRef.current = askAbort
    patchState({ asking: true, error: '', answer: '' })
    try {
      const entry = await client.request<HistoryEntry>('aiOnce.ask', {
        spaceId: space.id,
        templateId: selectedTemplate?.id || '',
        providerId: selectedProvider.id,
        model: parsedModel.modelId,
        input: stateRef.current.prompt,
        images: stateRef.current.images.map(({ id: _id, previewUrl: _previewUrl, ...rest }) => rest),
      }, { signal: askAbort.signal, timeoutMs: appRequestTimeoutMs(data.settings.timeouts) })
      const history = await loadFromClient(client)
      patchState({ answer: entry.output, historyCursorId: history.some(item => item.id === entry.id) ? entry.id : '' })
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        patchState({ error: 'AI 请求已取消' })
        return
      }
      const message = errorMessage(error, 'AI 请求失败')
      try {
        await refreshHistory(client)
        patchState({ error: message })
      } catch (historyError) {
        patchState({ error: `${message}；历史刷新失败：${errorMessage(historyError, '未知错误')}` })
      }
    } finally {
      if (askAbortRef.current === askAbort) askAbortRef.current = null
      patchState({ asking: false })
    }
  }, [loadFromClient, patchState, refreshHistory])

  const cancelAsk = React.useCallback(() => {
    askAbortRef.current?.abort()
  }, [])

  const copyAnswer = React.useCallback(async () => {
    const answer = stateRef.current.answer
    if (!answer) return
    if (!navigator.clipboard) {
      patchState({ error: '当前环境无法访问剪贴板' })
      return
    }
    try {
      await navigator.clipboard.writeText(answer)
    } catch (error) {
      patchState({ error: errorMessage(error, '复制失败') })
    }
  }, [patchState])

  const openSpace = React.useCallback((spaceId: string) => {
    const data = stateRef.current.data
    const space = data?.spaces.find(item => item.id === spaceId) || null
    const active = getActiveProvider(data || null)
    const defaultCoordinate = modelCoordinate(active?.name || '', getDefaultModel(space, active?.id || ''))
    setState(prev => {
      revokeImages(prev.images)
      return {
        ...prev,
        spaceId,
        view: 'workbench',
        spacesSortMode: false,
        prompt: '',
        answer: '',
        images: [],
        error: '',
        historyCursorId: '',
        modelDraft: defaultCoordinate,
        customModel: '',
      }
    })
  }, [])

  const openCreateSpaceDialog = React.useCallback(() => patchState({ dialog: 'space', spaceName: '' }), [patchState])
  const setSpaceName = React.useCallback((spaceName: string) => patchState({ spaceName }), [patchState])
  const createSpace = React.useCallback(async () => {
    const name = stateRef.current.spaceName.trim() || '新空间'
    patchState({ busy: true, error: '' })
    try {
      const saved = await updateData(data => {
        data.spaces.unshift(createDefaultSpace(name))
      })
      patchState({ dialog: '', spaceName: '', spaceId: saved.spaces[0]?.id || '', historyCursorId: '' })
    } catch (error) {
      patchState({ error: errorMessage(error, '创建空间失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [patchState, updateData])

  const openRenameSpace = React.useCallback((spaceId: string) => {
    const space = stateRef.current.data?.spaces.find(item => item.id === spaceId)
    if (!space) return
    patchState({ spaceRename: { open: true, id: space.id, name: space.name } })
  }, [patchState])
  const setSpaceRenameName = React.useCallback((name: string) => {
    setState(prev => ({ ...prev, spaceRename: { ...prev.spaceRename, name } }))
  }, [])
  const saveSpaceRename = React.useCallback(async () => {
    const draft = stateRef.current.spaceRename
    if (!draft.id) return
    patchState({ busy: true, error: '' })
    try {
      await updateData(data => {
        const space = data.spaces.find(item => item.id === draft.id)
        if (space) {
          space.name = draft.name.trim() || space.name
          space.updatedAt = nowMs()
        }
      })
      patchState({ spaceRename: { open: false, id: '', name: '' } })
    } catch (error) {
      patchState({ error: errorMessage(error, '重命名空间失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [patchState, updateData])

  const requestDeleteSpace = React.useCallback((spaceId: string) => {
    const space = stateRef.current.data?.spaces.find(item => item.id === spaceId)
    if (!space) return
    patchState({ confirmDeleteSpace: { open: true, id: space.id, name: space.name } })
  }, [patchState])
  const cancelDeleteSpace = React.useCallback(() => patchState({ confirmDeleteSpace: { open: false, id: '', name: '' } }), [patchState])
  const confirmDeleteSpace = React.useCallback(async () => {
    const deleting = stateRef.current.confirmDeleteSpace
    if (!deleting.id) return
    patchState({ busy: true, error: '' })
    try {
      await updateData(data => {
        data.spaces = data.spaces.filter(space => space.id !== deleting.id)
        if (!data.spaces.length) data.spaces.push(createDefaultSpace())
      })
      patchState({ confirmDeleteSpace: { open: false, id: '', name: '' } })
    } catch (error) {
      patchState({ error: errorMessage(error, '删除空间失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [patchState, updateData])

  const moveSpace = React.useCallback(async (spaceId: string, targetSpaceId: string, position: 'before' | 'after') => {
    const spaces = stateRef.current.data?.spaces || []
    const from = spaces.findIndex(space => space.id === spaceId)
    const target = spaces.findIndex(space => space.id === targetSpaceId)
    if (from < 0 || target < 0 || from === target) return

    patchState({ busy: true, error: '' })
    try {
      await updateData(data => {
        const from = data.spaces.findIndex(space => space.id === spaceId)
        if (from < 0) return
        const [space] = data.spaces.splice(from, 1)
        const targetAfterRemoval = data.spaces.findIndex(item => item.id === targetSpaceId)
        if (targetAfterRemoval < 0) {
          data.spaces.splice(from, 0, space)
          return
        }
        const insertAt = position === 'before' ? targetAfterRemoval : targetAfterRemoval + 1
        data.spaces.splice(insertAt, 0, space)
      })
    } catch (error) {
      patchState({ error: errorMessage(error, '移动空间失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [patchState, updateData])

  const updateActiveProvider = React.useCallback(async (nextProviderId: string) => {
    patchState({ error: '' })
    try {
      await updateData(data => {
        data.settings.activeProviderId = nextProviderId
      })
      patchState({ modelDraft: '', customModel: '' })
    } catch (error) {
      patchState({ error: errorMessage(error, '切换供应商失败') })
    }
  }, [patchState, updateData])

  const updateActiveTemplate = React.useCallback(async (templateId: string) => {
    const spaceId = stateRef.current.spaceId
    patchState({ error: '' })
    try {
      await updateData(data => {
        const space = data.spaces.find(item => item.id === spaceId) || data.spaces[0]
        if (space) {
          space.activeTemplateId = templateId
          space.updatedAt = nowMs()
        }
      })
    } catch (error) {
      patchState({ error: errorMessage(error, '切换模板失败') })
    }
  }, [patchState, updateData])

  const loadHistoryEntry = React.useCallback(async (entry: HistoryEntry) => {
    const client = clientRef.current
    if (!client) {
      patchState({ error: '后台未连接' })
      return
    }
    patchState({ busy: true, error: '' })
    try {
      const hydrated = await client.request<HistoryEntry>('aiOnce.history.entry', { id: entry.id })
      const images = historyEntryToDraftImages(hydrated)
      const provider = stateRef.current.data?.settings.providers.find(item => item.id === hydrated.providerId)
      setState(prev => {
        revokeImages(prev.images)
        return {
          ...prev,
          view: 'workbench',
          spacesSortMode: false,
          spaceId: hydrated.spaceId,
          prompt: hydrated.input,
          answer: hydrated.output,
          images,
          modelDraft: modelCoordinate(provider?.name || hydrated.providerId, hydrated.model),
          customModel: '',
          error: hydrated.error || '',
          historyCursorId: hydrated.id,
        }
      })
    } catch (error) {
      patchState({ error: errorMessage(error, '加载历史失败') })
    } finally {
      patchState({ busy: false })
    }
  }, [patchState])

  const goHistoryBack = React.useCallback(async () => {
    const spaceId = stateRef.current.spaceId
    const entries = stateRef.current.history.filter(entry => entry.spaceId === spaceId)
    if (!entries.length) return
    const index = stateRef.current.historyCursorId ? entries.findIndex(entry => entry.id === stateRef.current.historyCursorId) : -1
    const target = entries[index < 0 ? 0 : index + 1]
    if (target) await loadHistoryEntry(target)
  }, [loadHistoryEntry])

  const goHistoryForward = React.useCallback(async () => {
    const spaceId = stateRef.current.spaceId
    const entries = stateRef.current.history.filter(entry => entry.spaceId === spaceId)
    const index = stateRef.current.historyCursorId ? entries.findIndex(entry => entry.id === stateRef.current.historyCursorId) : -1
    if (index > 0) await loadHistoryEntry(entries[index - 1])
  }, [loadHistoryEntry])

  const windowActions = React.useMemo(() => ({
    startDragging: () => appWindow.startDragging(),
    minimize: () => appWindow.minimize(),
    toggleMaximize: () => appWindow.toggleMaximize(),
    closeToTray: () => invoke<void>('hide_to_tray'),
  }), [])

  return {
    state,
    currentSpace,
    provider,
    template,
    providerId,
    model,
    models,
    imageBytes,
    providerLine,
    historyPositionLabel,
    isReady,
    canAsk,
    canCancelAsk,
    canGoHistoryBack,
    canGoHistoryForward,
    setView,
    setSpacesSortMode,
    setDialog,
    setError,
    connect,
    pickDataDir,
    openAppSettings,
    openSettings,
    openTemplates,
    closeDialog,
    setEditing,
    mutateEditing,
    saveEditing,
    refreshModels,
    setPrompt,
    setModelDraft,
    setCustomModel,
    askOnce,
    cancelAsk,
    clearWorkbench,
    copyAnswer,
    addImageFiles,
    removeImage,
    clearImages,
    openSpace,
    openCreateSpaceDialog,
    setSpaceName,
    createSpace,
    openRenameSpace,
    setSpaceRenameName,
    saveSpaceRename,
    requestDeleteSpace,
    cancelDeleteSpace,
    confirmDeleteSpace,
    moveSpace,
    updateActiveProvider,
    updateActiveTemplate,
    goHistoryBack,
    goHistoryForward,
    windowActions,
  }
}
