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
import type { HyperCortexTabGroupV1, NoteMeta } from '../core'
import { TAB_GROUP_PRESET_COLORS } from './tabGroups'

export type OpenTabsPanelProps = {
  panelWidth: number
  tabsMode: 'manual' | 'hover'
  tabsCollapsed: boolean
  openNoteTabs: NoteMeta[]
  activeNoteId?: string
  tabGroups: HyperCortexTabGroupV1[]
  tabGroupByNoteId: Record<string, string>
  onToggleTabsCollapsed: () => void
  onToggleTabsMode: () => void
  onCreateGroup: () => void
  onOpenTab: (tab: NoteMeta) => void
  onCloseTab: (noteId: string) => void
  onAssignTabToGroup: (noteId: string, groupId: string) => void
  onToggleGroupCollapsed: (groupId: string) => void
  onRenameGroup: (groupId: string, title: string) => void
  onSetGroupColor: (groupId: string, color: string) => void
  onDeleteGroupOnly: (groupId: string) => void
  onDeleteGroupAndCloseTabs: (groupId: string) => void
}

type GroupMenuState = { mouseX: number; mouseY: number; groupId: string } | null

function normalizeDraggedNoteId(e: React.DragEvent): string {
  const dt = e.dataTransfer
  const a = String(dt.getData('application/x-hc-note-id') || '').trim()
  if (a) return a
  return String(dt.getData('text/plain') || '').trim()
}

export function OpenTabsPanel(props: OpenTabsPanelProps) {
  const {
    panelWidth,
    tabsMode,
    tabsCollapsed,
    openNoteTabs,
    activeNoteId,
    tabGroups,
    tabGroupByNoteId,
    onToggleTabsCollapsed,
    onToggleTabsMode,
    onCreateGroup,
    onOpenTab,
    onCloseTab,
    onAssignTabToGroup,
    onToggleGroupCollapsed,
    onRenameGroup,
    onSetGroupColor,
    onDeleteGroupOnly,
    onDeleteGroupAndCloseTabs,
  } = props

  const showTitle = panelWidth > 52

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

  const [dragOverGroupId, setDragOverGroupId] = React.useState<string>('')
  const [groupMenu, setGroupMenu] = React.useState<GroupMenuState>(null)
  const [renameState, setRenameState] = React.useState<{ groupId: string; title: string } | null>(null)

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
      return (
        <Tooltip key={tab.id} title={!showTitle ? title : ''} placement="right" disableHoverListener={showTitle}>
          <Box
            role="button"
            tabIndex={0}
            draggable
            onDragStart={e => {
              try {
                e.dataTransfer.setData('application/x-hc-note-id', tab.id)
                e.dataTransfer.setData('text/plain', tab.id)
                e.dataTransfer.effectAllowed = 'move'
              } catch {
              }
            }}
            onClick={() => onOpenTab(tab)}
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
              cursor: 'pointer',
              userSelect: 'none',
              outline: 'none',
              bgcolor: isActive ? 'rgba(25,118,210,.10)' : 'transparent',
              '&:hover': { bgcolor: isActive ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
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
    [activeNoteId, onCloseTab, onOpenTab, showTitle],
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
          tabsMode === 'manual' ? (
            <Tooltip title={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} placement="right">
              <IconButton size="small" aria-label={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} onClick={onToggleTabsCollapsed} sx={{ mx: 'auto' }}>
                {tabsCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="切换到手动展开（挤压）" placement="right">
              <IconButton size="small" aria-label="切换侧边栏模式" onClick={onToggleTabsMode} sx={{ mx: 'auto', color: 'rgba(0,0,0,.58)' }}>
                <SyncAltRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )
        ) : (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {tabsMode === 'manual' ? (
                <Tooltip title={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} placement="right">
                  <IconButton size="small" aria-label={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} onClick={onToggleTabsCollapsed}>
                    {tabsCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              ) : null}
            </Box>

            <Box sx={{ flex: 1 }} />

            <Tooltip title="新建分组" placement="left">
              <IconButton size="small" aria-label="新建分组" onClick={onCreateGroup} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={tabsMode === 'manual' ? '切换到悬停展开（覆盖）' : '切换到手动展开（挤压）'} placement="left">
              <IconButton size="small" aria-label="切换侧边栏模式" onClick={onToggleTabsMode} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <SyncAltRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 0.5, py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {!openNoteTabs.length && !tabGroups.length && showTitle ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'rgba(0,0,0,.42)' }}>还没有打开的笔记</Typography>
        ) : null}

        {mixedItems.map(item => {
          if (item.type === 'tab') return renderTabRow(item.tab)
          const g = groupById[item.groupId]
          if (!g) return null
          const isCollapsed = g.collapsed === true
          const list = grouped.groupedTabs[g.id] || []
          const isDragOver = dragOverGroupId === g.id
          const groupTitle = g.title || '分组'
          return (
            <React.Fragment key={`group_${g.id}`}>
              <Tooltip title={!showTitle ? groupTitle : ''} placement="right" disableHoverListener={showTitle}>
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggleGroupCollapsed(g.id)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    onToggleGroupCollapsed(g.id)
                  }}
                  onContextMenu={e => {
                    e.preventDefault()
                    setGroupMenu({ mouseX: e.clientX, mouseY: e.clientY, groupId: g.id })
                  }}
                  onDragOver={e => {
                    e.preventDefault()
                    setDragOverGroupId(g.id)
                    try {
                      e.dataTransfer.dropEffect = 'move'
                    } catch {
                    }
                  }}
                  onDragLeave={() => setDragOverGroupId(prev => (prev === g.id ? '' : prev))}
                  onDrop={e => {
                    e.preventDefault()
                    const noteId = normalizeDraggedNoteId(e)
                    setDragOverGroupId('')
                    if (!noteId) return
                    onAssignTabToGroup(noteId, g.id)
                  }}
                  sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: showTitle ? 1 : 0.75,
                    py: 0.5,
                    borderRadius: 2,
                    cursor: 'pointer',
                    userSelect: 'none',
                    outline: 'none',
                    bgcolor: isDragOver ? 'rgba(25,118,210,.10)' : 'rgba(0,0,0,.02)',
                    '&:hover': { bgcolor: isDragOver ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
                    '&:focus-visible': { boxShadow: '0 0 0 2px rgba(25,118,210,.24)' },
                  }}
                >
                  <ChevronRightRoundedIcon
                    fontSize="small"
                    sx={{ color: 'rgba(0,0,0,.42)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }}
                  />
                  <Box sx={{ width: 10, height: 10, borderRadius: 2, bgcolor: g.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
                  {showTitle ? (
                    <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.72)' }}>
                      {groupTitle}
                    </Typography>
                  ) : null}
                  {showTitle ? <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)' }}>{list.length}</Typography> : null}
                </Box>
              </Tooltip>
              {isCollapsed ? null : list.map(renderTabRow)}
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

      <Dialog
        open={!!renameState}
        onClose={() => setRenameState(null)}
        maxWidth="xs"
        fullWidth
      >
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
