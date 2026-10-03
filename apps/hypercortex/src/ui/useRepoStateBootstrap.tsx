import * as React from 'react'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import {
  type HyperCortexFavoritesNavV1,
  type HyperCortexRepoStateV1,
  type HyperCortexWorkspaceV1,
} from '../core'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { HyperCortexGateway } from '../gateway'
import type { FavoritesLedger } from '../favoritesLedger'
import { isDraftNoteId } from '../drafts'
import { normalizeFavoritesNav } from './favoritesNavigator'
import { createWorkspaceId, normalizeActiveWorkspaceId, normalizeWorkspaces, updateWorkspaceById } from './workspaces'
import { buildRepoStateSnapshot, normalizeScrollTops } from './workspaceModel'
import { applySidebarItemsToWorkspace, deriveSidebarFields, ensureSidebarItems, insertTabAsUngrouped } from './sidebarModel'
import { noteIdFromTabKey, tabKind } from '../tabKey'
import { useKeyedScrollMemory } from './scrollMemory'

// 仓库状态的装载、初始化与持久化：状态归一化纯函数、状态引用与就绪标记、初始化错误与重试状态、
// 装载数据与初始化流程、状态增量持久化与滚动位置持久化、初始化与旧数据导入检测副作用、
// 回收站自动清理副作用，以及加载等待界面。
// 工作区现场应用（applyWorkspaceSidebarState）由中心文件持有，经显式回调 ref 连接。

type RepoStatePatch = Partial<HyperCortexRepoStateV1>

const SIDEBAR_SCROLL_SAVE_DEBOUNCE_MS = 400

function stripDraftTabKeys(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const out: string[] = []
  for (const item of list) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (!key) continue
    if (tabKind(key) === 'note' && isDraftNoteId(noteIdFromTabKey(key))) continue
    if (out.includes(key)) continue
    out.push(key)
  }
  return out
}

function stripDraftTabKeyMap(value: any): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    const tabKey = String(k || '').trim()
    if (!tabKey) continue
    if (tabKind(tabKey) === 'note' && isDraftNoteId(noteIdFromTabKey(tabKey))) continue
    const groupId = String(v || '').trim()
    if (!groupId) continue
    out[tabKey] = groupId
  }
  return out
}

function sanitizeRepoStateForSave(state: HyperCortexRepoStateV1): HyperCortexRepoStateV1 {
  const next: HyperCortexRepoStateV1 = { ...state, version: 1 }

  delete (next as any).openNoteIds
  delete (next as any).activeNoteId
  delete (next as any).tabGroupByNoteId

  if (typeof next.activeTabKey === 'string') {
    const k = String(next.activeTabKey || '').trim()
    if (k && tabKind(k) === 'note' && isDraftNoteId(noteIdFromTabKey(k))) next.activeTabKey = ''
  }
  if (Array.isArray(next.sidebarItems)) {
    next.sidebarItems = ensureSidebarItems({
      sidebarItems: next.sidebarItems,
      openTabKeys: stripDraftTabKeys(next.openTabKeys) as any,
      tabGroups: Array.isArray(next.tabGroups) ? next.tabGroups : [],
      tabGroupByTabKey: stripDraftTabKeyMap(next.tabGroupByTabKey),
    })
  }
  if ('openTabKeys' in next) next.openTabKeys = stripDraftTabKeys(next.openTabKeys)
  if ('tabGroupByTabKey' in next) next.tabGroupByTabKey = stripDraftTabKeyMap(next.tabGroupByTabKey)
  next.currentFolderId = String(next.currentFolderId || '').trim() || 'root'
  next.favoritesNav = normalizeFavoritesNav(next.favoritesNav)

  const sidebarScrollTops = normalizeScrollTops(next.sidebarScrollTops)
  if (Object.keys(sidebarScrollTops).length) next.sidebarScrollTops = sidebarScrollTops
  else delete next.sidebarScrollTops

  const favoritesScrollTops = normalizeScrollTops(next.favoritesScrollTops)
  if (Object.keys(favoritesScrollTops).length) next.favoritesScrollTops = favoritesScrollTops
  else delete next.favoritesScrollTops

  if (Array.isArray(next.workspaces)) {
    next.workspaces = next.workspaces.map(ws => {
      const openTabKeys = stripDraftTabKeys((ws as any).openTabKeys)
      const tabGroupByTabKey = stripDraftTabKeyMap((ws as any).tabGroupByTabKey)
      const sidebarItems = ensureSidebarItems({
        sidebarItems: (ws as any).sidebarItems,
        openTabKeys: openTabKeys as any,
        tabGroups: Array.isArray((ws as any).tabGroups) ? ((ws as any).tabGroups as any) : [],
        tabGroupByTabKey,
      })
      const derived = deriveSidebarFields(sidebarItems)
      let activeTabKey = String((ws as any).activeTabKey || '').trim()
      if (activeTabKey && tabKind(activeTabKey) === 'note' && isDraftNoteId(noteIdFromTabKey(activeTabKey))) activeTabKey = ''
      const id = String((ws as any).id || '').trim() || createWorkspaceId()
      const title = String((ws as any).title || '').trim() || '工作区'
      return {
        id,
        title,
        sidebarItems,
        tabGroups: derived.tabGroups,
        openTabKeys: derived.openTabKeys,
        tabGroupByTabKey: derived.tabGroupByTabKey,
        activeTabKey,
      }
    })
  }

  return next
}

