import * as React from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { colorMixVar } from '../colorThemeStyles'
import { TOPBAR_H } from '../appConstants'
import { RoleList, WorkspaceList } from './EntityLists'

// 侧边栏模式：把「角色列表 / 工作区列表」摊开直接点选，替代顶栏里的两个选择按钮。
// - 角色模式：一级直接是角色列表，点角色即选中。
// - 工作区模式：一级是工作区列表，点工作区进入第二层级（该工作区的角色列表），再点角色即选中。
export function ChatSidebar(props: {
  controller: any
  side: 'left' | 'right'
  mode: 'role' | 'workspace'
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  onSplitterPointerMove: (e: React.PointerEvent) => void
  endResize: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  roles: any[]
  workspaces: any[]
  activeRoleId: string
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  formatModelRefText: (modelRef: any) => string
  openPluginSettings: (tab: any) => void
}) {
  const {
    controller,
    side,
    mode,
    width,
    sidebarRef,
    resizing,
    onSplitterPointerDown,
    onSplitterPointerMove,
    endResize,
    topbarOpacity,
    topbarBlur,
    roles,
    workspaces,
    activeRoleId,
    activeWorkspaceId,
    activeTargetKind,
    formatModelRefText,
    openPluginSettings,
  } = props

  // 工作区模式的第二层级开关；切换模式时回到一级。
  const [workspaceRoleLevel, setWorkspaceRoleLevel] = React.useState(false)
  React.useEffect(() => {
    setWorkspaceRoleLevel(false)
  }, [mode])

  const showWorkspaceRoles = mode === 'workspace' && workspaceRoleLevel

  const sectionTitle = (text: string) => (
    <Typography variant="caption" sx={{ fontWeight: 900, px: 1.5, color: 'text.secondary' }}>
      {text}
    </Typography>
  )

  const roleList = (onSelect: (id: string) => void) => (
    roles.length ? (
      <RoleList
        roles={roles}
        isSelected={(id) => id === activeRoleId && activeTargetKind === (mode === 'workspace' ? 'workspace' : 'role')}
        onSelect={onSelect}
        onOpenEditor={(id) => controller.actions.openRoleEditor?.(id)}
        formatModelRefText={formatModelRefText}
      />
    ) : (
      <Box sx={{ px: 1.5, py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          还没有角色。
        </Typography>
        <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings('roles')}>
          去创建角色
        </Button>
      </Box>
    )
  )

  return (
    <Box
      component="nav"
      aria-label="侧边栏"
      ref={sidebarRef}
      sx={{
        position: 'relative',
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        // 顶栏是绝对定位、覆盖在最上层，这里留出顶栏高度，让内容从顶栏下方开始。
        pt: `${TOPBAR_H}px`,
        bgcolor: colorMixVar('--studio-topbar', topbarOpacity),
        backdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
        WebkitBackdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
      }}
    >
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        onPointerDown={onSplitterPointerDown}
        onPointerMove={onSplitterPointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 6,
          zIndex: 2,
          cursor: 'col-resize',
          ...(side === 'left' ? { right: 0 } : { left: 0 }),
          bgcolor: resizing ? 'primary.main' : 'transparent',
          // 悬停延迟出现高亮：鼠标快速掠过不闪，真正停住才亮；移开立即消失。
          transition: 'background-color 120ms ease',
          transitionDelay: '0ms',
          '&:hover': { bgcolor: 'primary.main', transitionDelay: '150ms' },
        }}
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 1 }}>
        {mode === 'role' ? (
          <>
            {sectionTitle('角色')}
            {roleList((id) => controller.actions.setActiveRole(id))}
          </>
        ) : showWorkspaceRoles ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pb: 0.5 }}>
              <Tooltip title="返回工作区列表">
                <IconButton size="small" aria-label="返回工作区列表" onClick={() => setWorkspaceRoleLevel(false)}>
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Typography variant="caption" sx={{ fontWeight: 900, color: 'text.secondary' }}>
                角色
              </Typography>
            </Box>
            {roleList((id) => controller.actions.setWorkspaceRole?.(id))}
          </>
        ) : (
          <>
            {sectionTitle('工作区')}
            {workspaces.length ? (
              <WorkspaceList
                workspaces={workspaces}
                isSelected={(id) => id === activeWorkspaceId && activeTargetKind === 'workspace'}
                onSelect={(id) => {
                  controller.actions.setActiveWorkspace?.(id)
                  setWorkspaceRoleLevel(true)
                }}
                onOpenEditor={(id) => controller.actions.openWorkspaceEditor?.(id)}
              />
            ) : (
              <Box sx={{ px: 1.5, py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  还没有工作区。
                </Typography>
                <Button size="small" variant="contained" sx={{ mt: 1 }} onClick={() => openPluginSettings('workspaces')}>
                  去创建工作区
                </Button>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
