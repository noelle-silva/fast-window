import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import { WorkspaceList } from '../EntityLists'
import { SIDEBAR_ITEM_SX } from '../../softPopoverStyles'
import { matchesSearchQuery } from '../../utils/text'
import { SidebarEmptyHint } from './SidebarSection'

// 工作区列表：搜索过滤、空清单与无匹配三种状态都收在这里，
// 与角色列表同一套形状，面板只负责把数据与回调递进来。
export function SidebarWorkspaceList(props: {
  workspaces: any[]
  searchText: string
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  openPluginSettings: (tab: any) => void
  onSelect: (workspaceId: string) => void
  onOpenEditor: (workspaceId: string) => void
  onMove: (activeId: string, overId: string) => void
}) {
  const {
    workspaces,
    searchText,
    activeWorkspaceId,
    activeTargetKind,
    openPluginSettings,
    onSelect,
    onOpenEditor,
    onMove,
  } = props

  const visibleWorkspaces = React.useMemo(
    () => workspaces.filter((workspace: any) => matchesSearchQuery(searchText, [workspace?.name])),
    [workspaces, searchText],
  )

  if (!workspaces.length) {
    return (
      <Box sx={{ px: 1.5, py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          还没有工作区。
        </Typography>
        <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings('workspaces')}>
          去创建工作区
        </Button>
      </Box>
    )
  }

  if (!visibleWorkspaces.length) return <SidebarEmptyHint>没有匹配的工作区。</SidebarEmptyHint>

  return (
    <WorkspaceList
      workspaces={visibleWorkspaces}
      isSelected={(id) => id === activeWorkspaceId && activeTargetKind === 'workspace'}
      onSelect={onSelect}
      onOpenEditor={onOpenEditor}
      sortable={{ onMove }}
      itemSx={SIDEBAR_ITEM_SX}
    />
  )
}
