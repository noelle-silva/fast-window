import * as React from 'react'
import { AppBar, Box, Button, CircularProgress, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, GlobalStyles, ThemeProvider, Toolbar, Typography } from '@mui/material'
import type { HyperCortexAppSettingsV1 } from '../core'
import type { DataDirStatus, HyperCortexGateway, HyperCortexRepo, LegacyDataImportResult } from '../gateway'
import { sanitizeAppSettingsForSave } from '../appSettingsModel'
import { normalizeRepoCacheLimit } from '../repoCacheLimit'
import { colorPresetCssVars, createHyperCortexTheme, getColorPreset, normalizeColorPresetId } from './colorPresets'
import { RepoCreateDialog, RepoSwitcher, pickNextRepoTitle } from './RepoSwitcher'
import { StandaloneWindowControls, type WindowControlActions } from './StandaloneWindowControls'
import { RepoWorkspace } from './RepoWorkspace'
import { HyperCortexShellProvider, type HyperCortexShellValue, type HyperCortexToolbarSlots } from './shellContext'
import { ErrorBoundary } from './ErrorBoundary'
import { normalizeDefaultFaceKinds, normalizeFaceKindOrder } from '../facePreferences'
import { filterCreatableFaceDeclarations, setFaceDeclarations, type FaceDeclaration } from '../facePlugins'
import { normalizeFacePluginSettingsContainer } from '../facePlugins/settings'

export type HyperCortexWindowControls = {
  standalone: boolean
  actions: WindowControlActions
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const t = target as any
  if (!t || typeof t.closest !== 'function') return false
  return !!t.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')
}

/**
 * 应用外壳：应用设置、仓库池、驻留集、数据目录与全局对话框。
 * 每个驻留仓库挂载一个常驻现场；切换仓库只改变现场的可见性，现场从不销毁。
 */
