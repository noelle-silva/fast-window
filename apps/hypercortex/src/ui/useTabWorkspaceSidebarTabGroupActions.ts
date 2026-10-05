import * as React from 'react'
import { type HyperCortexTabGroupV1, type HyperCortexWorkspaceV1 } from '../core'
import { createTabGroupId, pickNextTabGroupColor, pickNextTabGroupTitle } from './tabGroups'
import {
  createGroupInSidebar,
  deleteGroupFromSidebar,
  insertTabAsUngrouped,
  moveTabBetweenGroups,
  updateSidebarGroup,
  type SidebarItem,
} from './sidebarModel'

// 动作段·标签分组：分组新建、全部折叠、标签归组与移出、分组折叠改名改色、仅删除分组。
// 侧边栏条目写入经显式入参 updateSidebarItems 消费工作区动作段，不引入隐式全局。

export function useTabWorkspaceSidebarTabGroupActions(opts: {
  updateSidebarItems: (
    updater: (prev: SidebarItem[]) => SidebarItem[],
    patch?: Partial<Pick<HyperCortexWorkspaceV1, 'activeTabKey' | 'title'>>,
  ) => void
  tabGroupingRef: React.MutableRefObject<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>
}): {
  handleCreateTabGroup: () => void
  handleCollapseAllGroups: () => void
  handleAssignTabToGroup: (tabKey: string, groupId: string) => void
  handleUnassignTabFromGroup: (tabKey: string) => void
  handleToggleGroupCollapsed: (groupId: string) => void
  handleRenameGroup: (groupId: string, title: string) => void
  handleSetGroupColor: (groupId: string, color: string) => void
  handleDeleteGroupOnly: (groupId: string) => void
} {
  const { updateSidebarItems, tabGroupingRef } = opts

  const handleCreateTabGroup = React.useCallback(() => {
    const nextGroup: HyperCortexTabGroupV1 = {
      id: createTabGroupId(),
      title: pickNextTabGroupTitle(tabGroupingRef.current.groups),
      color: pickNextTabGroupColor(tabGroupingRef.current.groups),
      collapsed: false,
    }
    updateSidebarItems(prev => createGroupInSidebar(prev, nextGroup))
  }, [updateSidebarItems, tabGroupingRef])

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
