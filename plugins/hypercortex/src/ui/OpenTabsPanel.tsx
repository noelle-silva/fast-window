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
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded'
import type { HyperCortexTabGroupV1, NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'
import { assetTabId } from '../assetTypes'
import { pickAssetDisplayName } from '../assetDisplayName'
import { noteIdFromTabKey, noteTabKey, tabKind } from '../tabKey'
import type { SidebarItem } from './sidebarModel'
import { TAB_GROUP_PRESET_COLORS } from './tabGroups'
import { useOpenTabsPointerDnd } from './useOpenTabsPointerDnd'

function DndInsertCursor(props: { pos: 'before' | 'after'; color?: string }) {
  const { pos, color } = props
  const top = pos === 'before' ? 0 : 'auto'
  const bottom = pos === 'after' ? 0 : 'auto'
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left: 10,
        right: 8,
        top,
        bottom,
        height: 2,
        borderRadius: 999,
        bgcolor: color || '#1976d2',
        boxShadow: '0 0 0 2px rgba(255,255,255,.92)',
        pointerEvents: 'none',
      }}
    />
  )
}

function TopLevelDropSlot(props: { index: number; active: boolean }) {
  const { index, active } = props
  return (
    <Box
      data-hc-dnd-top-slot-index={index}
      aria-hidden
      sx={{
        position: 'relative',
        height: 3,
        mx: 0.5,
        borderRadius: 999,
        bgcolor: active ? 'rgba(25,118,210,.08)' : 'transparent',
        transition: 'background-color 120ms ease',
        '&::before': active
          ? {
              content: '""',
              position: 'absolute',
              left: 8,
              right: 8,
              top: 0.5,
              height: 2,
              borderRadius: 999,
              bgcolor: '#1976d2',
              boxShadow: '0 0 0 2px rgba(255,255,255,.92)',
            }
          : undefined,
      }}
    />
  )
}

function GroupDropSlot(props: { groupId: string; index: number; active: boolean; showTitle: boolean }) {
  const { groupId, index, active, showTitle } = props
  return (
    <Box
      data-hc-dnd-group-slot-id={groupId}
      data-hc-dnd-group-slot-index={index}
      aria-hidden
      sx={{
        position: 'relative',
        height: 3,
        ml: showTitle ? 1.5 : 1,
        mr: 0.5,
        borderRadius: 999,
        bgcolor: active ? 'rgba(25,118,210,.08)' : 'transparent',
        transition: 'background-color 120ms ease',
        '&::before': active
          ? {
              content: '""',
              position: 'absolute',
              left: 8,
              right: 8,
              top: 0.5,
              height: 2,
              borderRadius: 999,
              bgcolor: '#1976d2',
              boxShadow: '0 0 0 2px rgba(255,255,255,.92)',
            }
          : undefined,
      }}
    />
  )
}

export type OpenTabsPanelProps = {
  panelWidth: number
  tabsMode: 'manual' | 'hover'
  tabsCollapsed: boolean
  sidebarItems: SidebarItem[]
  openTabKeys: string[]
  activeTabKey?: string
  openNoteTabs: NoteMeta[]
  openAssetTabs?: AssetEntry[]
  isNoteDirty?: (noteId: string) => boolean
  workspaces: { id: string; title: string }[]
  activeWorkspaceId: string
  tabGroups: HyperCortexTabGroupV1[]
  tabGroupByTabKey: Record<string, string>
  onToggleTabsCollapsed: () => void
  onToggleTabsMode: () => void
  onCreateDraftNote: () => void
  onCollapseAllGroups: () => void
  onSwitchWorkspace: (workspaceId: string) => void
  onCreateWorkspace: (title: string) => void
  onRenameWorkspace: (workspaceId: string, title: string) => void
  onDeleteWorkspace: (workspaceId: string) => void
  onCreateGroup: () => void
  onOpenTab: (tab: NoteMeta) => void
  onCloseTab: (noteId: string) => void
  onOpenAssetTab?: (asset: AssetEntry) => void
  onCloseAssetTab?: (tabKey: string) => void
  onAssignTabToGroup: (tabKey: string, groupId: string) => void
  onUnassignTabFromGroup: (tabKey: string) => void
  onToggleGroupCollapsed: (groupId: string) => void
  onRenameGroup: (groupId: string, title: string) => void
  onSetGroupColor: (groupId: string, color: string) => void
  onDeleteGroupOnly: (groupId: string) => void
  onDeleteGroupAndCloseTabs: (groupId: string) => void
  onMoveTabToUngroupedIndex: (tabKey: string, index: number) => void
  onMoveTabToGroupIndex: (tabKey: string, groupId: string, index: number) => void
  onMoveGroupToIndex: (groupId: string, index: number) => void
}