export function HyperCortexApp(props: { gateway: HyperCortexGateway; initialCommand?: string | null; windowControls?: HyperCortexWindowControls }) {
  const { gateway, initialCommand, windowControls } = props

  // ---- 应用设置（全局唯一事实源）
  const [appSettings, setAppSettings] = React.useState<HyperCortexAppSettingsV1 | null>(null)
  const appSettingsRef = React.useRef<HyperCortexAppSettingsV1 | null>(null)
  const patchAppSettings = React.useCallback(
    (patch: Partial<HyperCortexAppSettingsV1>) => {
      const current = appSettingsRef.current || { version: 1 }
      const next = sanitizeAppSettingsForSave({ ...current, ...patch, version: 1 })
      appSettingsRef.current = next
      setAppSettings(next)
      void gateway.metadata.saveMetadata(next).catch(() => {})
    },
    [gateway],
  )

  // ---- 仓库池与驻留集（LRU：末尾为最近使用）
  const [repos, setRepos] = React.useState<HyperCortexRepo[]>([])
  const [activeRepoId, setActiveRepoId] = React.useState('')
  const activeRepoIdRef = React.useRef('')
  const [residentRepoIds, setResidentRepoIds] = React.useState<string[]>([])
  React.useEffect(() => {
    activeRepoIdRef.current = activeRepoId
  }, [activeRepoId])
  const [repoCreateOpen, setRepoCreateOpen] = React.useState(false)
  const [repoCreateBusy, setRepoCreateBusy] = React.useState(false)

  // ---- 数据目录
  const [dataDirStatus, setDataDirStatus] = React.useState<DataDirStatus | null>(null)

  const refreshDataDirStatus = React.useCallback(async () => {
    try {
      const next = await gateway.host.getDataDirStatus()
      setDataDirStatus(next)
      return next
    } catch (e: any) {
      const message = String(e?.message || e || '刷新数据目录失败')
      setDataDirStatus(null)
      void gateway.host.toast(message)
      throw e
    }
  }, [gateway])

  const pickDataDir = React.useCallback(async (): Promise<DataDirStatus | null> => {
    try {
      const next = await gateway.host.pickDataDir()
      if (next) {
        setDataDirStatus(next)
        void gateway.host.toast('数据目录已切换')
      }
      return next
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '切换数据目录失败'))
      throw e
    }
  }, [gateway])

  const refreshRepos = React.useCallback(async () => {
    const list = await gateway.repos.listRepos().catch(() => null)
    if (list) setRepos(list)
  }, [gateway])

  const importLegacyData = React.useCallback(async (): Promise<LegacyDataImportResult | null> => {
    try {
      const result = await gateway.host.importLegacyData()
      if (result) {
        await refreshRepos()
        const importedCount = result.files.length
        const skippedCount = result.skipped.length
        const repoHint = result.repoTitle ? `，已导入为新仓库「${result.repoTitle}」` : ''
        void gateway.host.toast(`旧数据导入完成：已导入 ${importedCount} 项，跳过 ${skippedCount} 项${repoHint}`)
      }
      return result
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '导入旧数据失败'))
      throw e
    }
  }, [gateway, refreshRepos])

  // ---- 应用命令队列（启动参数、宿主唤起与现场来源共用；由当前活动现场消费）
  const [appCommandQueue, setAppCommandQueue] = React.useState<string[]>(() => {
    const initial = String(initialCommand || '').trim()
    return initial ? [initial] : []
  })
  const enqueueAppCommand = React.useCallback((command: string) => {
    const id = String(command || '').trim()
    if (!id) return
    setAppCommandQueue(prev => [...prev, id])
  }, [])
  const consumeAppCommand = React.useCallback(() => {
    setAppCommandQueue(prev => prev.slice(1))
  }, [])
  React.useEffect(() => {
    const onCommand = (event: Event) => {
      const command = String((event as CustomEvent<{ command?: string }>).detail?.command || '').trim()
      if (command) enqueueAppCommand(command)
    }
    window.addEventListener('hypercortex-command', onCommand)
    return () => window.removeEventListener('hypercortex-command', onCommand)
  }, [enqueueAppCommand])

  // ---- 工具栏槽位（现场工具栏经 portal 渲染到外壳顶部栏）
  const [toolbarLeftSlot, setToolbarLeftSlot] = React.useState<HTMLElement | null>(null)
  const [toolbarRightSlot, setToolbarRightSlot] = React.useState<HTMLElement | null>(null)
  const toolbarSlots = React.useMemo<HyperCortexToolbarSlots>(() => ({ left: toolbarLeftSlot, right: toolbarRightSlot }), [toolbarLeftSlot, toolbarRightSlot])

  // ---- 切换仓库：目标入列/置尾，现场从不销毁。
  // repoTitle 供刚创建、尚未进入 repos 快照的仓库直接使用。
  const handleSwitchRepo = React.useCallback(
    (repoId: string, repoTitle?: string) => {
      const id = String(repoId || '').trim()
      if (!id || id === activeRepoIdRef.current) return
      activeRepoIdRef.current = id
      setActiveRepoId(id)
      setResidentRepoIds(prev => (prev.includes(id) ? [...prev.filter(item => item !== id), id] : [...prev, id]))
      patchAppSettings({ activeRepoId: id })
      const title = String(repoTitle || '').trim() || repos.find(repo => repo.id === id)?.title || id
      void gateway.host.toast(`已切换到仓库：${title}`)
    },
    [gateway, patchAppSettings, repos],
  )

  // ---- 驻留回收：超过上限时从最旧端回收，永不回收当前仓库
  const repoCacheLimit = normalizeRepoCacheLimit(appSettings?.repoCacheLimit)
  React.useEffect(() => {
    if (!activeRepoIdRef.current) return
    setResidentRepoIds(prev => {
      if (prev.length <= repoCacheLimit) return prev
      let excess = prev.length - repoCacheLimit
      const next: string[] = []
      for (const id of prev) {
        if (excess > 0 && id !== activeRepoIdRef.current) {
          excess -= 1
          continue
        }
        next.push(id)
      }
      return excess === 0 ? next : prev
    })
  }, [activeRepoId, repoCacheLimit, residentRepoIds])

  const handleCreateRepo = React.useCallback(
    async (title: string) => {
      const nextTitle = String(title || '').trim() || pickNextRepoTitle(repos)
      setRepoCreateBusy(true)
      try {
        const created = await gateway.repos.createRepo(nextTitle)
        setRepos(prev => (prev.some(repo => repo.id === created.id) ? prev : [...prev, created]))
        setRepoCreateOpen(false)
        handleSwitchRepo(created.id, created.title)
      } catch (e: any) {
        void gateway.host.toast(String(e?.message || e || '新建仓库失败'))
      } finally {
        setRepoCreateBusy(false)
      }
    },
    [gateway, handleSwitchRepo, repos],
  )

  const handleRenameRepo = React.useCallback(
    async (repoId: string, title: string) => {
      const renamed = await gateway.repos.renameRepo(repoId, title)
      setRepos(prev => prev.map(repo => (repo.id === renamed.id ? { ...repo, title: renamed.title } : repo)))
    },
    [gateway],
  )

  const handleDeleteRepo = React.useCallback(
    async (repoId: string) => {
      await gateway.repos.deleteRepo(repoId)
      setRepos(prev => prev.filter(repo => repo.id !== repoId))
      setResidentRepoIds(prev => prev.filter(id => id !== repoId))
      void gateway.host.toast('已将仓库移入仓库回收站')
    },
    [gateway],
  )

  // ---- 初始化：应用设置 + 仓库池 + 面声明；失败提供显式重试
  const [initError, setInitError] = React.useState<string | null>(null)
  const [initRetryBusy, setInitRetryBusy] = React.useState(false)
  const shellReady = !!appSettings && !!activeRepoId

  const runAppInitialization = React.useCallback(async () => {
    setInitError(null)
    try {
      const loadAppSettings = async () => (await gateway.metadata.tryLoadMetadata()) || (await gateway.metadata.ensureMetadata())
      const [normalizedSettingsRaw, repoList] = await Promise.all([loadAppSettings(), gateway.repos.listRepos()])
      // 当前仓库：优先上次使用的仓库，其次仓库池中的第一个可用仓库。
      const preferredRepo = repoList.find(repo => repo.id === normalizedSettingsRaw.activeRepoId) || repoList[0]
      if (!preferredRepo) throw new Error('仓库池为空')

      // 声明单源：取后端面插件声明并写入运行时仓库；失败不阻断核心数据（面系统本会话降级）。
      let declarations: FaceDeclaration[] = []
      let declarationsReady = false
      try {
        declarations = await gateway.notes.listFacePlugins()
        setFaceDeclarations(declarations)
        declarationsReady = true
      } catch (e: any) {
        setInitError(`面插件声明加载失败：${String(e?.message || e || '未知错误')}`)
      }
      const knownFaceKinds = declarations.map(declaration => declaration.kind)
      const creatableFaceKinds = filterCreatableFaceDeclarations(declarations).map(declaration => declaration.kind)

      const normalizedFacePluginSettings = normalizeFacePluginSettingsContainer(normalizedSettingsRaw.facePluginSettings)
      // 声明未就绪时保持用户既有面偏好原值，避免用空清单清空偏好（重试成功后按声明重新收敛）。
      const normalizedFaceKindOrder = declarationsReady
        ? normalizeFaceKindOrder(normalizedSettingsRaw.faceKindOrder, knownFaceKinds)
        : (Array.isArray(normalizedSettingsRaw.faceKindOrder) ? normalizedSettingsRaw.faceKindOrder : [])
      const normalizedDefaultFaceKinds = declarationsReady
        ? normalizeDefaultFaceKinds(normalizedSettingsRaw.defaultFaceKinds, creatableFaceKinds)
        : (Array.isArray(normalizedSettingsRaw.defaultFaceKinds) ? normalizedSettingsRaw.defaultFaceKinds : [])

      const normalizedSettings = sanitizeAppSettingsForSave({
        ...normalizedSettingsRaw,
        facePluginSettings: normalizedFacePluginSettings,
        faceKindOrder: normalizedFaceKindOrder,
        defaultFaceKinds: normalizedDefaultFaceKinds,
        activeRepoId: preferredRepo.id,
      })

      appSettingsRef.current = normalizedSettings
      setAppSettings(normalizedSettings)
      setRepos(repoList)
      activeRepoIdRef.current = preferredRepo.id
      setActiveRepoId(preferredRepo.id)
      // 重试不回收既有驻留现场：目标仓库置于驻留集末尾（最近使用）。
      setResidentRepoIds(prev => [...prev.filter(id => id !== preferredRepo.id), preferredRepo.id])

      if (JSON.stringify(normalizedSettingsRaw) !== JSON.stringify(normalizedSettings)) {
        void gateway.metadata.saveMetadata(normalizedSettings).catch(() => {})
      }
    } catch (e: any) {
      const message = String(e?.message || e || '初始化应用数据失败')
      setInitError(message)
      void gateway.host.toast(message)
    }
  }, [gateway])

  React.useEffect(() => {
    void runAppInitialization()
  }, [runAppInitialization])

  // ---- 主题（全局唯一）
  const colorPresetId = normalizeColorPresetId(appSettings?.colorPresetId)
  const colorPreset = React.useMemo(() => getColorPreset(colorPresetId), [colorPresetId])
  const theme = React.useMemo(() => createHyperCortexTheme(colorPreset), [colorPreset])
  const colorPresetVars = React.useMemo(() => colorPresetCssVars(colorPreset), [colorPreset])

  const onTopbarPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      // Portal 浮层（下拉菜单、弹窗）中的按下事件会沿 React 组件树冒泡到这里；
      // 只有真正落在工具栏 DOM 内的按下才触发窗口拖动，否则会吞掉浮层自身的点击。
      const target = e.target as Node | null
      if (!target || !e.currentTarget.contains(target)) return
      if (isInteractiveTarget(e.target)) return
      gateway.host.startDragging()
    },
    [gateway],
  )

  const appCommands = React.useMemo(() => ({
    queue: appCommandQueue,
    enqueue: enqueueAppCommand,
    consume: consumeAppCommand,
  }), [appCommandQueue, consumeAppCommand, enqueueAppCommand])

  const shellValue = React.useMemo<HyperCortexShellValue>(() => ({
    appSettings: appSettings || { version: 1 },
    patchAppSettings,
    reposGateway: gateway,
    repos,
    activeRepoId,
    onRenameRepo: handleRenameRepo,
    onDeleteRepo: handleDeleteRepo,
    refreshRepos,
    dataDirStatus,
    refreshDataDirStatus,
    pickDataDir,
    importLegacyData,
    toolbarSlots,
    appCommands,
  }), [
    activeRepoId,
    appCommandQueue,
    appCommands,
    appSettings,
    dataDirStatus,
    gateway,
    handleDeleteRepo,
    handleRenameRepo,
    importLegacyData,
    patchAppSettings,
    pickDataDir,
    refreshDataDirStatus,
    refreshRepos,
    repos,
    toolbarSlots,
  ])

  const standaloneWindowControls = windowControls?.standalone ? <StandaloneWindowControls actions={windowControls.actions} /> : null

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          html: { height: '100%' },
          body: { height: '100%', margin: 0, backgroundColor: 'var(--hc-app-bg)' },
          '#app': { height: '100%' },
          '*': {
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,.24) transparent',
          },
          '*::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '*::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '*::-webkit-scrollbar-button': {
            width: 0,
            height: 0,
            display: 'none',
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,.24)',
            borderRadius: 999,
          },
          '*::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'rgba(0,0,0,.34)',
          },
          '*::-webkit-scrollbar-corner': {
            background: 'transparent',
          },
        }}
      />
      <GlobalStyles styles={{ ':root': colorPresetVars }} />

      <ErrorBoundary>
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'var(--hc-app-bg)' }}>
          <AppBar position="static" elevation={0} sx={{ bgcolor: 'var(--hc-surface)', color: 'var(--hc-text)' }}>
            <Toolbar
              variant="dense"
              sx={{
                gap: 0.5,
                minHeight: 40,
                pl: 0,
                pr: 0,
                '&.MuiToolbar-root': { minHeight: 40, paddingLeft: 0, paddingRight: 0 },
                justifyContent: 'space-between',
              }}
              onPointerDown={onTopbarPointerDown}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 6 }}>
                  <RepoSwitcher
                    repos={repos}
                    activeRepoId={activeRepoId}
                    residentCount={residentRepoIds.length}
                    onSwitch={repoId => handleSwitchRepo(repoId)}
                    onCreateRequest={() => setRepoCreateOpen(true)}
                  />
                  <Box ref={setToolbarLeftSlot} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} />
                </Box>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', pr: 1, gap: 0.25 }}>
                <Box ref={setToolbarRightSlot} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }} />
                {standaloneWindowControls}
              </Box>
            </Toolbar>
          </AppBar>

          <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {shellReady ? (
              <HyperCortexShellProvider value={shellValue}>
                <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  {residentRepoIds.map(id => (
                    <RepoWorkspace key={id} repoId={id} visible={id === activeRepoId} />
                  ))}
                </Box>
              </HyperCortexShellProvider>
            ) : (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
                <CircularProgress size={22} />
                <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>正在启动…</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </ErrorBoundary>

      <RepoCreateDialog
        open={repoCreateOpen}
        busy={repoCreateBusy}
        defaultTitle={pickNextRepoTitle(repos)}
        onClose={() => {
          if (!repoCreateBusy) setRepoCreateOpen(false)
        }}
        onConfirm={title => void handleCreateRepo(title)}
      />

      <Dialog open={!!initError} onClose={() => {}} maxWidth="xs" fullWidth>
        <DialogTitle>初始化失败</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {initError}
          </Typography>
          <Typography sx={{ mt: 1, fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.56)' }}>
            {shellReady
              ? '核心数据已就绪，可以继续使用；面相关功能可能暂不可用。'
              : '为避免覆盖已有数据，应用数据写入已暂停。请先修复问题再重试。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          {shellReady ? (
            <Button onClick={() => setInitError(null)} disabled={initRetryBusy}>暂时继续</Button>
          ) : null}
          <Button
            variant="contained"
            disabled={initRetryBusy}
            onClick={() => {
              setInitRetryBusy(true)
              void runAppInitialization().finally(() => setInitRetryBusy(false))
            }}
          >
            {initRetryBusy ? '重试中…' : '重试'}
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
