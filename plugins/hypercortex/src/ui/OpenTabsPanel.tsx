import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import type { HyperCortexTabGroupV1, NoteMeta } from '../core'
import { TAB_GROUP_PRESET_COLORS } from './tabGroups'
import { useOpenTabsPointerDnd } from './useOpenTabsPointerDnd'

export type OpenTabsPanelProps = {
  panelWidth: number
  tabsMode: 'manual' | 'hover'
  tabsCollapsed: boolean
  openNoteTabs: NoteMeta[]
  activeNoteId?: string
  workspaces: { id: string; title: string }[]
  activeWorkspaceId: string
  tabGroups: HyperCortexTabGroupV1[]
  tabGroupByNoteId: Record<string, string>
  onToggleTabsCollapsed: () => void
  onToggleTabsMode: () => void
  onSwitchWorkspace: (workspaceId: string) => void
  onCreateWorkspace: (title: string) => void
  onRenameWorkspace: (workspaceId: string, title: string) => void
  onDeleteWorkspace: (workspaceId: string) => void
  onCreateGroup: () => void
  onOpenTab: (tab: NoteMeta) => void
  onCloseTab: (noteId: string) => void
  onAssignTabToGroup: (noteId: string, groupId: string) => void
  onUnassignTabFromGroup: (noteId: string) => void
  onToggleGroupCollapsed: (groupId: string) => void
  onRenameGroup: (groupId: string, title: string) => void
  onSetGroupColor: (groupId: string, color: string) => void
  onDeleteGroupOnly: (groupId: string) => void
  onDeleteGroupAndCloseTabs: (groupId: string) => void
  onReorderOpenTabs: (nextOpenNoteIds: string[]) => void
  onReorderTabGroups: (nextGroupIds: string[]) => void
}

type GroupMenuState = { mouseX: number; mouseY: number; groupId: string } | null