type GroupMenuState = { mouseX: number; mouseY: number; groupId: string } | null

export function OpenTabsPanel(props: OpenTabsPanelProps) {
  const {
    panelWidth,
    tabsMode,
    tabsCollapsed,
    sidebarItems,
    openTabKeys,
    activeTabKey,
    openNoteTabs,
    openAssetTabs,
    isNoteDirty,
    workspaces,
    activeWorkspaceId,
    tabGroups,
    tabGroupByTabKey,
    onToggleTabsCollapsed,
    onToggleTabsMode,
    onCreateDraftNote,
    onCollapseAllGroups,
    onSwitchWorkspace,
    onCreateWorkspace,
    onRenameWorkspace,
    onDeleteWorkspace,
    onCreateGroup,
    onOpenTab,
    onCloseTab,
    onOpenAssetTab,
    onCloseAssetTab,
    onAssignTabToGroup,
    onUnassignTabFromGroup,
    onToggleGroupCollapsed,
    onRenameGroup,
    onSetGroupColor,
    onDeleteGroupOnly,
    onDeleteGroupAndCloseTabs,
    onMoveTabToUngroupedIndex,
    onMoveTabToGroupIndex,
    onMoveGroupToIndex,
  } = props

  const showTitle = panelWidth > 52
  const disableTopTooltips = tabsMode === 'hover'

  const noteById = React.useMemo(() => {
    const out: Record<string, NoteMeta> = {}
    for (const n of openNoteTabs) out[n.id] = n
    return out
  }, [openNoteTabs])

  const noteByTabKey = React.useMemo(() => {
    const out: Record<string, NoteMeta> = {}
    for (const n of openNoteTabs) out[noteTabKey(n.id)] = n
    return out
  }, [openNoteTabs])

  const assetByTabKey = React.useMemo(() => {
    const out: Record<string, AssetEntry> = {}
    for (const a of openAssetTabs || []) out[assetTabId(a)] = a
    return out
  }, [openAssetTabs])

  const groupById = React.useMemo(() => {
    const out: Record<string, HyperCortexTabGroupV1> = {}
    for (const g of tabGroups) out[g.id] = g
    return out
  }, [tabGroups])

  const dnd = useOpenTabsPointerDnd({
    sidebarItems,
    onMoveTabToUngroupedIndex,
    onMoveTabToGroupIndex,
    onMoveGroupToIndex,
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

  const renderNoteMetaRow = React.useCallback(
    (tabKey: string, tab: NoteMeta, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number }) => {
      const isActive = String(activeTabKey || '').trim() === tabKey
      const title = tab.title || '未命名'
      const dirty = !!isNoteDirty?.(tab.id)
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = dnd.draggingKey === `tab_${tabKey}`
      const disableTitleTooltip = tabsMode === 'hover'
      return (
        <Tooltip
          key={tabKey}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
        >
          <Box
            {...dnd.getTabProps(tabKey)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
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
              position: 'relative',
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
            <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
              <NotesRoundedIcon fontSize="small" sx={{ color: isActive ? '#1976d2' : 'rgba(0,0,0,.48)' }} />
              {dirty ? (
                <Box
                  aria-label="未保存改动"
                  sx={{
                    position: 'absolute',
                    left: -1,
                    top: -1,
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    bgcolor: '#f59e0b',
                    boxShadow: '0 0 0 2px #fff',
                  }}
                />
              ) : null}
            </Box>
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
    [activeTabKey, dnd, isNoteDirty, onCloseTab, onOpenTab, showTitle, tabsMode],
  )

  const renderAssetMetaRow = React.useCallback(
    (tabKey: string, asset: AssetEntry, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number }) => {
      const isActive = String(activeTabKey || '').trim() === tabKey
      const title = pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext }) || '附件'
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = dnd.draggingKey === `tab_${tabKey}`
      const disableTitleTooltip = tabsMode === 'hover'
      const iconEl =
        asset.kind === 'image' ? (
          <ImageRoundedIcon fontSize="small" sx={{ color: isActive ? '#1976d2' : 'rgba(0,0,0,.48)' }} />
        ) : asset.kind === 'video' ? (
          <VideoFileRoundedIcon fontSize="small" sx={{ color: isActive ? '#7b1fa2' : 'rgba(0,0,0,.48)' }} />
        ) : (
          <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: isActive ? '#546e7a' : 'rgba(0,0,0,.48)' }} />
        )

      return (
        <Tooltip
          key={tabKey}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
        >
          <Box
            {...dnd.getTabProps(tabKey)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            role="button"
            tabIndex={0}
            data-tauri-drag-region="false"
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              onOpenAssetTab?.(asset)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpenAssetTab?.(asset)
            }}
            sx={{
              position: 'relative',
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
            <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{iconEl}</Box>
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
                    onCloseAssetTab?.(tabKey)
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
    [activeTabKey, dnd, onCloseAssetTab, onOpenAssetTab, showTitle, tabsMode],
  )

  const renderMissingRow = React.useCallback(
    (tabKey: string, kind: 'note' | 'asset', opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number }) => {
      const isActive = String(activeTabKey || '').trim() === tabKey
      const title = kind === 'note' ? '已丢失的笔记' : '已丢失的附件'
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = dnd.draggingKey === `tab_${tabKey}`
      const disableTitleTooltip = tabsMode === 'hover'
      const iconEl =
        kind === 'note' ? (
          <NotesRoundedIcon fontSize="small" sx={{ color: isActive ? '#1976d2' : 'rgba(0,0,0,.48)' }} />
        ) : (
          <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: isActive ? '#546e7a' : 'rgba(0,0,0,.48)' }} />
        )

      return (
        <Tooltip
          key={tabKey}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
        >
          <Box
            {...dnd.getTabProps(tabKey)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            role="button"
            tabIndex={0}
            data-tauri-drag-region="false"
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              if (kind === 'note') return
              return
            }}
            sx={{
              position: 'relative',
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
              opacity: isDragging ? 0.72 : 0.86,
              bgcolor: isDragOver ? 'rgba(25,118,210,.10)' : isActive ? 'rgba(25,118,210,.10)' : 'transparent',
              '&:hover': { bgcolor: isDragOver ? 'rgba(25,118,210,.14)' : isActive ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
              '&:focus-visible': { boxShadow: '0 0 0 2px rgba(25,118,210,.32)' },
            }}
          >
            <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{iconEl}</Box>
            {showTitle ? (
              <Typography
                noWrap
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.2,
                  fontWeight: isActive ? 900 : 600,
                  color: 'rgba(0,0,0,.55)',
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
                    if (kind === 'note') onCloseTab(noteIdFromTabKey(tabKey))
                    else onCloseAssetTab?.(tabKey)
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
    [activeTabKey, dnd, noteIdFromTabKey, onCloseAssetTab, onCloseTab, showTitle, tabsMode],
  )

  const renderTabKeyRow = React.useCallback(
    (tabKey: string, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number }) => {
      const kind = tabKind(tabKey)
      if (kind === 'note') {
        const nid = noteIdFromTabKey(tabKey)
        const meta = (nid && noteById[nid]) || noteByTabKey[tabKey]
        if (!meta) return renderMissingRow(tabKey, 'note', opts)
        return renderNoteMetaRow(tabKey, meta, opts)
      }
      if (kind === 'asset') {
        const asset = assetByTabKey[tabKey]
        if (!asset) return renderMissingRow(tabKey, 'asset', opts)
        return renderAssetMetaRow(tabKey, asset, opts)
      }
      return null
    },
    [assetByTabKey, noteById, noteByTabKey, renderAssetMetaRow, renderMissingRow, renderNoteMetaRow],
  )

  return (
    <>
      <Box
        sx={{
          px: 0.75,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
          borderBottom: 'none',
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
              title="新建笔记"
              placement="left"
              disableHoverListener={disableTopTooltips}
              disableFocusListener={disableTopTooltips}
              disableTouchListener={disableTopTooltips}
            >
              <IconButton size="small" aria-label="新建笔记" onClick={onCreateDraftNote} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip
              title="新建分组"
              placement="left"
              disableHoverListener={disableTopTooltips}
              disableFocusListener={disableTopTooltips}
              disableTouchListener={disableTopTooltips}
            >
              <IconButton size="small" aria-label="新建分组" onClick={onCreateGroup} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <FolderRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip
              title="全部收起分组"
              placement="left"
              disableHoverListener={disableTopTooltips}
              disableFocusListener={disableTopTooltips}
              disableTouchListener={disableTopTooltips}
            >
              <IconButton
                size="small"
                aria-label="全部收起分组"
                onClick={onCollapseAllGroups}
                disabled={tabGroups.length === 0}
                sx={{ color: 'rgba(0,0,0,.58)' }}
              >
                <UnfoldLessRoundedIcon fontSize="small" />
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
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { width: 0, height: 0 },
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
        {!openTabKeys.length && !tabGroups.length && showTitle ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'rgba(0,0,0,.42)' }}>还没有打开的标签页</Typography>
        ) : null}

        <TopLevelDropSlot index={0} active={dnd.dropIndicator.kind === 'top-slot' && dnd.dropIndicator.index === 0} />

        {sidebarItems.map((item, itemIndex) => {
          if (item.type === 'tab') {
            return (
              <React.Fragment key={`tab_${item.tabKey}`}>
                {renderTabKeyRow(item.tabKey, { topIndex: itemIndex })}
                <TopLevelDropSlot index={itemIndex + 1} active={dnd.dropIndicator.kind === 'top-slot' && dnd.dropIndicator.index === itemIndex + 1} />
              </React.Fragment>
            )
          }
          const g = groupById[item.id]
          if (!g) return null
          const isCollapsed = g.collapsed === true
          const list = item.tabKeys || []
          const isDragOver = dnd.dragOverKey === `group_${g.id}`
          const isDragging = dnd.draggingKey === `group_${g.id}`
          const groupTitle = g.title || '分组'
          return (
            <React.Fragment key={`group_${g.id}`}>
              <Box
                {...dnd.getGroupProps(g.id)}
                data-hc-dnd-group-index={itemIndex}
                data-hc-dnd-group-section-index={itemIndex}
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
                  position: 'relative',
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
                  <GroupDropSlot groupId={g.id} index={0} active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === 0} showTitle={showTitle} />
                  {list.map((tabKey, groupTabIndex) => (
                    <React.Fragment key={`${g.id}_${tabKey}`}>
                      {renderTabKeyRow(tabKey, { topIndex: itemIndex, parentGroupId: g.id, groupTabIndex })}
                      <GroupDropSlot
                        groupId={g.id}
                        index={groupTabIndex + 1}
                        active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === groupTabIndex + 1}
                        showTitle={showTitle}
                      />
                    </React.Fragment>
                  ))}
                </Box>
              ) : (
                <GroupDropSlot groupId={g.id} index={0} active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === 0} showTitle={showTitle} />
              )}
              <TopLevelDropSlot index={itemIndex + 1} active={dnd.dropIndicator.kind === 'top-slot' && dnd.dropIndicator.index === itemIndex + 1} />
            </React.Fragment>
          )
        })}
      </Box>

      <Menu
        open={menuOpen}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={groupMenu ? { top: groupMenu.mouseY, left: groupMenu.mouseX } : undefined}
        PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}
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

      <Menu
        open={workspaceMenuOpen}
        onClose={closeWorkspaceMenu}
        anchorEl={workspaceMenuAnchorEl}
        PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}
      >
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

      <Dialog
        open={!!workspaceEditor}
        onClose={() => setWorkspaceEditor(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 7 } }}
      >
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

      <Dialog open={!!renameState} onClose={() => setRenameState(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 7 } }}>
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
