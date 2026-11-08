import * as React from 'react'
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import SettingsIcon from '@mui/icons-material/Settings'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import { colorMixVar } from '../../colorThemeStyles'
import { workspaceIconImageSrc } from '../../../domain/workspaceIcon'
import { EntityAvatar } from '../avatar/EntityAvatar'
import { SortableItem, SortableRoot, SortableSection } from '../SortableDnd'
import { useSortableClickGuard } from '../useSortableClickGuard'

// 侧边栏 B 的工作区列表：行高、行内边距、圆角、图标槽、隐藏滚动条这一套取值
// 照搬 apps/hypercortex 的工作区侧边栏（SIDEBAR_ROW_HEIGHT 40 / px1 / py .6 / gap .75 / radius 2）。
// 排序沿用项目既有 SortableRoot + SortableItem 机制，落库走工作区顺序动作。
const ROW_HEIGHT = 40
const ICON_SIZE = 18

const LIST_SX = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { width: 0, height: 0 },
  px: 0.5,
  py: 0.75,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.25,
}

function WorkspaceBRow(props: {
  workspace: any
  active: boolean
  dragArgs: { setNodeRef: (node: HTMLElement | null) => void; handleProps: Record<string, any>; isDragging: boolean; style: React.CSSProperties } | null
  shouldIgnoreClick: () => boolean
  onSelect: (workspaceId: string) => void
  onOpenEditor: (workspaceId: string) => void
}) {
  const { workspace, active, dragArgs, shouldIgnoreClick, onSelect, onOpenEditor } = props
  const workspaceId = String(workspace?.id || '')
  const title = String(workspace?.name || '') || '未命名工作区'
  const dragging = !!dragArgs?.isDragging

  return (
    <Box
      ref={dragArgs?.setNodeRef as any}
      style={dragArgs?.style}
      role="button"
      tabIndex={0}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(workspaceId)
      }}
      onClick={() => {
        if (shouldIgnoreClick()) return
        onSelect(workspaceId)
      }}
      {...(dragArgs?.handleProps || {})}
      sx={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        minHeight: ROW_HEIGHT,
        py: 0.6,
        boxSizing: 'border-box',
        borderRadius: 2,
        userSelect: 'none',
        outline: 'none',
        cursor: dragging ? 'grabbing' : dragArgs ? 'grab' : 'pointer',
        touchAction: dragArgs ? 'none' : undefined,
        opacity: dragging ? 0.72 : 1,
        bgcolor: active ? colorMixVar('--studio-primary', 10) : 'transparent',
        '&:hover': { bgcolor: colorMixVar('--studio-primary', active ? 14 : 6) },
        '&:focus-visible': { boxShadow: '0 10px 24px rgba(15,23,42,.14)' },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
        }}
      >
        <EntityAvatar kind="workspace" image={workspaceIconImageSrc(workspace?.icon)} size={ICON_SIZE} />
      </Box>

      <Typography
        noWrap
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          lineHeight: 1.2,
          fontWeight: active ? 900 : 600,
          color: active ? 'text.primary' : 'text.secondary',
        }}
      >
        {title}
      </Typography>

      <Tooltip title="设置">
        <IconButton
          size="small"
          aria-label={`设置 ${title}`}
          data-no-drag="1"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onOpenEditor(workspaceId)
          }}
          sx={{ color: active ? 'primary.main' : 'text.disabled', '&:hover': { bgcolor: 'transparent', color: 'text.primary' } }}
        >
          <SettingsIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

export type WorkspaceBListProps = {
  workspaces: any[]
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  openPluginSettings: (tab: any) => void
  onSelectWorkspace: (workspaceId: string) => void
  onOpenWorkspaceEditor: (workspaceId: string) => void
  onMoveWorkspace: (activeId: string, overId: string) => void
}

export function WorkspaceBList(props: WorkspaceBListProps) {
  const { workspaces, activeWorkspaceId, activeTargetKind, openPluginSettings, onSelectWorkspace, onOpenWorkspaceEditor, onMoveWorkspace } = props
  const clickGuard = useSortableClickGuard()
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null)
  const ids = React.useMemo(
    () => workspaces.map((workspace: any) => String(workspace?.id || '').trim()).filter(Boolean),
    [workspaces],
  )

  const header = (
    <Box sx={{ px: 0.75, py: 0.5, display: 'flex', alignItems: 'center' }}>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        <Tooltip title="选择工作区">
          <IconButton
            size="small"
            aria-label="选择工作区"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            sx={{ width: 30, height: 30, borderRadius: 999, color: 'text.secondary', '&:hover': { bgcolor: colorMixVar('--studio-primary', 8) } }}
          >
            <WorkspacesRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Tooltip title="新建工作区">
        <IconButton
          size="small"
          aria-label="新建工作区"
          onClick={() => openPluginSettings('workspaces')}
          sx={{ color: 'text.secondary' }}
        >
          <AddRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const rows = workspaces.map((workspace: any) => {
    const workspaceId = String(workspace?.id || '')
    const active = workspaceId === activeWorkspaceId && activeTargetKind === 'workspace'
    return workspaceId ? (
      <SortableItem key={workspaceId} id={workspaceId}>
        {(dragArgs) => (
          <WorkspaceBRow
            workspace={workspace}
            active={active}
            dragArgs={dragArgs}
            shouldIgnoreClick={clickGuard.shouldIgnoreClick}
            onSelect={onSelectWorkspace}
            onOpenEditor={onOpenWorkspaceEditor}
          />
        )}
      </SortableItem>
    ) : (
      <WorkspaceBRow
        key={`ws_${String(workspace?.name || '')}`}
        workspace={workspace}
        active={active}
        dragArgs={null}
        shouldIgnoreClick={clickGuard.shouldIgnoreClick}
        onSelect={onSelectWorkspace}
        onOpenEditor={onOpenWorkspaceEditor}
      />
    )
  })

  return (
    <>
      {header}

      <Box sx={LIST_SX}>
        {workspaces.length ? (
          <SortableRoot onMove={onMoveWorkspace} onDragStart={clickGuard.onDragStart} onDragStop={clickGuard.onDragStop}>
            <SortableSection items={ids}>{rows}</SortableSection>
          </SortableRoot>
        ) : (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'text.disabled' }}>还没有工作区</Typography>
        )}
      </Box>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        {workspaces.length ? (
          workspaces.map((workspace: any) => {
            const workspaceId = String(workspace?.id || '')
            const active = workspaceId === activeWorkspaceId && activeTargetKind === 'workspace'
            return (
              <MenuItem
                key={workspaceId}
                selected={active}
                onClick={() => {
                  setMenuAnchor(null)
                  onSelectWorkspace(workspaceId)
                }}
                sx={{ fontSize: 13, gap: 1, minWidth: 180 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13 }}>
                    {String(workspace?.name || '') || '未命名工作区'}
                  </Typography>
                </Box>
                {active ? <CheckRoundedIcon sx={{ fontSize: 16 }} /> : null}
              </MenuItem>
            )
          })
        ) : (
          <MenuItem disabled sx={{ fontSize: 13 }}>
            还没有工作区
          </MenuItem>
        )}
      </Menu>
    </>
  )
}
