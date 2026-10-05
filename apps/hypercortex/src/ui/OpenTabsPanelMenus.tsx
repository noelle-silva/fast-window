import { Box, Menu, MenuItem } from '@mui/material'
import { ContextMenu } from './ContextMenu'
import { TAB_GROUP_PRESET_COLORS } from './tabGroups'
import { menuPaperSx } from './pluginUiStyles'
import { useWorkspaceVisible } from './workspaceVisibility'

export type OpenTabsPanelGroupMenuState = { mouseX: number; mouseY: number; groupId: string } | null

export type OpenTabsPanelGroupContextMenuProps = {
  groupMenu: OpenTabsPanelGroupMenuState
  menuOpen: boolean
  onClose: () => void
  requestRename: (groupId: string) => void
  onSetGroupColor: (groupId: string, color: string) => void
  onDeleteGroupOnly: (groupId: string) => void
  onDeleteGroupAndCloseTabs: (groupId: string) => void
}

// 分组右键菜单：颜色网格作为自定义区段，其余为普通动作。菜单打开时按当前分组即时构建。
export function OpenTabsPanelGroupContextMenu(props: OpenTabsPanelGroupContextMenuProps) {
  const { groupMenu, menuOpen, onClose, requestRename, onSetGroupColor, onDeleteGroupOnly, onDeleteGroupAndCloseTabs } = props
  const workspaceVisible = useWorkspaceVisible()
  const gid = groupMenu?.groupId

  return (
    <ContextMenu
      open={workspaceVisible && menuOpen}
      x={groupMenu?.mouseX ?? 0}
      y={groupMenu?.mouseY ?? 0}
      onClose={onClose}
      items={[
        {
          id: 'rename',
          label: '改名…',
          onSelect: () => {
            if (gid) requestRename(gid)
          },
        },
        {
          id: 'colors',
          render: () => (
            <Box sx={{ px: 1.25, py: 1, display: 'grid', gridTemplateColumns: 'repeat(5, 20px)', gap: 0.75, alignItems: 'center' }}>
              {TAB_GROUP_PRESET_COLORS.map(c => (
                <Box
                  key={c}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (gid) onSetGroupColor(gid, c)
                  }}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    if (gid) onSetGroupColor(gid, c)
                  }}
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: 2,
                    bgcolor: c,
                    cursor: 'pointer',
                    boxShadow: '0 6px 14px rgba(15,23,42,.12)',
                    transition: 'transform 120ms ease, filter 120ms ease',
                    '&:hover': { transform: 'translateY(-1px) scale(1.06)', filter: 'brightness(1.06)' },
                  }}
                />
              ))}
            </Box>
          ),
        },
        {
          id: 'delete-only',
          label: '仅删除分组标签',
          onSelect: () => {
            if (gid) onDeleteGroupOnly(gid)
          },
        },
        {
          id: 'delete-and-close',
          label: '删除分组并关闭全部标签页',
          danger: true,
          onSelect: () => {
            if (!gid) return
            if (!window.confirm('确定删除这个分组，并关闭它下面的所有标签页吗？')) return
            onDeleteGroupAndCloseTabs(gid)
          },
        },
      ]}
    />
  )
}

export type OpenTabsPanelWorkspaceMenuProps = {
  open: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  workspaces: { id: string; title: string }[]
  activeWorkspaceId: string
  onSwitchWorkspace: (workspaceId: string) => void
  onRequestRename: () => void
  onRequestCreate: () => void
  onRequestDelete: () => void
}

export function OpenTabsPanelWorkspaceMenu(props: OpenTabsPanelWorkspaceMenuProps) {
  const {
    open,
    anchorEl,
    onClose,
    workspaces,
    activeWorkspaceId,
    onSwitchWorkspace,
    onRequestRename,
    onRequestCreate,
    onRequestDelete,
  } = props
  const workspaceVisible = useWorkspaceVisible()
  return (
    <Menu
      open={workspaceVisible && open}
      onClose={onClose}
      anchorEl={anchorEl}
      PaperProps={{ sx: menuPaperSx }}
    >
      {workspaces.map(ws => (
        <MenuItem
          key={ws.id}
          selected={ws.id === (activeWorkspaceId || workspaces[0]?.id)}
          onClick={() => {
            onClose()
            onSwitchWorkspace(ws.id)
          }}
        >
          {ws.title || '工作区'}
        </MenuItem>
      ))}
      <MenuItem
        onClick={() => {
          onClose()
          onRequestRename()
        }}
        sx={{ mt: 0.5, bgcolor: 'rgba(15,23,42,.035)' }}
      >
        重命名当前工作区…
      </MenuItem>
      <MenuItem
        onClick={() => {
          onClose()
          onRequestCreate()
        }}
      >
        新建工作区…
      </MenuItem>
      <MenuItem
        onClick={() => {
          onClose()
          onRequestDelete()
        }}
        disabled={workspaces.length <= 1}
        sx={{ color: 'var(--hc-danger)' }}
      >
        删除当前工作区
      </MenuItem>
    </Menu>
  )
}
