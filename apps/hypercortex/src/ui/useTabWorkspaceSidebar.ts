import * as React from 'react'
import type { HyperCortexRepoStateV1, HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { AssetEntry } from '../assetTypes'
import type { TabKey } from '../tabKey'
import type { SidebarItem } from './sidebarModel'
import type { PageId } from './workspacePages'
import { useTabWorkspaceSidebarState } from './useTabWorkspaceSidebarState'
import { useTabWorkspaceSidebarWorkspaceActions } from './useTabWorkspaceSidebarWorkspaceActions'
import { useTabWorkspaceSidebarTabGroupActions } from './useTabWorkspaceSidebarTabGroupActions'

// 标签页集合、工作区与侧边栏分组：装配门面。
// 状态段见 useTabWorkspaceSidebarState，动作段按工作区与标签分组拆为
// useTabWorkspaceSidebarWorkspaceActions 与 useTabWorkspaceSidebarTabGroupActions。
// 两段之间只经显式入参连接，不引入隐式全局；对外入口保持不变。

export { useTabWorkspaceSidebarState }

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
    tabGroupingRef,
    ...workspaceOpts
  } = opts

  const {
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
  } = useTabWorkspaceSidebarWorkspaceActions(workspaceOpts)

  const {
    handleCreateTabGroup,
    handleCollapseAllGroups,
    handleAssignTabToGroup,
    handleUnassignTabFromGroup,
    handleToggleGroupCollapsed,
    handleRenameGroup,
    handleSetGroupColor,
    handleDeleteGroupOnly,
  } = useTabWorkspaceSidebarTabGroupActions({ updateSidebarItems, tabGroupingRef })

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
