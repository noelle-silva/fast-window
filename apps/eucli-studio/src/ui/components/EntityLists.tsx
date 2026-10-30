import * as React from 'react'
import { IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Tooltip, Typography } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { EntityAvatar } from './avatar/EntityAvatar'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'
import { SortableItem, SortableRoot, SortableSection, type SortableItemRenderArgs } from './SortableDnd'
import { useSortableClickGuard } from './useSortableClickGuard'
import { roleDefaultModelRef } from '../../domain/roleModelCandidates'

// 角色 / 工作区列表项：选择器浮层与侧边栏共用同一份渲染，
// 差异只在「哪些算选中」「点选后做什么」以及是否启用整行拖拽排序。

export type EntityListSortable = {
  onMove: (activeId: string, overId: string) => void
}

function sortableRowSx(args: SortableItemRenderArgs | null) {
  if (!args) return SOFT_POPOVER_ITEM_SX
  return [
    SOFT_POPOVER_ITEM_SX,
    {
      cursor: args.isDragging ? 'grabbing' : 'grab',
      opacity: args.isDragging ? 0.6 : 1,
      touchAction: 'pan-y',
    },
  ]
}

function stopPointerPropagation(event: React.PointerEvent) {
  event.stopPropagation()
}

export function RoleList(props: {
  roles: any[]
  isSelected: (roleId: string) => boolean
  onSelect: (roleId: string) => void
  onOpenEditor: (roleId: string) => void
  formatModelRefText: (modelRef: any) => string
  sortable?: EntityListSortable
}) {
  const { roles, isSelected, onSelect, onOpenEditor, formatModelRefText, sortable } = props
  const clickGuard = useSortableClickGuard()
  const roleIds = React.useMemo(
    () => roles.map((role: any) => String(role?.id || '').trim()).filter(Boolean),
    [roles],
  )

  const renderRole = (role: any, dragArgs: SortableItemRenderArgs | null) => {
    const roleId = String(role?.id || '')
    const modelRefText = formatModelRefText(roleDefaultModelRef(role))
    return (
      <ListItemButton
        key={roleId}
        ref={dragArgs?.setNodeRef as any}
        style={dragArgs?.style}
        selected={isSelected(roleId)}
        onClick={() => {
          if (clickGuard.shouldIgnoreClick()) return
          onSelect(roleId)
        }}
        {...(dragArgs?.handleProps || {})}
        sx={sortableRowSx(dragArgs)}
      >
        <ListItemAvatar>
          <EntityAvatar kind="role" image={String(role?.avatarImage || '')} size={42} />
        </ListItemAvatar>
        <ListItemText
          sx={{ minWidth: 0 }}
          primary={
            <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
              {String(role?.name || '')}
            </Typography>
          }
          secondary={
            <Typography variant="caption" color="text.secondary" noWrap>
              {modelRefText || '未配置模型'}
            </Typography>
          }
        />
        <Tooltip title="设置">
          <IconButton
            size="small"
            onPointerDown={stopPointerPropagation}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenEditor(roleId)
            }}
          >
            <SettingsIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </ListItemButton>
    )
  }

  const rows = roles.map((role: any) => {
    const roleId = String(role?.id || '')
    return sortable && roleId ? (
      <SortableItem key={roleId} id={roleId}>
        {(dragArgs) => renderRole(role, dragArgs)}
      </SortableItem>
    ) : (
      renderRole(role, null)
    )
  })
  const list = (
    <List dense sx={SOFT_POPOVER_LIST_SX}>
      {rows}
    </List>
  )
  if (!sortable) return list
  return (
    <SortableRoot onMove={sortable.onMove} onDragStart={clickGuard.onDragStart} onDragStop={clickGuard.onDragStop}>
      <SortableSection items={roleIds}>{list}</SortableSection>
    </SortableRoot>
  )
}

export function WorkspaceList(props: {
  workspaces: any[]
  isSelected: (workspaceId: string) => boolean
  onSelect: (workspaceId: string) => void
  onOpenEditor: (workspaceId: string) => void
  sortable?: EntityListSortable
}) {
  const { workspaces, isSelected, onSelect, onOpenEditor, sortable } = props
  const clickGuard = useSortableClickGuard()
  const workspaceIds = React.useMemo(
    () => workspaces.map((workspace: any) => String(workspace?.id || '').trim()).filter(Boolean),
    [workspaces],
  )

  const renderWorkspace = (workspace: any, dragArgs: SortableItemRenderArgs | null) => {
    const workspaceId = String(workspace?.id || '')
    const directoryCount = Array.isArray(workspace?.directories) ? workspace.directories.length : 0
    return (
      <ListItemButton
        key={workspaceId}
        ref={dragArgs?.setNodeRef as any}
        style={dragArgs?.style}
        selected={isSelected(workspaceId)}
        onClick={() => {
          if (clickGuard.shouldIgnoreClick()) return
          onSelect(workspaceId)
        }}
        {...(dragArgs?.handleProps || {})}
        sx={sortableRowSx(dragArgs)}
      >
        <ListItemAvatar>
          <EntityAvatar kind="workspace" size={28} />
        </ListItemAvatar>
        <ListItemText
          sx={{ minWidth: 0 }}
          primary={
            <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
              {String(workspace?.name || '')}
            </Typography>
          }
          secondary={
            <Typography variant="caption" color="text.secondary" noWrap>
              {directoryCount ? `${directoryCount} 个目录` : '暂未登记目录'}
            </Typography>
          }
        />
        <Tooltip title="设置">
          <IconButton
            size="small"
            onPointerDown={stopPointerPropagation}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenEditor(workspaceId)
            }}
          >
            <SettingsIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </ListItemButton>
    )
  }

  const rows = workspaces.map((workspace: any) => {
    const workspaceId = String(workspace?.id || '')
    return sortable && workspaceId ? (
      <SortableItem key={workspaceId} id={workspaceId}>
        {(dragArgs) => renderWorkspace(workspace, dragArgs)}
      </SortableItem>
    ) : (
      renderWorkspace(workspace, null)
    )
  })
  const list = (
    <List dense sx={SOFT_POPOVER_LIST_SX}>
      {rows}
    </List>
  )
  if (!sortable) return list
  return (
    <SortableRoot onMove={sortable.onMove} onDragStart={clickGuard.onDragStart} onDragStop={clickGuard.onDragStop}>
      <SortableSection items={workspaceIds}>{list}</SortableSection>
    </SortableRoot>
  )
}
