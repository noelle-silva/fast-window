import * as React from 'react'
import { IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Tooltip, Typography, type SxProps, type Theme } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { EntityAvatar } from './avatar/EntityAvatar'
import { workspaceIconImageSrc } from '../../domain/workspaceIcon'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'
import { SortableItem, SortableRoot, SortableSection, type SortableItemRenderArgs } from './SortableDnd'
import { useSortableClickGuard } from './useSortableClickGuard'
import { roleDefaultModelRef } from '../../domain/roleModelCandidates'
import { workspaceUnavailableDirectoryCount } from '../../domain/workspaceHealth'

// 角色 / 工作区列表项：选择器浮层与侧边栏共用同一份渲染，
// 差异只在「哪些算选中」「点选后做什么」以及是否启用整行拖拽排序。

// 列表行头像尺寸：角色行与工作区行同尺寸，浮层与侧边栏共用。
const ENTITY_ROW_AVATAR_SIZE = 42

export type EntityListSortable = {
  onMove: (activeId: string, overId: string) => void
}

// 条目样式 = 浮层共用样式 + 调用方的覆盖（侧边栏用它收小圆角）+ 拖拽态。
// MUI 的 SxProps 对嵌套数组的类型推断很挑剔，这里按运行时允许的形状组装后统一收口。
function sortableRowSx(args: SortableItemRenderArgs | null, itemSx?: SxProps<Theme>): SxProps<Theme> {
  const parts: unknown[] = [SOFT_POPOVER_ITEM_SX]
  if (itemSx) parts.push(itemSx)
  if (args) {
    parts.push({
      cursor: args.isDragging ? 'grabbing' : 'grab',
      opacity: args.isDragging ? 0.6 : 1,
      touchAction: 'pan-y',
    })
  }
  return parts as SxProps<Theme>
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
  /** 条目样式覆盖：侧边栏用它把圆角收小，浮层沿用默认。 */
  itemSx?: SxProps<Theme>
}) {
  const { roles, isSelected, onSelect, onOpenEditor, formatModelRefText, sortable, itemSx } = props
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
        sx={sortableRowSx(dragArgs, itemSx)}
      >
        <ListItemAvatar>
          <EntityAvatar kind="role" image={String(role?.avatarImage || '')} size={ENTITY_ROW_AVATAR_SIZE} />
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
  /** 条目样式覆盖：侧边栏用它把圆角收小，浮层沿用默认。 */
  itemSx?: SxProps<Theme>
}) {
  const { workspaces, isSelected, onSelect, onOpenEditor, sortable, itemSx } = props
  const clickGuard = useSortableClickGuard()
  const workspaceIds = React.useMemo(
    () => workspaces.map((workspace: any) => String(workspace?.id || '').trim()).filter(Boolean),
    [workspaces],
  )

  const renderWorkspace = (workspace: any, dragArgs: SortableItemRenderArgs | null) => {
    const workspaceId = String(workspace?.id || '')
    const directoryCount = Array.isArray(workspace?.directories) ? workspace.directories.length : 0
    const unavailableDirectoryCount = workspaceUnavailableDirectoryCount(workspace)
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
        sx={sortableRowSx(dragArgs, itemSx)}
      >
        <ListItemAvatar>
          <EntityAvatar kind="workspace" image={workspaceIconImageSrc(workspace?.icon)} size={ENTITY_ROW_AVATAR_SIZE} />
        </ListItemAvatar>
        <ListItemText
          sx={{ minWidth: 0 }}
          primary={
            <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
              {String(workspace?.name || '')}
            </Typography>
          }
          secondary={
            <Typography variant="caption" color={unavailableDirectoryCount ? 'error' : 'text.secondary'} noWrap>
              {directoryCount
                ? `${directoryCount} 个目录${unavailableDirectoryCount ? ` · ${unavailableDirectoryCount} 个失效` : ''}`
                : '暂未登记目录'}
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
