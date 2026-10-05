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
import { assetRefKeyFromTabKey, noteIdFromTabKey, parseAssetRefKey, tabKind, type TabKey } from '../tabKey'
import { createWorkspaceId, pickNextWorkspaceTitle, updateWorkspaceById } from './workspaces'
import { applyActiveWorkspacePatch, buildRepoStateSnapshot, normalizeOpenTabKeys } from './workspaceModel'
import {
  deriveSidebarFields,
  ensureSidebarItems,
  insertTabAsUngrouped,
  moveGroupToIndex,
  moveTabToGroupIndex,
  type SidebarItem,
} from './sidebarModel'
import type { PageId } from './workspacePages'

// 动作段·工作区：共享的侧边栏写入路径（工作区补丁、侧边栏条目应用与更新、拖拽移动与提交）
// 与工作区生命周期（切换、新建、改名、删除、现场应用）。
// 标签分组的动作经显式入参消费本模块的 updateSidebarItems，不引入隐式全局。

export function useTabWorkspaceSidebarWorkspaceActions(opts: {
  gateway: HyperCortexGateway
  workspaces: HyperCortexWorkspaceV1[]
  setWorkspaces: React.Dispatch<React.SetStateAction<HyperCortexWorkspaceV1[]>>
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string>>
  setOpenTabKeys: React.Dispatch<React.SetStateAction<TabKey[]>>
  setSidebarItems: React.Dispatch<React.SetStateAction<SidebarItem[]>>
  setTabGrouping: React.Dispatch<React.SetStateAction<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
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
  }
}
