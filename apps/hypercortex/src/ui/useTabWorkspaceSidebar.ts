import * as React from 'react'
import {
  kindFromMime,
  mimeFromExt,
  type HyperCortexRepoStateV1,
  type HyperCortexTabGroupV1,
  type HyperCortexWorkspaceV1,
} from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { AssetEntry } from '../assetTypes'
import type { TabsMode } from '../appSettingsModel'
import { assetRefKeyFromTabKey, noteIdFromTabKey, parseAssetRefKey, tabKind, type TabKey } from '../tabKey'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import { createWorkspaceId, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'
import { applyActiveWorkspacePatch, buildRepoStateSnapshot, normalizeOpenTabKeys } from './workspaceModel'
import {
  createGroupInSidebar,
  deleteGroupFromSidebar,
  deriveSidebarFields,
  ensureSidebarItems,
  insertTabAsUngrouped,
  moveGroupToIndex,
  moveTabBetweenGroups,
  moveTabToGroupIndex,
  updateSidebarGroup,
  type SidebarItem,
} from './sidebarModel'
import { resolveSidebarLayout } from './sidebarLayout'
import type { SidebarPreviewTarget } from './sidebar-preview/previewTarget'
import type { PageId } from './workspacePages'

// 标签页集合、工作区与侧边栏分组：打开的标签键与当前激活标签、工作区集合与激活工作区、
// 侧边栏条目与标签分组、工作区切换与新建改名删除、分组新建折叠改名改色删除、
// 侧边栏条目提交与拖拽移动、工作区现场应用、左侧栏悬停与布局状态。
// 中心文件先接状态段（供导航、附件会话、收藏夹与装载消费），待装载与持久化能力齐备后再接动作段。
// 两段之间只经显式入参连接，不引入隐式全局。

export function useTabWorkspaceSidebarState(opts: {
  tabsMode: TabsMode
  tabsCollapsed: boolean
  tabsSidebarWidth: number
  handleSidebarPreviewHover: (target: SidebarPreviewTarget | null) => void
}): {
  openTabKeys: TabKey[]
  setOpenTabKeys: React.Dispatch<React.SetStateAction<TabKey[]>>
  openTabKeysRef: React.MutableRefObject<TabKey[]>
  activeTabKey: TabKey
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  workspaces: HyperCortexWorkspaceV1[]
  setWorkspaces: React.Dispatch<React.SetStateAction<HyperCortexWorkspaceV1[]>>
  activeWorkspaceId: string
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string>>
  sidebarItems: SidebarItem[]
  setSidebarItems: React.Dispatch<React.SetStateAction<SidebarItem[]>>
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
  tabGrouping: { groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }
  setTabGrouping: React.Dispatch<React.SetStateAction<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>>
  tabGroupingRef: React.MutableRefObject<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>
  setTabsHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  sidebarHoverRef: React.MutableRefObject<boolean>
  sidebarShortcutHoldRef: React.MutableRefObject<boolean>
  leftSidebarLayout: ReturnType<typeof resolveSidebarLayout>
  sidebarPanelWidth: number
  onSidebarMouseEnter: () => void
  onSidebarMouseLeave: () => void
} {
  const { tabsMode, tabsCollapsed, tabsSidebarWidth, handleSidebarPreviewHover } = opts

  const [openTabKeys, setOpenTabKeys] = React.useState<TabKey[]>([])
  const openTabKeysRef = React.useRef<TabKey[]>([])
  React.useEffect(() => {
    openTabKeysRef.current = openTabKeys
  }, [openTabKeys])

  const [activeTabKey, setActiveTabKey] = React.useState<TabKey>('')
  const activeTabKeyRef = React.useRef<TabKey>('')
  React.useEffect(() => {
    activeTabKeyRef.current = activeTabKey
  }, [activeTabKey])

  const [workspaces, setWorkspaces] = React.useState<HyperCortexWorkspaceV1[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>('')

  const [sidebarItems, setSidebarItems] = React.useState<SidebarItem[]>([])
  const sidebarItemsRef = React.useRef<SidebarItem[]>([])
  React.useEffect(() => {
    sidebarItemsRef.current = sidebarItems
  }, [sidebarItems])
  const [tabGrouping, setTabGrouping] = React.useState<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>({
    groups: [],
    byTabKey: {},
  })
  const tabGroupingRef = React.useRef(tabGrouping)
  React.useEffect(() => {
    tabGroupingRef.current = tabGrouping
  }, [tabGrouping])

  const [tabsHoverOpen, setTabsHoverOpen] = React.useState(false)
  const sidebarHoverRef = React.useRef(false)
  const sidebarShortcutHoldRef = React.useRef(false)

  const isHoverTabsMode = tabsMode === 'hover'
  const leftSidebarLayout = resolveSidebarLayout({
    mode: tabsMode,
    collapsed: tabsCollapsed,
    hoverOpen: tabsHoverOpen,
    expandedWidth: tabsSidebarWidth,
  })
  const sidebarPanelWidth = leftSidebarLayout.panelWidth

  const onSidebarMouseEnter = React.useCallback(() => {
    sidebarHoverRef.current = true
    if (isHoverTabsMode) setTabsHoverOpen(true)
  }, [isHoverTabsMode])

  const onSidebarMouseLeave = React.useCallback(() => {
    sidebarHoverRef.current = false
    handleSidebarPreviewHover(null)
    if (!isHoverTabsMode) return
    if (sidebarShortcutHoldRef.current) return
    setTabsHoverOpen(false)
  }, [handleSidebarPreviewHover, isHoverTabsMode])

  return {
    openTabKeys,
    setOpenTabKeys,
    openTabKeysRef,
    activeTabKey,
    setActiveTabKey,
    activeTabKeyRef,
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    sidebarItems,
    setSidebarItems,
    sidebarItemsRef,
    tabGrouping,
    setTabGrouping,
    tabGroupingRef,
    setTabsHoverOpen,
    sidebarHoverRef,
    sidebarShortcutHoldRef,
    leftSidebarLayout,
    sidebarPanelWidth,
    onSidebarMouseEnter,
    onSidebarMouseLeave,
  }
}

export function useTabWorkspaceSidebarActions(opts: {
  gateway: HyperCortexGateway
  workspaces: HyperCortexWorkspaceV1[]
  setWorkspaces: React.Dispatch<React.SetStateAction<HyperCortexWorkspaceV1[]>>
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string>>
  setOpenTabKeys: React.Dispatch<React.SetStateAction<TabKey[]>>
  setSidebarItems: React.Dispatch<React.SetStateAction<SidebarItem[]>>
  setTabGrouping: React.Dispatch<React.SetStateAction<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
  tabGroupingRef: React.MutableRefObject<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>
  activeWorkspaceIdRef: React.MutableRefObject<string>
  repoReadyRef: React.MutableRefObject<boolean>
  persistRepoStatePatch: (patch: Partial<HyperCortexRepoStateV1>) => Promise<void>
  flushSidebarScrollTop: () => void
  clearSidebarScrollMemory: (key: string) => void
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
  pageRef: React.MutableRefObject<PageId>
  setDetailSelectionSource: React.Dispatch<React.SetStateAction<'tabs' | 'favorites'>>
  setActiveNoteId: React.Dispatch<React.SetStateAction<string>>
  setOpenNoteIds: React.Dispatch<React.SetStateAction<string[]>>
  setOpenAssetTabs: React.Dispatch<React.SetStateAction<AssetEntry[]>>
  commitActiveWorkspacePatchRef: React.MutableRefObject<(patch: { activeTabKey: string }) => void>
  updateSidebarItemsRef: React.MutableRefObject<
    (
      updater: (prev: SidebarItem[]) => SidebarItem[],
      patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
    ) => void
  >
  applyWorkspaceSidebarStateRef: React.MutableRefObject<(workspace: HyperCortexWorkspaceV1) => void>
}): {
  commitActiveWorkspacePatch: (
    patch: Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'sidebarItems' | 'openTabKeys' | 'activeTabKey' | 'tabGroups' | 'tabGroupByTabKey'>>,
  ) => void
  updateSidebarItems: (
    updater: (prev: SidebarItem[]) => SidebarItem[],
    patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
  ) => { sidebarItems: SidebarItem[]; openTabKeys: string[]; tabGroups: HyperCortexTabGroupV1[]; tabGroupByTabKey: Record<string, string> }
  handleMoveTabToUngroupedIndex: (tabKey: string, index: number) => void
  handleMoveTabToGroupIndex: (tabKey: string, groupId: string, index: number) => void
  handleMoveGroupToIndex: (groupId: string, index: number) => void
  handleCommitSidebarItems: (nextSidebarItems: SidebarItem[]) => void
  handleSwitchWorkspace: (workspaceId: string) => void
  handleCreateWorkspace: (title: string) => void
  handleRenameWorkspace: (workspaceId: string, title: string) => void
  handleDeleteWorkspace: (workspaceId: string) => void
  handleCreateTabGroup: () => void
  handleCollapseAllGroups: () => void
  handleAssignTabToGroup: (tabKey: string, groupId: string) => void
  handleUnassignTabFromGroup: (tabKey: string) => void
  handleToggleGroupCollapsed: (groupId: string) => void
  handleRenameGroup: (groupId: string, title: string) => void
  handleSetGroupColor: (groupId: string, color: string) => void
  handleDeleteGroupOnly: (groupId: string) => void
} {
  const {
    gateway,
    workspaces,
    setWorkspaces,
    setActiveWorkspaceId,
    setOpenTabKeys,
    setSidebarItems,
    setTabGrouping,
    setActiveTabKey,
    sidebarItemsRef,
    tabGroupingRef,
    activeWorkspaceIdRef,
    repoReadyRef,
    persistRepoStatePatch,
    flushSidebarScrollTop,
    clearSidebarScrollMemory,
    navigatePage,
    pageRef,
    setDetailSelectionSource,
    setActiveNoteId,
    setOpenNoteIds,
    setOpenAssetTabs,
    commitActiveWorkspacePatchRef,
    updateSidebarItemsRef,
    applyWorkspaceSidebarStateRef,
  } = opts

  const workspaceSwitchSeqRef = React.useRef(0)

  const commitActiveWorkspacePatch = React.useCallback(
    (patch: Partial<Pick<HyperCortexWorkspaceV1, 'title' | 'sidebarItems' | 'openTabKeys' | 'activeTabKey' | 'tabGroups' | 'tabGroupByTabKey'>>) => {
      setWorkspaces(prev => {
        const wid = activeWorkspaceIdRef.current
        if (!wid) return prev
        const idx = prev.findIndex(w => w.id === wid)
        if (idx < 0) return prev
        const current = prev[idx]
        const nextWs = applyActiveWorkspacePatch(current, patch as any)
        if (nextWs === current) return prev
        const nextList = prev.slice()
        nextList[idx] = nextWs

        if (repoReadyRef.current) {
          void persistRepoStatePatch(buildRepoStateSnapshot(nextList, wid)).catch(() => {})
        }

        return nextList
      })
    },
    [persistRepoStatePatch],
  )

  React.useEffect(() => {
    commitActiveWorkspacePatchRef.current = commitActiveWorkspacePatch
  }, [commitActiveWorkspacePatch])

  const applySidebarState = React.useCallback(
    (nextSidebarItems: SidebarItem[], patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>) => {
      const normalizedSidebarItems = ensureSidebarItems({
        sidebarItems: nextSidebarItems,
        openTabKeys: [],
        tabGroups: [],
        tabGroupByTabKey: {},
      })
      const derived = deriveSidebarFields(normalizedSidebarItems)
      setSidebarItems(normalizedSidebarItems)
      setTabGrouping({ groups: derived.tabGroups, byTabKey: derived.tabGroupByTabKey })
      setOpenTabKeys(derived.openTabKeys as any)
      commitActiveWorkspacePatch({
        sidebarItems: normalizedSidebarItems,
        openTabKeys: derived.openTabKeys,
        tabGroups: derived.tabGroups,
        tabGroupByTabKey: derived.tabGroupByTabKey,
        ...(patch || {}),
      })
      return { sidebarItems: normalizedSidebarItems, ...derived }
    },
    [commitActiveWorkspacePatch],
  )

  const updateSidebarItems = React.useCallback(
    (updater: (prev: SidebarItem[]) => SidebarItem[], patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>) => {
      const nextSidebarItems = updater(sidebarItemsRef.current)
      return applySidebarState(nextSidebarItems, patch)
    },
    [applySidebarState],
  )

  React.useEffect(() => {
    updateSidebarItemsRef.current = updateSidebarItems
  }, [updateSidebarItems])

  const handleMoveTabToUngroupedIndex = React.useCallback(
    (tabKey: string, index: number) => {
      const normalizedTabKey = String(tabKey || '').trim()
      if (!normalizedTabKey) return
      updateSidebarItems(prev => insertTabAsUngrouped(prev, normalizedTabKey, index))
    },
    [updateSidebarItems],
  )

  const handleMoveTabToGroupIndex = React.useCallback(
    (tabKey: string, groupId: string, index: number) => {
      const normalizedTabKey = String(tabKey || '').trim()
      const gid = String(groupId || '').trim()
      if (!normalizedTabKey || !gid) return
      updateSidebarItems(prev => moveTabToGroupIndex(prev, normalizedTabKey, gid, index))
    },
    [updateSidebarItems],
  )

  const handleMoveGroupToIndex = React.useCallback(
    (groupId: string, index: number) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateSidebarItems(prev => moveGroupToIndex(prev, gid, index))
    },
    [updateSidebarItems],
  )

  const handleCommitSidebarItems = React.useCallback(
    (nextSidebarItems: SidebarItem[]) => {
      applySidebarState(nextSidebarItems)
    },
    [applySidebarState],
  )

  const applyWorkspaceSidebarState = React.useCallback(
    (ws: HyperCortexWorkspaceV1) => {
      const nextSidebarItems = ensureSidebarItems(ws)
      const derived = deriveSidebarFields(nextSidebarItems)
      const nextOpenTabKeys = normalizeOpenTabKeys(derived.openTabKeys)
      setSidebarItems(nextSidebarItems)
      setTabGrouping({ groups: derived.tabGroups, byTabKey: derived.tabGroupByTabKey || {} })
      setOpenTabKeys(nextOpenTabKeys as any)

      const preferredActiveKey = String(ws.activeTabKey || '').trim()
      if (preferredActiveKey && nextOpenTabKeys.includes(preferredActiveKey)) {
        setDetailSelectionSource('tabs')
        setActiveTabKey(preferredActiveKey as any)
        if (tabKind(preferredActiveKey) === 'note') setActiveNoteId(noteIdFromTabKey(preferredActiveKey))
        else setActiveNoteId('')
      } else {
        setActiveTabKey('')
        setActiveNoteId('')
      }

      const seq = (workspaceSwitchSeqRef.current += 1)
      if (!nextOpenTabKeys.length) {
        setOpenNoteIds([])
        setOpenAssetTabs([])
      } else {
        const noteKeys = nextOpenTabKeys.filter(k => tabKind(k) === 'note')
        setOpenNoteIds(noteKeys.map(k => noteIdFromTabKey(k)).filter(Boolean))
        void (async () => {
          try {
            const assetKeys = nextOpenTabKeys.filter(k => tabKind(k) === 'asset')
            const aidx = await gateway.assets.ensureAssetsIndex('library').catch(() => ({ version: 1, assets: {} } as any))
            const assetTabs = assetKeys
              .map(k => {
                const refKey = assetRefKeyFromTabKey(k)
                const parsed = parseAssetRefKey(refKey)
                if (!parsed) return null
                const entry = (aidx as any)?.assets?.[refKey]
                const relPath = String(entry?.path || '').trim()
                if (!relPath) return null
                const ext = parsed.ext || ''
                const mime = mimeFromExt(ext)
                const kind0 = String(entry?.kind || '').trim()
                const kind = kind0 || (mime ? kindFromMime(mime) : 'document')
                return {
                  relPath,
                  fileName: refKey,
                  displayName: String(entry?.displayName || '').trim() || undefined,
                  assetId: parsed.assetId,
                  ext,
                  kind: kind || 'document',
                  size: Number(entry?.size || 0) || 0,
                  modifiedMs: Number(entry?.modifiedMs || 0) || 0,
                } as AssetEntry
              })
              .filter(Boolean) as AssetEntry[]

            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenAssetTabs(assetTabs)
          } catch {
            if (workspaceSwitchSeqRef.current !== seq) return
            setOpenAssetTabs([])
          }
        })()
      }

      const currentPage = pageRef.current
      if (currentPage === 'note-detail' || currentPage === 'asset-detail') {
        if (preferredActiveKey && nextOpenTabKeys.includes(preferredActiveKey)) {
          const targetPage = tabKind(preferredActiveKey) === 'asset' ? 'asset-detail' : 'note-detail'
          if (currentPage !== targetPage) navigatePage(targetPage, { recordHistory: false })
        } else {
          navigatePage(currentPage === 'note-detail' ? 'home' : 'attachments', { recordHistory: false })
        }
      }
    },
    [gateway, navigatePage],
  )

  React.useEffect(() => {
    applyWorkspaceSidebarStateRef.current = applyWorkspaceSidebarState
  }, [applyWorkspaceSidebarState])

  const handleSwitchWorkspace = React.useCallback(
    (workspaceId: string) => {
      const wid = String(workspaceId || '').trim()
      if (!wid || wid === activeWorkspaceIdRef.current) return
      const ws = workspaces.find(w => w.id === wid)
      if (!ws) return

      flushSidebarScrollTop()
      activeWorkspaceIdRef.current = wid
      setActiveWorkspaceId(wid)
      applyWorkspaceSidebarState(ws)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(workspaces, wid)).catch(() => {})
      }
    },
    [applyWorkspaceSidebarState, flushSidebarScrollTop, persistRepoStatePatch, workspaces],
  )

  const handleCreateWorkspace = React.useCallback(
    (title: string) => {
      const trimmed = String(title || '').trim()
      const nextTitle = trimmed || pickNextWorkspaceTitle(workspaces)
      const nextWs: HyperCortexWorkspaceV1 = {
        id: createWorkspaceId(),
        title: nextTitle,
        sidebarItems: [],
        tabGroups: [],
        openTabKeys: [],
        tabGroupByTabKey: {},
        activeTabKey: '',
      }
      const nextWorkspaces = [...workspaces, nextWs]

      flushSidebarScrollTop()
      activeWorkspaceIdRef.current = nextWs.id
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextWs.id)
      applyWorkspaceSidebarState(nextWs)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(nextWorkspaces, nextWs.id)).catch(() => {})
      }
      void gateway.host.toast(`已新建工作区：${nextTitle}`)
    },
    [gateway, applyWorkspaceSidebarState, flushSidebarScrollTop, persistRepoStatePatch, workspaces],
  )

  const handleRenameWorkspace = React.useCallback(
    (workspaceId: string, title: string) => {
      const wid = String(workspaceId || '').trim()
      const nextTitle = String(title || '').trim()
      if (!wid || !nextTitle) return
      const nextWorkspaces = updateWorkspaceById(workspaces, wid, ws => ({ ...ws, title: nextTitle }))
      if (nextWorkspaces === workspaces) return
      setWorkspaces(nextWorkspaces)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(nextWorkspaces, activeWorkspaceIdRef.current)).catch(() => {})
      }
    },
    [persistRepoStatePatch, workspaces],
  )

  const handleDeleteWorkspace = React.useCallback(
    (workspaceId: string) => {
      const wid = String(workspaceId || '').trim()
      if (!wid) return
      if (workspaces.length <= 1) return void gateway.host.toast('至少保留一个工作区')
      const target = workspaces.find(w => w.id === wid)
      if (!target) return

      const nextWorkspaces = workspaces.filter(w => w.id !== wid)
      const deletingActive = activeWorkspaceIdRef.current === wid
      const nextActiveId = deletingActive ? nextWorkspaces[0]?.id || '' : activeWorkspaceIdRef.current
      const nextActiveWs = nextWorkspaces.find(w => w.id === nextActiveId) || nextWorkspaces[0]
      if (!nextActiveWs) return

      // 删除工作区时丢弃其滚动记账，并随本次写盘一并落盘。
      clearSidebarScrollMemory(wid)
      flushSidebarScrollTop()

      activeWorkspaceIdRef.current = nextActiveId
      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveId)
      if (deletingActive) applyWorkspaceSidebarState(nextActiveWs)
      if (repoReadyRef.current) {
        void persistRepoStatePatch(buildRepoStateSnapshot(nextWorkspaces, nextActiveId)).catch(() => {})
      }
      void gateway.host.toast(`已删除工作区：${target.title}`)
    },
    [clearSidebarScrollMemory, flushSidebarScrollTop, gateway, applyWorkspaceSidebarState, persistRepoStatePatch, workspaces],
  )

  const handleCreateTabGroup = React.useCallback(() => {
    const nextGroup: HyperCortexTabGroupV1 = {
      id: createTabGroupId(),
      title: pickNextTabGroupTitle(tabGroupingRef.current.groups),
      color: pickNextTabGroupColor(tabGroupingRef.current.groups),
      collapsed: false,
    }
    updateSidebarItems(prev => createGroupInSidebar(prev, nextGroup))
  }, [updateSidebarItems])

  const handleCollapseAllGroups = React.useCallback(() => {
    updateSidebarItems(prev => prev.map(item => (item.type === 'group' && item.collapsed !== true ? { ...item, collapsed: true } : item)))
  }, [updateSidebarItems])

  const handleAssignTabToGroup = React.useCallback(
    (tabKey: string, groupId: string) => {
      const normalizedTabKey = String(tabKey || '').trim()
      const gid = String(groupId || '').trim()
      if (!normalizedTabKey || !gid) return
      updateSidebarItems(prev => moveTabBetweenGroups({ sidebarItems: prev, tabKey: normalizedTabKey, targetGroupId: gid }))
    },
    [updateSidebarItems],
  )

  const handleUnassignTabFromGroup = React.useCallback(
    (tabKey: string) => {
      const normalizedTabKey = String(tabKey || '').trim()
      if (!normalizedTabKey) return
      updateSidebarItems(prev => insertTabAsUngrouped(prev, normalizedTabKey, prev.length))
    },
    [updateSidebarItems],
  )

  const handleToggleGroupCollapsed = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateSidebarItems(prev => prev.map(item => (item.type === 'group' && item.id === gid ? { ...item, collapsed: !item.collapsed } : item)))
    },
    [updateSidebarItems],
  )

  const handleRenameGroup = React.useCallback(
    (groupId: string, title: string) => {
      const gid = String(groupId || '').trim()
      const nextTitle = String(title || '').trim()
      if (!gid || !nextTitle) return
      updateSidebarItems(prev => updateSidebarGroup(prev, gid, { title: nextTitle }))
    },
    [updateSidebarItems],
  )

  const handleSetGroupColor = React.useCallback(
    (groupId: string, color: string) => {
      const gid = String(groupId || '').trim()
      const nextColor = String(color || '').trim()
      if (!gid || !nextColor) return
      updateSidebarItems(prev => updateSidebarGroup(prev, gid, { color: nextColor }))
    },
    [updateSidebarItems],
  )

  const handleDeleteGroupOnly = React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      updateSidebarItems(prev => deleteGroupFromSidebar(prev, gid))
    },
    [updateSidebarItems],
  )

  return {
    commitActiveWorkspacePatch,
    updateSidebarItems,
    handleMoveTabToUngroupedIndex,
    handleMoveTabToGroupIndex,
    handleMoveGroupToIndex,
    handleCommitSidebarItems,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    handleRenameWorkspace,
    handleDeleteWorkspace,
    handleCreateTabGroup,
    handleCollapseAllGroups,
    handleAssignTabToGroup,
    handleUnassignTabFromGroup,
    handleToggleGroupCollapsed,
    handleRenameGroup,
    handleSetGroupColor,
    handleDeleteGroupOnly,
  }
}