export function OpenTabsPanel(props: OpenTabsPanelProps) {
  const {
    panelWidth,
    tabsMode,
    tabsCollapsed,
    openNoteTabs,
    activeNoteId,
    workspaces,
    activeWorkspaceId,
    tabGroups,
    tabGroupByNoteId,
    onToggleTabsCollapsed,
    onToggleTabsMode,
    onSwitchWorkspace,
    onCreateWorkspace,
    onRenameWorkspace,
    onDeleteWorkspace,
    onCreateGroup,
    onOpenTab,
    onCloseTab,
    onAssignTabToGroup,
    onUnassignTabFromGroup,
    onToggleGroupCollapsed,
    onRenameGroup,
    onSetGroupColor,
    onDeleteGroupOnly,
    onDeleteGroupAndCloseTabs,
    onReorderOpenTabs,
    onReorderTabGroups,
  } = props

  const showTitle = panelWidth > 52
  const disableTopTooltips = tabsMode === 'hover'
  const openNoteIds = React.useMemo(() => openNoteTabs.map(t => t.id), [openNoteTabs])

  const groupById = React.useMemo(() => {
    const out: Record<string, HyperCortexTabGroupV1> = {}
    for (const g of tabGroups) out[g.id] = g
    return out
  }, [tabGroups])

  const grouped = React.useMemo(() => {
    const groupedTabs: Record<string, NoteMeta[]> = {}
    for (const t of openNoteTabs) {
      const gid = String(tabGroupByNoteId[t.id] || '').trim()
      if (gid && groupById[gid]) {
        ;(groupedTabs[gid] || (groupedTabs[gid] = [])).push(t)
      }
    }
    return { groupedTabs }
  }, [groupById, openNoteTabs, tabGroupByNoteId])

  const dnd = useOpenTabsPointerDnd({
    openNoteIds,
    tabGroups,
    tabGroupByNoteId,
    isValidGroupId: (groupId: string) => !!groupById[String(groupId || '').trim()],
    onAssignTabToGroup,
    onUnassignTabFromGroup,
    onReorderOpenTabs,
    onReorderTabGroups,
  })

  const [groupMenu, setGroupMenu] = React.useState<GroupMenuState>(null)
  const [renameState, setRenameState] = React.useState<{ groupId: string; title: string } | null>(null)
  const [workspaceMenuAnchorEl, setWorkspaceMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const [workspaceEditor, setWorkspaceEditor] = React.useState<{ mode: 'create' | 'rename'; title: string } | null>(null)
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = React.useState<{ id: string; title: string } | null>(null)

  const activeWorkspaceTitle = React.useMemo(() => {
    return workspaces.find(w => w.id === activeWorkspaceId)?.title || workspaces[0]?.title || '工作区'
  }, [activeWorkspaceId, workspaces])

  const workspaceMenuOpen = !!workspaceMenuAnchorEl
  const closeWorkspaceMenu = React.useCallback(() => setWorkspaceMenuAnchorEl(null), [])

  const menuGroup = groupMenu ? groupById[groupMenu.groupId] : null
  const menuOpen = !!groupMenu && !!menuGroup

  const closeMenu = React.useCallback(() => setGroupMenu(null), [])

  const requestRename = React.useCallback(
    (groupId: string) => {
      const g = groupById[groupId]
      if (!g) return
      setRenameState({ groupId, title: g.title || '分组' })
    },
    [groupById],
  )

  const renderTabRow = React.useCallback(
    (tab: NoteMeta) => {
      const isActive = activeNoteId === tab.id
      const title = tab.title || '未命名'
      const isDragOver = dnd.dragOverKey === `tab_${tab.id}`
      const isDragging = dnd.draggingKey === `tab_${tab.id}`
      const disableTitleTooltip = tabsMode === 'hover'
      return (
        <Tooltip
          key={tab.id}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
        >
          <Box
            {...dnd.getTabProps(tab.id)}
            role="button"
            tabIndex={0}
            data-tauri-drag-region="false"
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              onOpenTab(tab)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpenTab(tab)
            }}
            sx={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: showTitle ? 1 : 0.75,
              py: 0.6,
              borderRadius: 2,
              userSelect: 'none',
              outline: 'none',
              WebkitAppRegion: 'no-drag',
              cursor: isDragging ? 'grabbing' : 'grab',
              opacity: isDragging ? 0.72 : 1,
              bgcolor: isDragOver ? 'rgba(25,118,210,.10)' : isActive ? 'rgba(25,118,210,.10)' : 'transparent',
              '&:hover': { bgcolor: isDragOver ? 'rgba(25,118,210,.14)' : isActive ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
              '&:focus-visible': { boxShadow: '0 0 0 2px rgba(25,118,210,.32)' },
            }}
          >
            <NotesRoundedIcon fontSize="small" sx={{ color: isActive ? '#1976d2' : 'rgba(0,0,0,.48)' }} />
            {showTitle ? (
              <Typography
                noWrap
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.2,
                  fontWeight: isActive ? 900 : 600,
                  color: isActive ? '#111' : 'rgba(0,0,0,.72)',
                }}
              >
                {title}
              </Typography>
            ) : null}
            {showTitle ? (
              <Tooltip title="关闭" placement="left">
                <IconButton
                  size="small"
                  aria-label={`关闭 ${title}`}
                  data-hc-no-drag="1"
                  onClick={e => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  sx={{
                    color: 'rgba(0,0,0,.42)',
                    '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                  }}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Tooltip>
      )
    },
    [activeNoteId, dnd, onCloseTab, onOpenTab, showTitle, tabsMode],
  )

  const mixedItems = React.useMemo(() => {
    type Item = { type: 'tab'; tab: NoteMeta } | { type: 'group'; groupId: string }
    const out: Item[] = []
    const insertedGroups = new Set<string>()

    for (const t of openNoteTabs) {
      const gid = String(tabGroupByNoteId[t.id] || '').trim()
      if (gid && groupById[gid]) {
        if (insertedGroups.has(gid)) continue
        out.push({ type: 'group', groupId: gid })
        insertedGroups.add(gid)
        continue
      }
      out.push({ type: 'tab', tab: t })
    }

    for (const g of tabGroups) {
      if (insertedGroups.has(g.id)) continue
      out.push({ type: 'group', groupId: g.id })
      insertedGroups.add(g.id)
    }

    return out
  }, [groupById, openNoteTabs, tabGroupByNoteId, tabGroups])

  return (
    <>
      <Box
        sx={{
          px: 0.75,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid rgba(0,0,0,.06)',
        }}
      >
        {panelWidth <= 52 ? (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Tooltip
              title="工作区"
              placement="right"
              disableHoverListener={disableTopTooltips}
              disableFocusListener={disableTopTooltips}
              disableTouchListener={disableTopTooltips}
            >
              <IconButton
                size="small"
                aria-label="选择工作区"
                onClick={e => setWorkspaceMenuAnchorEl(e.currentTarget)}
                sx={{ width: 30, height: 30, borderRadius: 999, color: 'rgba(0,0,0,.58)' }}
              >
                <WorkspacesRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {tabsMode === 'manual' ? (
              <Tooltip
                title={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'}
                placement="right"
                disableHoverListener={disableTopTooltips}
                disableFocusListener={disableTopTooltips}
                disableTouchListener={disableTopTooltips}
              >
                <IconButton size="small" aria-label={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} onClick={onToggleTabsCollapsed}>
                  {tabsCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip
                title="切换到手动展开（挤压）"
                placement="right"
                disableHoverListener={disableTopTooltips}
                disableFocusListener={disableTopTooltips}
                disableTouchListener={disableTopTooltips}
              >
                <IconButton size="small" aria-label="切换侧边栏模式" onClick={onToggleTabsMode} sx={{ color: 'rgba(0,0,0,.58)' }}>
                  <SyncAltRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ) : (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {tabsMode === 'manual' ? (
                <Tooltip
                  title={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'}
                  placement="right"
                  disableHoverListener={disableTopTooltips}
                  disableFocusListener={disableTopTooltips}
                  disableTouchListener={disableTopTooltips}
                >
                  <IconButton size="small" aria-label={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} onClick={onToggleTabsCollapsed}>
                    {tabsCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>

            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
              <Tooltip
                title="工作区"
                placement="right"
                disableHoverListener={disableTopTooltips}
                disableFocusListener={disableTopTooltips}
                disableTouchListener={disableTopTooltips}
              >
                <IconButton
                  size="small"
                  onClick={e => setWorkspaceMenuAnchorEl(e.currentTarget)}
                  aria-label="选择工作区"
                  sx={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    color: 'rgba(0,0,0,.72)',
                    '&:hover': { bgcolor: 'rgba(0,0,0,.04)' },
                  }}
                >
                  <WorkspacesRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>

            <Tooltip
              title="新建分组"
              placement="left"
              disableHoverListener={disableTopTooltips}
              disableFocusListener={disableTopTooltips}
              disableTouchListener={disableTopTooltips}
            >
              <IconButton size="small" aria-label="新建分组" onClick={onCreateGroup} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip
              title={tabsMode === 'manual' ? '切换到悬停展开（覆盖）' : '切换到手动展开（挤压）'}
              placement="left"
              disableHoverListener={disableTopTooltips}
              disableFocusListener={disableTopTooltips}
              disableTouchListener={disableTopTooltips}
            >
              <IconButton size="small" aria-label="切换侧边栏模式" onClick={onToggleTabsMode} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <SyncAltRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      <Box
        {...dnd.containerProps}
        data-tauri-drag-region="false"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          px: 0.5,
          py: 0.75,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
          bgcolor: dnd.dragOverKey === 'container' ? 'rgba(25,118,210,.06)' : 'transparent',
          transition: 'background-color 120ms ease',
          WebkitAppRegion: 'no-drag',
        }}
      >
        {!openNoteTabs.length && !tabGroups.length && showTitle ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'rgba(0,0,0,.42)' }}>还没有打开的笔记</Typography>
        ) : null}

        {mixedItems.map(item => {
          if (item.type === 'tab') return renderTabRow(item.tab)
          const g = groupById[item.groupId]
          if (!g) return null
          const isCollapsed = g.collapsed === true
          const list = grouped.groupedTabs[g.id] || []
          const isDragOver = dnd.dragOverKey === `group_${g.id}`
          const isDragging = dnd.draggingKey === `group_${g.id}`
          const groupTitle = g.title || '分组'
          return (
            <React.Fragment key={`group_${g.id}`}>
              <Box
                {...dnd.getGroupProps(g.id)}
                role="button"
                tabIndex={0}
                data-tauri-drag-region="false"
                onClick={() => {
                  if (dnd.suppressClickRef.current) return
                  onToggleGroupCollapsed(g.id)
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onToggleGroupCollapsed(g.id)
                }}
                onContextMenu={e => {
                  e.preventDefault()
                  setGroupMenu({ mouseX: e.clientX, mouseY: e.clientY, groupId: g.id })
                }}
                sx={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: showTitle ? 1 : 0.75,
                  py: 0.5,
                  borderRadius: 2,
                  userSelect: 'none',
                  outline: 'none',
                  WebkitAppRegion: 'no-drag',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  opacity: isDragging ? 0.78 : 1,
                  bgcolor: g.color,
                  backgroundImage: isDragOver ? 'linear-gradient(0deg, rgba(25,118,210,.10), rgba(25,118,210,.10))' : 'none',
                  '&:hover': { filter: 'brightness(0.985)' },
                  '&:focus-visible': { backgroundImage: 'linear-gradient(0deg, rgba(25,118,210,.14), rgba(25,118,210,.14))' },
                }}
              >
                <ChevronRightRoundedIcon
                  fontSize="small"
                  sx={{ color: 'rgba(0,0,0,.42)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }}
                />
                {showTitle ? (
                  <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.72)' }}>
                    {groupTitle}
                  </Typography>
                ) : null}
                {showTitle ? <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)' }}>{list.length}</Typography> : null}
              </Box>
              {isCollapsed ? null : list.length ? (
                <Box
                  sx={{
                    position: 'relative',
                    pl: showTitle ? 1 : 0.75,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                    py: 0.25,
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      left: 0,
                      top: 2,
                      bottom: 2,
                      width: 3,
                      borderRadius: 2,
                      bgcolor: g.color,
                    },
                  }}
                >
                  {list.map(renderTabRow)}
                </Box>
              ) : null}
            </React.Fragment>
          )
        })}
      </Box>

      <Menu
        open={menuOpen}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={groupMenu ? { top: groupMenu.mouseY, left: groupMenu.mouseX } : undefined}
      >
        <MenuItem
          onClick={() => {
            const gid = groupMenu?.groupId
            closeMenu()
            if (!gid) return
            requestRename(gid)
          }}
        >
          改名…
        </MenuItem>
        <Divider />
        <Box sx={{ px: 1.25, py: 1, display: 'grid', gridTemplateColumns: 'repeat(5, 20px)', gap: 0.75, alignItems: 'center' }}>
          {TAB_GROUP_PRESET_COLORS.map(c => (
            <Box
              key={c}
              role="button"
              tabIndex={0}
              onClick={() => {
                const gid = groupMenu?.groupId
                closeMenu()
                if (!gid) return
                onSetGroupColor(gid, c)
              }}
              onKeyDown={e => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                const gid = groupMenu?.groupId
                closeMenu()
                if (!gid) return
                onSetGroupColor(gid, c)
              }}
              sx={{
                width: 20,
                height: 20,
                borderRadius: 2,
                bgcolor: c,
                cursor: 'pointer',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)',
                '&:hover': { boxShadow: 'inset 0 0 0 2px rgba(25,118,210,.42)' },
              }}
            />
          ))}
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            const gid = groupMenu?.groupId
            closeMenu()
            if (!gid) return
            onDeleteGroupOnly(gid)
          }}
        >
          仅删除分组标签
        </MenuItem>
        <MenuItem
          onClick={() => {
            const gid = groupMenu?.groupId
            closeMenu()
            if (!gid) return
            if (!window.confirm('确定删除这个分组，并关闭它下面的所有标签页吗？')) return
            onDeleteGroupAndCloseTabs(gid)
          }}
          sx={{ color: '#d32f2f' }}
        >
          删除分组并关闭全部标签页
        </MenuItem>
      </Menu>

      <Menu open={workspaceMenuOpen} onClose={closeWorkspaceMenu} anchorEl={workspaceMenuAnchorEl}>
        {workspaces.map(ws => (
          <MenuItem
            key={ws.id}
            selected={ws.id === (activeWorkspaceId || workspaces[0]?.id)}
            onClick={() => {
              closeWorkspaceMenu()
              onSwitchWorkspace(ws.id)
            }}
          >
            {ws.title || '工作区'}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            closeWorkspaceMenu()
            setWorkspaceEditor({ mode: 'rename', title: activeWorkspaceTitle })
          }}
        >
          重命名当前工作区…
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeWorkspaceMenu()
            setWorkspaceEditor({ mode: 'create', title: '' })
          }}
        >
          新建工作区…
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeWorkspaceMenu()
            const wid = activeWorkspaceId || workspaces[0]?.id || ''
            if (!wid) return
            const title = workspaces.find(w => w.id === wid)?.title || '工作区'
            setWorkspaceDeleteTarget({ id: wid, title })
          }}
          disabled={workspaces.length <= 1}
          sx={{ color: '#d32f2f' }}
        >
          删除当前工作区
        </MenuItem>
      </Menu>

      <Dialog open={!!workspaceDeleteTarget} onClose={() => setWorkspaceDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除工作区</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.72)' }}>
            确定删除工作区「{workspaceDeleteTarget?.title || '工作区'}」吗？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorkspaceDeleteTarget(null)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              const state = workspaceDeleteTarget
              if (!state) return
              onDeleteWorkspace(state.id)
              setWorkspaceDeleteTarget(null)
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!workspaceEditor} onClose={() => setWorkspaceEditor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{workspaceEditor?.mode === 'create' ? '新建工作区' : '重命名工作区'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="工作区名称"
            fullWidth
            value={workspaceEditor?.title || ''}
            onChange={e => setWorkspaceEditor(s => (s ? { ...s, title: e.target.value } : s))}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const state = workspaceEditor
              if (!state) return
              const title = String(state.title || '').trim()
              const wid = activeWorkspaceId || workspaces[0]?.id || ''
              if (state.mode === 'rename') {
                if (!wid || !title) return
                onRenameWorkspace(wid, title)
                setWorkspaceEditor(null)
                return
              }
              onCreateWorkspace(title)
              setWorkspaceEditor(null)
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorkspaceEditor(null)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              const state = workspaceEditor
              if (!state) return
              const title = String(state.title || '').trim()
              const wid = activeWorkspaceId || workspaces[0]?.id || ''
              if (state.mode === 'rename') {
                if (!wid || !title) return
                onRenameWorkspace(wid, title)
                setWorkspaceEditor(null)
                return
              }
              onCreateWorkspace(title)
              setWorkspaceEditor(null)
            }}
            disabled={workspaceEditor?.mode === 'rename' && !String(workspaceEditor?.title || '').trim()}
          >
            确定
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!renameState} onClose={() => setRenameState(null)} maxWidth="xs" fullWidth>
        <DialogTitle>重命名分组</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="分组名称"
            fullWidth
            value={renameState?.title || ''}
            onChange={e => setRenameState(s => (s ? { ...s, title: e.target.value } : s))}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const state = renameState
              if (!state) return
              const title = String(state.title || '').trim()
              if (!title) return
              onRenameGroup(state.groupId, title)
              setRenameState(null)
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameState(null)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              const state = renameState
              if (!state) return
              const title = String(state.title || '').trim()
              if (!title) return
              onRenameGroup(state.groupId, title)
              setRenameState(null)
            }}
          >
            确定
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
