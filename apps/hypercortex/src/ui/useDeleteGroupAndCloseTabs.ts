import * as React from 'react'
import type { SidebarItem } from './sidebarModel'

// 删除分组并关标签：删除分组后把该组内的标签一并关闭。
// 由中心编排的动作组合段在收藏夹动作之后接线。
export function useDeleteGroupAndCloseTabs(opts: {
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
  handleDeleteGroupOnly: (groupId: string) => void
  closeTabKeysDirect: (tabKeys: string[]) => void
}) {
  const { sidebarItemsRef, handleDeleteGroupOnly, closeTabKeysDirect } = opts

  return React.useCallback(
    (groupId: string) => {
      const gid = String(groupId || '').trim()
      if (!gid) return
      const group = sidebarItemsRef.current.find(item => item.type === 'group' && item.id === gid)
      const keysToClose = group && group.type === 'group' ? group.tabKeys.slice() : []
      handleDeleteGroupOnly(gid)
      if (keysToClose.length) closeTabKeysDirect(keysToClose)
    },
    [closeTabKeysDirect, handleDeleteGroupOnly],
  )
}