export type RepoStateBootstrapInput = {
  repoId: string
  visible: boolean
  gateway: HyperCortexGateway
  favoritesLedger: FavoritesLedger
  activeWorkspaceId: string
  favoritesNav: HyperCortexFavoritesNavV1
  trashAutoDeleteDaysRef: React.MutableRefObject<number>
  trashAutoDeleteDays: number
  /** 工作区现场应用的装载入口：由中心文件持有实现，装载流程经此回调应用工作区。 */
  applyWorkspaceSidebarStateRef: React.MutableRefObject<(workspace: HyperCortexWorkspaceV1) => void>
  /** 装载完成后恢复激活标签的入口：由中心文件绑定最新实现。 */
  activateExistingTabKeyRef: React.MutableRefObject<(tabKey: string, opts?: { recordHistory?: boolean }) => boolean>
  setWorkspaces: React.Dispatch<React.SetStateAction<HyperCortexWorkspaceV1[]>>
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string>>
  setCurrentFolderId: React.Dispatch<React.SetStateAction<string>>
  setFavoritesNav: React.Dispatch<React.SetStateAction<HyperCortexFavoritesNavV1>>
  setFavoritesDoc: React.Dispatch<React.SetStateAction<HyperCortexFavoritesDocV1 | null>>
  setAssetPoolIndex: React.Dispatch<React.SetStateAction<Record<string, any> | null>>
}

export type RepoStateBootstrap = {
  repoReady: boolean
  repoReadyRef: React.MutableRefObject<boolean>
  tabsInitReady: boolean
  workspaceInitError: string | null
  workspaceInitRetrying: boolean
  runRepoInitialization: () => Promise<void>
  persistRepoStatePatch: (patch: RepoStatePatch) => Promise<void>
  sidebarScrollTopsRef: React.MutableRefObject<Record<string, number>>
  favoritesScrollTopsRef: React.MutableRefObject<Record<string, number>>
  handleSidebarScrollTopChange: (scrollTop: number) => void
  handleFavoritesScrollTopChange: (scrollTop: number) => void
  flushSidebarScrollTop: () => void
  clearSidebarScrollMemory: (key: string) => void
  clearFavoritesScrollMemory: (key: string) => void
  sidebarScrollRestoreSignal: number
  favoritesScrollRestoreSignal: number
  activeWorkspaceIdRef: React.MutableRefObject<string>
  favoritesNavRef: React.MutableRefObject<HyperCortexFavoritesNavV1>
}

export function useRepoStateBootstrap(opts: RepoStateBootstrapInput): RepoStateBootstrap {
  const {
    repoId,
    visible,
    gateway,
    favoritesLedger,
    activeWorkspaceId,
    favoritesNav,
    trashAutoDeleteDaysRef,
    trashAutoDeleteDays,
    applyWorkspaceSidebarStateRef,
    activateExistingTabKeyRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setCurrentFolderId,
    setFavoritesNav,
    setFavoritesDoc,
    setAssetPoolIndex,
  } = opts

  // ---- 现场装载（每个仓库只装载一次；切换回来直接复用内存现场）
  const repoStateRef = React.useRef<HyperCortexRepoStateV1 | null>(null)
  // 侧边栏滚动浏览位置（标识 → 像素）：内存实时记账，随仓库状态写盘持久化。左右两栏共用同一记账机制。
  const sidebarScrollTopsRef = React.useRef<Record<string, number>>({})
  const favoritesScrollTopsRef = React.useRef<Record<string, number>>({})
  const [repoReady, setRepoReady] = React.useState(false)
  const repoReadyRef = React.useRef(false)
  const [tabsInitReady, setTabsInitReady] = React.useState(false)
  const tabsInitReadyRef = React.useRef(false)
  const [workspaceInitError, setWorkspaceInitError] = React.useState<string | null>(null)
  const [workspaceInitRetrying, setWorkspaceInitRetrying] = React.useState(false)
  const mountedRef = React.useRef(true)
  const restoreActiveTabKeyRef = React.useRef<string>('')
  const autoCleanupRanForDaysRef = React.useRef<number | null>(null)

  // 当前激活工作区标识与右侧收藏夹导航的「最新值」引用：常驻回调从 ref 读取当前值。
  const activeWorkspaceIdRef = React.useRef('')
  React.useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])
  const favoritesNavRef = React.useRef<HyperCortexFavoritesNavV1>(favoritesNav)
  React.useEffect(() => {
    favoritesNavRef.current = favoritesNav
  }, [favoritesNav])

  React.useEffect(() => {
    repoReadyRef.current = repoReady
  }, [repoReady])
  React.useEffect(() => {
    tabsInitReadyRef.current = tabsInitReady
  }, [tabsInitReady])
  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 仓库状态写回：统一携带侧边栏滚动位置的最新记账，任何一次写盘都持久化最新浏览位置。
  const persistRepoStatePatch = React.useCallback(
    async (patch: RepoStatePatch) => {
      const current = repoStateRef.current || { version: 1 }
      const next: HyperCortexRepoStateV1 = {
        ...current,
        ...patch,
        sidebarScrollTops: { ...sidebarScrollTopsRef.current },
        favoritesScrollTops: { ...favoritesScrollTopsRef.current },
        version: 1,
      }
      const sanitized = sanitizeRepoStateForSave(next)
      repoStateRef.current = sanitized
      await gateway.repoState.saveRepoState('library', sanitized)
    },
    [gateway],
  )

  // 左右两侧边栏共用同一套滚动记忆机制：按标识记账、防抖落盘、切走/卸载冲刷、可见化还原。
  const persistScrollMemory = React.useCallback(() => {
    if (!repoReadyRef.current) return
    void persistRepoStatePatch({}).catch(() => {})
  }, [persistRepoStatePatch])
  const sidebarScrollMemory = useKeyedScrollMemory({ topsRef: sidebarScrollTopsRef, visible, debounceMs: SIDEBAR_SCROLL_SAVE_DEBOUNCE_MS, onPersist: persistScrollMemory })
  const favoritesScrollMemory = useKeyedScrollMemory({ topsRef: favoritesScrollTopsRef, visible, debounceMs: SIDEBAR_SCROLL_SAVE_DEBOUNCE_MS, onPersist: persistScrollMemory })
  const { flush: flushSidebarScrollTop, reset: resetSidebarScrollMemory, clear: clearSidebarScrollMemory, report: reportSidebarScrollTop } = sidebarScrollMemory
  const { reset: resetFavoritesScrollMemory, clear: clearFavoritesScrollMemory, report: reportFavoritesScrollTop } = favoritesScrollMemory
  const sidebarScrollRestoreSignal = sidebarScrollMemory.restoreSignal
  const favoritesScrollRestoreSignal = favoritesScrollMemory.restoreSignal

  const handleSidebarScrollTopChange = React.useCallback(
    (scrollTop: number) => reportSidebarScrollTop(String(activeWorkspaceIdRef.current || '').trim(), scrollTop),
    [reportSidebarScrollTop],
  )
  const handleFavoritesScrollTopChange = React.useCallback(
    (scrollTop: number) => reportFavoritesScrollTop(String(favoritesNavRef.current?.currentFolderId || '').trim(), scrollTop),
    [reportFavoritesScrollTop],
  )

  // applyRepoStateToUi 把仓库工作状态装载为界面现场；返回归一化结果供持久化判断。
  const applyRepoStateToUi = React.useCallback(
    (normalizedRepoState: HyperCortexRepoStateV1) => {
      repoStateRef.current = normalizedRepoState
      resetSidebarScrollMemory(normalizedRepoState.sidebarScrollTops)
      resetFavoritesScrollMemory(normalizedRepoState.favoritesScrollTops)
      setCurrentFolderId(String(normalizedRepoState.currentFolderId || '').trim() || 'root')
      setFavoritesNav(normalizeFavoritesNav(normalizedRepoState.favoritesNav))
      const activeKey = typeof normalizedRepoState.activeTabKey === 'string' ? normalizedRepoState.activeTabKey.trim() : ''
      restoreActiveTabKeyRef.current = activeKey

      const legacyTabsDetected =
        Array.isArray((normalizedRepoState as any).openNoteIds) ||
        typeof (normalizedRepoState as any).activeNoteId === 'string' ||
        ((normalizedRepoState as any).tabGroupByNoteId && typeof (normalizedRepoState as any).tabGroupByNoteId === 'object')
      const v2TabsDetected =
        Array.isArray((normalizedRepoState as any).openTabKeys) ||
        typeof (normalizedRepoState as any).activeTabKey === 'string' ||
        ((normalizedRepoState as any).tabGroupByTabKey && typeof (normalizedRepoState as any).tabGroupByTabKey === 'object') ||
        Array.isArray(normalizedRepoState.workspaces)
      if (legacyTabsDetected && !v2TabsDetected) {
        void gateway.host.toast('检测到旧版标签页数据：当前开发版本已移除迁移逻辑，请重置 HyperCortex 数据后再试')
      }

      let nextWorkspaces = normalizeWorkspaces(normalizedRepoState.workspaces, {
        sidebarItems: normalizedRepoState.sidebarItems,
        openTabKeys: normalizedRepoState.openTabKeys,
        activeTabKey: normalizedRepoState.activeTabKey,
        tabGroups: normalizedRepoState.tabGroups,
        tabGroupByTabKey: normalizedRepoState.tabGroupByTabKey,
      })
      const nextActiveWorkspaceId = normalizeActiveWorkspaceId(normalizedRepoState.activeWorkspaceId, nextWorkspaces)
      let activeWs = nextWorkspaces.find(w => w.id === nextActiveWorkspaceId) || nextWorkspaces[0]

      let didMutateActiveWorkspace = false
      if (activeWs && activeKey) {
        const openKeys = activeWs.openTabKeys
        if (!openKeys.includes(activeKey)) {
          const nextSidebarItems = insertTabAsUngrouped(ensureSidebarItems(activeWs), activeKey, ensureSidebarItems(activeWs).length)
          const nextWs = applySidebarItemsToWorkspace({ ...activeWs, activeTabKey: activeKey }, nextSidebarItems)
          nextWorkspaces = updateWorkspaceById(nextWorkspaces, nextActiveWorkspaceId, () => nextWs)
          activeWs = nextWs
          didMutateActiveWorkspace = true
        }
      }

      activeWorkspaceIdRef.current = nextActiveWorkspaceId
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveWorkspaceId)
      if (activeWs) applyWorkspaceSidebarStateRef.current(activeWs)
      return { nextWorkspaces, nextActiveWorkspaceId, didMutateActiveWorkspace }
    },
    [gateway, resetFavoritesScrollMemory, resetSidebarScrollMemory],
  )

  // 现场装载：激活仓库（骨架与派生索引调和）→ 仓库状态 + 收藏夹 + 附件索引。
  const loadRepoData = React.useCallback(async () => {
    const [normalizedRepoState, nextFavoritesDoc, nextAssetPoolIndex] = await Promise.all([
      gateway.repoState.ensureRepoState('library'),
      favoritesLedger.load(),
      gateway.assets.ensureAssetsIndex('library'),
    ])
    const applied = applyRepoStateToUi(normalizedRepoState)
    setFavoritesDoc(nextFavoritesDoc)
    setAssetPoolIndex(nextAssetPoolIndex as any)
    return { normalizedRepoState, ...applied }
  }, [applyRepoStateToUi, favoritesLedger, gateway])

  // 仓库状态在装载时被归一化（补工作区、补当前标签）时写回，避免每次装载重复归一化。
  const persistRepoStateNormalization = React.useCallback(
    (
      normalizedRepoState: HyperCortexRepoStateV1,
      applied: { nextWorkspaces: HyperCortexWorkspaceV1[]; nextActiveWorkspaceId: string; didMutateActiveWorkspace: boolean },
    ) => {
      const shouldPersist =
        !Array.isArray(normalizedRepoState.workspaces) ||
        normalizedRepoState.activeWorkspaceId !== applied.nextActiveWorkspaceId ||
        applied.didMutateActiveWorkspace
      if (shouldPersist) {
        void persistRepoStatePatch(buildRepoStateSnapshot(applied.nextWorkspaces, applied.nextActiveWorkspaceId)).catch(() => {})
      }
    },
    [persistRepoStatePatch],
  )

  const runRepoInitialization = React.useCallback(async () => {
    setWorkspaceInitError(null)
    setWorkspaceInitRetrying(true)
    repoReadyRef.current = false
    tabsInitReadyRef.current = false
    setRepoReady(false)
    setTabsInitReady(false)
    try {
      await gateway.repos.activateRepo(repoId)
      const { normalizedRepoState, ...applied } = await loadRepoData()
      persistRepoStateNormalization(normalizedRepoState, applied)
      if (!mountedRef.current) return
      tabsInitReadyRef.current = true
      repoReadyRef.current = true
      setTabsInitReady(true)
      setRepoReady(true)
    } catch (e: any) {
      if (!mountedRef.current) return
      const message = String(e?.message || e || '仓库加载失败')
      setWorkspaceInitError(message)
      void gateway.host.toast(message)
    } finally {
      if (mountedRef.current) setWorkspaceInitRetrying(false)
    }
  }, [gateway, loadRepoData, persistRepoStateNormalization, repoId])

  React.useEffect(() => {
    void runRepoInitialization()
  }, [runRepoInitialization])

  React.useEffect(() => {
    if (!repoReady || !tabsInitReady) return
    const targetKey = restoreActiveTabKeyRef.current
    if (!targetKey) return
    restoreActiveTabKeyRef.current = ''
    void activateExistingTabKeyRef.current(targetKey, { recordHistory: false })
  }, [repoReady, tabsInitReady])

  React.useEffect(() => {
    if (!repoReady) return
    const days = trashAutoDeleteDaysRef.current
    if (!(days > 0)) return
    if (autoCleanupRanForDaysRef.current === days) return
    autoCleanupRanForDaysRef.current = days
    void (async () => {
      const result = await gateway.trash.maybeAutoCleanupTrash('library', days).catch(() => null)
      if (!result || !(result.deletedCount > 0)) return
      void gateway.host.toast(`回收站已自动清理 ${result.deletedCount} 项`)
    })()
  }, [gateway, repoReady, trashAutoDeleteDays])

  return {
    repoReady,
    repoReadyRef,
    tabsInitReady,
    workspaceInitError,
    workspaceInitRetrying,
    runRepoInitialization,
    persistRepoStatePatch,
    sidebarScrollTopsRef,
    favoritesScrollTopsRef,
    handleSidebarScrollTopChange,
    handleFavoritesScrollTopChange,
    flushSidebarScrollTop,
    clearSidebarScrollMemory,
    clearFavoritesScrollMemory,
    sidebarScrollRestoreSignal,
    favoritesScrollRestoreSignal,
    activeWorkspaceIdRef,
    favoritesNavRef,
  }
}

export function WorkspaceInitGate(props: { error: string | null; retrying: boolean; onRetry: () => void }) {
  const { error, retrying, onRetry } = props
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 3 }}>
      {error ? (
        <>
          <Typography sx={{ fontSize: 15, fontWeight: 900, color: 'var(--hc-text)' }}>仓库加载失败</Typography>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'var(--hc-text-muted)', textAlign: 'center', maxWidth: 480 }}>
            {error}
          </Typography>
          <Button variant="contained" onClick={onRetry} disabled={retrying} sx={{ borderRadius: 2, textTransform: 'none' }}>
            {retrying ? '重试中…' : '重试'}
          </Button>
        </>
      ) : (
        <>
          <CircularProgress size={22} />
          <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>正在加载仓库…</Typography>
        </>
      )}
    </Box>
  )
}
