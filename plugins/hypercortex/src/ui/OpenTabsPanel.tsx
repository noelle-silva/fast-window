import * as React from 'react'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
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
import type { HyperCortexSidebarSortModeV1, HyperCortexTabGroupV1, NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'
import { assetTabId } from '../assetTypes'
import { pickAssetDisplayName } from '../assetDisplayName'
import { noteIdFromTabKey, noteTabKey, tabKind } from '../tabKey'
import type { SidebarItem } from './sidebarModel'
import { moveTabInGroupRelative, moveTabToGroupIndex, moveTopLevelItemRelative } from './sidebarModel'
import { TAB_GROUP_PRESET_COLORS } from './tabGroups'
import { SortableItem, SortableRoot, SortableSection, type SortableItemRenderArgs } from './SortableDnd'
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
  sidebarSortMode: HyperCortexSidebarSortModeV1
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
  onCommitSidebarItems: (sidebarItems: SidebarItem[]) => void
  onMoveTabToUngroupedIndex: (tabKey: string, index: number) => void
  onMoveTabToGroupIndex: (tabKey: string, groupId: string, index: number) => void
  onMoveGroupToIndex: (groupId: string, index: number) => void
}

type GroupMenuState = { mouseX: number; mouseY: number; groupId: string } | null
type SortableId = { kind: 'tab'; tabKey: string } | { kind: 'group'; groupId: string }
type SortableTabLocation = { kind: 'top'; itemIndex: number } | { kind: 'group'; groupId: string; tabIndex: number }
type SortableVisualRow = { id: string; parsed: SortableId; location: SortableTabLocation | { kind: 'group'; groupId: string; itemIndex: number } }
type SortableMoveIntent =
  | { kind: 'none' }
  | { kind: 'top-relative'; movingKey: string; targetKey: string; pos: 'before' | 'after' }
  | { kind: 'tab-to-group-start'; tabKey: string; groupId: string }
  | { kind: 'tab-in-group-relative'; groupId: string; tabKey: string; targetTabKey: string; pos: 'before' | 'after' }

function sortableTabId(tabKey: string): string {
  return `tab:${tabKey}`
}

function sortableGroupId(groupId: string): string {
  return `group:${groupId}`
}

function parseSortableId(value: string): SortableId | null {
  const raw = String(value || '').trim()
  if (raw.startsWith('tab:')) {
    const tabKey = raw.slice(4).trim()
    return tabKey ? { kind: 'tab', tabKey } : null
  }
  if (raw.startsWith('group:')) {
    const groupId = raw.slice(6).trim()
    return groupId ? { kind: 'group', groupId } : null
  }
  return null
}

function findSortableTabLocation(sidebarItems: SidebarItem[], tabKey: string): SortableTabLocation | null {
  const key = String(tabKey || '').trim()
  if (!key) return null
  for (let itemIndex = 0; itemIndex < sidebarItems.length; itemIndex += 1) {
    const item = sidebarItems[itemIndex]
    if (item.type === 'tab' && item.tabKey === key) return { kind: 'top', itemIndex }
    if (item.type !== 'group') continue
    const tabIndex = item.tabKeys.indexOf(key)
    if (tabIndex >= 0) return { kind: 'group', groupId: item.id, tabIndex }
  }
  return null
}

function getSortableVisualRows(sidebarItems: SidebarItem[]): SortableVisualRow[] {
  const rows: SortableVisualRow[] = []
  for (let itemIndex = 0; itemIndex < sidebarItems.length; itemIndex += 1) {
    const item = sidebarItems[itemIndex]
    if (item.type === 'tab') {
      rows.push({ id: sortableTabId(item.tabKey), parsed: { kind: 'tab', tabKey: item.tabKey }, location: { kind: 'top', itemIndex } })
      continue
    }
    rows.push({ id: sortableGroupId(item.id), parsed: { kind: 'group', groupId: item.id }, location: { kind: 'group', groupId: item.id, itemIndex } })
    if (item.collapsed === true) continue
    item.tabKeys.forEach((tabKey, tabIndex) => {
      rows.push({ id: sortableTabId(tabKey), parsed: { kind: 'tab', tabKey }, location: { kind: 'group', groupId: item.id, tabIndex } })
    })
  }
  return rows
}

function buildSortableMoveIntent(sidebarItems: SidebarItem[], activeRawId: string, overRawId: string): SortableMoveIntent {
  const active = parseSortableId(activeRawId)
  const over = parseSortableId(overRawId)
  if (!active || !over) return { kind: 'none' }
  if (activeRawId === overRawId) return { kind: 'none' }

  const rows = getSortableVisualRows(sidebarItems)
  const activeIndex = rows.findIndex(row => row.id === activeRawId)
  const overRow = rows.find(row => row.id === overRawId)
  if (activeIndex < 0 || !overRow) return { kind: 'none' }
  const overIndex = rows.indexOf(overRow)
  const pos: 'before' | 'after' = activeIndex < overIndex ? 'after' : 'before'

  if (active.kind === 'group') {
    const overKey = overRow.location.kind === 'group' && 'itemIndex' in overRow.location ? overRow.location.groupId : over.kind === 'group' ? over.groupId : over.tabKey
    return { kind: 'top-relative', movingKey: active.groupId, targetKey: overKey, pos }
  }

  const from = findSortableTabLocation(sidebarItems, active.tabKey)
  if (!from) return { kind: 'none' }

  if (over.kind === 'group') {
    const groupIndex = sidebarItems.findIndex(item => item.type === 'group' && item.id === over.groupId)
    if (groupIndex < 0) return { kind: 'none' }
    return { kind: 'tab-to-group-start', tabKey: active.tabKey, groupId: over.groupId }
  }

  const to = overRow.location.kind === 'group' && !('itemIndex' in overRow.location) ? overRow.location : findSortableTabLocation(sidebarItems, over.tabKey)
  if (!to) return { kind: 'none' }
  const sameTop = from.kind === 'top' && to.kind === 'top'
  const sameGroup = from.kind === 'group' && to.kind === 'group' && from.groupId === to.groupId

  if (sameTop) return { kind: 'top-relative', movingKey: active.tabKey, targetKey: over.tabKey, pos }
  if (sameGroup) return { kind: 'tab-in-group-relative', groupId: to.groupId, tabKey: active.tabKey, targetTabKey: over.tabKey, pos }
  if (to.kind === 'top') return { kind: 'top-relative', movingKey: active.tabKey, targetKey: over.tabKey, pos }
  return { kind: 'tab-in-group-relative', groupId: to.groupId, tabKey: active.tabKey, targetTabKey: over.tabKey, pos }
}

function applySortableMoveIntent(sidebarItems: SidebarItem[], intent: SortableMoveIntent): SidebarItem[] {
  switch (intent.kind) {
    case 'top-relative':
      return moveTopLevelItemRelative(sidebarItems, intent.movingKey, intent.targetKey, intent.pos)
    case 'tab-to-group-start':
      return moveTabToGroupIndex(sidebarItems, intent.tabKey, intent.groupId, 0)
    case 'tab-in-group-relative':
      return moveTabInGroupRelative(sidebarItems, intent.groupId, intent.tabKey, intent.targetTabKey, intent.pos)
    case 'none':
    default:
      return sidebarItems
  }
}

function SortableIconSlot(props: { args?: SortableItemRenderArgs; label: string; children: React.ReactNode }) {
  const { args, label, children } = props
  const handleProps = args ? args.handleProps : {}
  return (
    <Box
      ref={args?.setHandleRef as any}
      aria-label={args ? label : undefined}
      {...handleProps}
      data-hc-no-drag={args ? '1' : undefined}
      sx={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        cursor: args ? (args.isDragging ? 'grabbing' : 'grab') : undefined,
        touchAction: args ? 'none' : undefined,
      }}
    >
      {children}
    </Box>
  )
}

function SortableDragOverlayCard(props: { title: string; icon: React.ReactNode; groupColor?: string }) {
  const { title, icon, groupColor } = props
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minWidth: 150,
        maxWidth: 220,
        px: 1,
        py: 0.6,
        borderRadius: 2,
        bgcolor: groupColor || '#fff',
        boxShadow: '0 14px 38px rgba(0,0,0,.22)',
        border: '1px solid rgba(0,0,0,.08)',
        pointerEvents: 'none',
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{icon}</Box>
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.2, fontWeight: 900, color: 'rgba(0,0,0,.76)' }}>
        {title}
      </Typography>
    </Box>
  )
}

export function OpenTabsPanel(props: OpenTabsPanelProps) {
  const {
    panelWidth,
    tabsMode,
    sidebarSortMode,
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
    onCommitSidebarItems,
    onMoveTabToUngroupedIndex,
    onMoveTabToGroupIndex,
    onMoveGroupToIndex,
  } = props

  const showTitle = panelWidth > 52
  const disableTopTooltips = tabsMode === 'hover'
  const isSortableMode = sidebarSortMode === 'sortable'
  const [sortablePreviewItems, setSortablePreviewItems] = React.useState<SidebarItem[] | null>(null)
  const [sortableActiveId, setSortableActiveId] = React.useState('')
  const sortableBaseItemsRef = React.useRef<SidebarItem[] | null>(null)
  const sortablePreviewItemsRef = React.useRef<SidebarItem[] | null>(null)
  const effectiveSidebarItems = sortablePreviewItems || sidebarItems

  const updateSortablePreviewItems = React.useCallback((next: SidebarItem[] | null) => {
    sortablePreviewItemsRef.current = next
    setSortablePreviewItems(next)
  }, [])

  React.useEffect(() => {
    if (!isSortableMode) {
      sortableBaseItemsRef.current = null
      updateSortablePreviewItems(null)
      setSortableActiveId('')
    }
  }, [isSortableMode, updateSortablePreviewItems])

  React.useEffect(() => {
    if (!sortableBaseItemsRef.current) updateSortablePreviewItems(null)
  }, [sidebarItems, updateSortablePreviewItems])

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
    enabled: !isSortableMode,
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
    (tabKey: string, tab: NoteMeta, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number; sortable?: SortableItemRenderArgs }) => {
      const isActive = String(activeTabKey || '').trim() === tabKey
      const title = tab.title || '未命名'
      const dirty = !!isNoteDirty?.(tab.id)
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = opts?.sortable?.isDragging || dnd.draggingKey === `tab_${tabKey}`
      const isSortablePlaceholder = !!opts?.sortable && sortableActiveId === sortableTabId(tabKey)
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
              ref={opts?.sortable?.setNodeRef as any}
              {...dnd.getTabProps(tabKey)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            role="button"
            tabIndex={0}
              data-tauri-drag-region="false"
              style={opts?.sortable?.style}
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
              cursor: isDragging ? 'grabbing' : 'pointer',
              opacity: isSortablePlaceholder ? 0.44 : isDragging ? 0.72 : 1,
              border: isSortablePlaceholder ? '1px dashed rgba(25,118,210,.46)' : '1px solid transparent',
              bgcolor: isSortablePlaceholder ? 'rgba(25,118,210,.08)' : isDragOver ? 'rgba(25,118,210,.10)' : isActive ? 'rgba(25,118,210,.10)' : 'transparent',
              '&:hover': { bgcolor: isSortablePlaceholder ? 'rgba(25,118,210,.08)' : isDragOver ? 'rgba(25,118,210,.14)' : isActive ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
              '&:focus-visible': { boxShadow: '0 0 0 2px rgba(25,118,210,.32)' },
            }}
          >
            <SortableIconSlot args={opts?.sortable} label={`拖拽排序 ${title}`}>
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
            </SortableIconSlot>
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
    [activeTabKey, dnd, isNoteDirty, onCloseTab, onOpenTab, showTitle, sortableActiveId, tabsMode],
  )

  const renderAssetMetaRow = React.useCallback(
    (tabKey: string, asset: AssetEntry, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number; sortable?: SortableItemRenderArgs }) => {
      const isActive = String(activeTabKey || '').trim() === tabKey
      const title = pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext }) || '附件'
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = opts?.sortable?.isDragging || dnd.draggingKey === `tab_${tabKey}`
      const isSortablePlaceholder = !!opts?.sortable && sortableActiveId === sortableTabId(tabKey)
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
              ref={opts?.sortable?.setNodeRef as any}
              {...dnd.getTabProps(tabKey)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            role="button"
            tabIndex={0}
              data-tauri-drag-region="false"
              style={opts?.sortable?.style}
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
              cursor: isDragging ? 'grabbing' : 'pointer',
              opacity: isSortablePlaceholder ? 0.44 : isDragging ? 0.72 : 1,
              border: isSortablePlaceholder ? '1px dashed rgba(25,118,210,.46)' : '1px solid transparent',
              bgcolor: isSortablePlaceholder ? 'rgba(25,118,210,.08)' : isDragOver ? 'rgba(25,118,210,.10)' : isActive ? 'rgba(25,118,210,.10)' : 'transparent',
              '&:hover': { bgcolor: isSortablePlaceholder ? 'rgba(25,118,210,.08)' : isDragOver ? 'rgba(25,118,210,.14)' : isActive ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
              '&:focus-visible': { boxShadow: '0 0 0 2px rgba(25,118,210,.32)' },
            }}
          >
            <SortableIconSlot args={opts?.sortable} label={`拖拽排序 ${title}`}>{iconEl}</SortableIconSlot>
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
    [activeTabKey, dnd, onCloseAssetTab, onOpenAssetTab, showTitle, sortableActiveId, tabsMode],
  )

  const renderMissingRow = React.useCallback(
    (tabKey: string, kind: 'note' | 'asset', opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number; sortable?: SortableItemRenderArgs }) => {
      const isActive = String(activeTabKey || '').trim() === tabKey
      const title = kind === 'note' ? '已丢失的笔记' : '已丢失的附件'
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = opts?.sortable?.isDragging || dnd.draggingKey === `tab_${tabKey}`
      const isSortablePlaceholder = !!opts?.sortable && sortableActiveId === sortableTabId(tabKey)
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
              ref={opts?.sortable?.setNodeRef as any}
              {...dnd.getTabProps(tabKey)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            role="button"
            tabIndex={0}
              data-tauri-drag-region="false"
              style={opts?.sortable?.style}
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
              cursor: isDragging ? 'grabbing' : 'pointer',
              opacity: isSortablePlaceholder ? 0.44 : isDragging ? 0.72 : 0.86,
              border: isSortablePlaceholder ? '1px dashed rgba(25,118,210,.46)' : '1px solid transparent',
              bgcolor: isSortablePlaceholder ? 'rgba(25,118,210,.08)' : isDragOver ? 'rgba(25,118,210,.10)' : isActive ? 'rgba(25,118,210,.10)' : 'transparent',
              '&:hover': { bgcolor: isSortablePlaceholder ? 'rgba(25,118,210,.08)' : isDragOver ? 'rgba(25,118,210,.14)' : isActive ? 'rgba(25,118,210,.14)' : 'rgba(0,0,0,.04)' },
              '&:focus-visible': { boxShadow: '0 0 0 2px rgba(25,118,210,.32)' },
            }}
          >
            <SortableIconSlot args={opts?.sortable} label={`拖拽排序 ${title}`}>{iconEl}</SortableIconSlot>
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
    [activeTabKey, dnd, noteIdFromTabKey, onCloseAssetTab, onCloseTab, showTitle, sortableActiveId, tabsMode],
  )

  const renderTabKeyRow = React.useCallback(
    (tabKey: string, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number; sortable?: SortableItemRenderArgs }) => {
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

  const handleSortableMove = React.useCallback(
    (activeRawId: string, overRawId: string, _event: DragEndEvent) => {
      const base = sortableBaseItemsRef.current
      const preview = sortablePreviewItemsRef.current
      const finalItems = preview || (base ? applySortableMoveIntent(base, buildSortableMoveIntent(base, activeRawId, overRawId)) : null)
      sortableBaseItemsRef.current = null
      updateSortablePreviewItems(null)
      setSortableActiveId('')
      if (!finalItems) return
      onCommitSidebarItems(finalItems)
    },
    [onCommitSidebarItems, updateSortablePreviewItems],
  )

  const handleSortablePreviewMove = React.useCallback(
    (activeRawId: string, overRawId: string, _event: DragOverEvent) => {
      const base = sortableBaseItemsRef.current || sidebarItems
      if (!sortableBaseItemsRef.current) sortableBaseItemsRef.current = base
      const current = sortablePreviewItemsRef.current || base
      const intent = buildSortableMoveIntent(current, activeRawId, overRawId)
      const nextPreview = applySortableMoveIntent(current, intent)
      updateSortablePreviewItems(nextPreview === base ? null : nextPreview)
    },
    [sidebarItems, updateSortablePreviewItems],
  )

  const handleSortableDragStart = React.useCallback((activeRawId: string) => {
    sortableBaseItemsRef.current = sidebarItems
    updateSortablePreviewItems(null)
    setSortableActiveId(activeRawId)
  }, [sidebarItems, updateSortablePreviewItems])

  const handleSortableDragCancel = React.useCallback(() => {
    sortableBaseItemsRef.current = null
    updateSortablePreviewItems(null)
    setSortableActiveId('')
  }, [updateSortablePreviewItems])

  const shouldDisableSortableItemTransform = React.useCallback(
    (id: string) => !!sortableActiveId && sortableActiveId === id,
    [sortableActiveId],
  )

  const renderSortableTabKeyRow = React.useCallback(
    (tabKey: string, opts?: { topIndex?: number; parentGroupId?: string; groupTabIndex?: number; itemKey?: string }) => {
      const id = sortableTabId(tabKey)
      return (
        <SortableItem key={opts?.itemKey || tabKey} id={id} disableTransform={shouldDisableSortableItemTransform(id)}>
          {sortable => renderTabKeyRow(tabKey, { ...opts, sortable })}
        </SortableItem>
      )
    },
    [renderTabKeyRow, shouldDisableSortableItemTransform],
  )

  const sortableOverlay = React.useMemo(() => {
    const parsed = parseSortableId(sortableActiveId)
    if (!parsed) return null
    if (parsed.kind === 'group') {
      const group = groupById[parsed.groupId]
      if (!group) return null
      return (
        <SortableDragOverlayCard
          title={group.title || '分组'}
          groupColor={group.color}
          icon={<ChevronRightRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.42)' }} />}
        />
      )
    }

    const kind = tabKind(parsed.tabKey)
    if (kind === 'note') {
      const nid = noteIdFromTabKey(parsed.tabKey)
      const meta = (nid && noteById[nid]) || noteByTabKey[parsed.tabKey]
      return <SortableDragOverlayCard title={meta?.title || '已丢失的笔记'} icon={<NotesRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />} />
    }
    const asset = assetByTabKey[parsed.tabKey]
    const title = asset ? pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext }) || '附件' : '已丢失的附件'
    const icon = asset?.kind === 'image'
      ? <ImageRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />
      : asset?.kind === 'video'
        ? <VideoFileRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />
        : <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />
    return <SortableDragOverlayCard title={title} icon={icon} />
  }, [assetByTabKey, groupById, noteById, noteByTabKey, sortableActiveId])

  const renderGroupSection = React.useCallback(
    (params: { group: HyperCortexTabGroupV1; itemIndex: number; list: string[]; isCollapsed: boolean; sortable?: SortableItemRenderArgs; sortableTabs: boolean }) => {
      const { group: g, itemIndex, list, isCollapsed, sortable, sortableTabs } = params
      const isDragOver = dnd.dragOverKey === `group_${g.id}`
      const isDragging = sortable?.isDragging || dnd.draggingKey === `group_${g.id}`
      const isSortablePlaceholder = !!sortable && sortableActiveId === sortableGroupId(g.id)
      const groupTitle = g.title || '分组'

      const tabList = isCollapsed ? null : list.length ? (
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
          {sortableTabs ? null : <GroupDropSlot groupId={g.id} index={0} active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === 0} showTitle={showTitle} />}
          {sortableTabs ? (
            <SortableSection items={list.map(sortableTabId)}>
              {list.map((tabKey, groupTabIndex) => renderSortableTabKeyRow(tabKey, { topIndex: itemIndex, parentGroupId: g.id, groupTabIndex, itemKey: `${g.id}_${tabKey}` }))}
            </SortableSection>
          ) : (
            list.map((tabKey, groupTabIndex) => (
              <React.Fragment key={tabKey}>
                {renderTabKeyRow(tabKey, { topIndex: itemIndex, parentGroupId: g.id, groupTabIndex })}
                <GroupDropSlot
                  groupId={g.id}
                  index={groupTabIndex + 1}
                  active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === groupTabIndex + 1}
                  showTitle={showTitle}
                />
              </React.Fragment>
            ))
          )}
        </Box>
      ) : sortableTabs ? null : (
        <GroupDropSlot groupId={g.id} index={0} active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === 0} showTitle={showTitle} />
      )

      return (
        <Box ref={sortable?.setNodeRef as any} style={sortable?.style} sx={{ position: 'relative' }}>
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
              cursor: isDragging ? 'grabbing' : 'pointer',
              opacity: isSortablePlaceholder ? 0.5 : isDragging ? 0.78 : 1,
              border: isSortablePlaceholder ? '1px dashed rgba(25,118,210,.50)' : '1px solid transparent',
              bgcolor: g.color,
              backgroundImage: isSortablePlaceholder ? 'linear-gradient(0deg, rgba(255,255,255,.34), rgba(255,255,255,.34))' : isDragOver ? 'linear-gradient(0deg, rgba(25,118,210,.10), rgba(25,118,210,.10))' : 'none',
              '&:hover': { filter: 'brightness(0.985)' },
              '&:focus-visible': { backgroundImage: 'linear-gradient(0deg, rgba(25,118,210,.14), rgba(25,118,210,.14))' },
            }}
          >
            <SortableIconSlot args={sortable} label={`拖拽排序分组 ${groupTitle}`}>
              <ChevronRightRoundedIcon
                fontSize="small"
                sx={{ color: 'rgba(0,0,0,.42)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }}
              />
            </SortableIconSlot>
            {showTitle ? (
              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.72)' }}>
                {groupTitle}
              </Typography>
            ) : null}
            {showTitle ? <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)' }}>{list.length}</Typography> : null}
          </Box>
          {tabList}
        </Box>
      )
    },
    [dnd, onToggleGroupCollapsed, renderSortableTabKeyRow, renderTabKeyRow, showTitle, sortableActiveId],
  )

  const renderPrecisionSidebarItems = React.useCallback(
    () => (
      <>
        <TopLevelDropSlot index={0} active={dnd.dropIndicator.kind === 'top-slot' && dnd.dropIndicator.index === 0} />

        {effectiveSidebarItems.map((item, itemIndex) => {
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
          return renderGroupSection({ group: g, itemIndex, list, isCollapsed, sortableTabs: false })
        })}
      </>
    ),
    [dnd.dropIndicator, effectiveSidebarItems, groupById, renderGroupSection, renderTabKeyRow],
  )

  const renderSortableSidebarItems = React.useCallback(
    () => {
      const topLevelIds = effectiveSidebarItems.map(item => (item.type === 'tab' ? sortableTabId(item.tabKey) : sortableGroupId(item.id)))
      return (
        <SortableRoot
          overlay={sortableOverlay}
          onMove={handleSortableMove}
          onPreviewMove={handleSortablePreviewMove}
          onDragStart={handleSortableDragStart}
          onDragCancel={handleSortableDragCancel}
        >
          <SortableSection items={topLevelIds}>
            {effectiveSidebarItems.map((item, itemIndex) => {
              if (item.type === 'tab') return renderSortableTabKeyRow(item.tabKey, { topIndex: itemIndex })
              const g = groupById[item.id]
              if (!g) return null
              const list = item.tabKeys || []
              const groupSortableId = sortableGroupId(g.id)
              return (
                <SortableItem key={g.id} id={groupSortableId} disableTransform={shouldDisableSortableItemTransform(groupSortableId)}>
                  {sortable => renderGroupSection({ group: g, itemIndex, list, isCollapsed: g.collapsed === true, sortable, sortableTabs: true })}
                </SortableItem>
              )
            })}
          </SortableSection>
        </SortableRoot>
      )
    },
    [effectiveSidebarItems, groupById, handleSortableDragCancel, handleSortableDragStart, handleSortableMove, handleSortablePreviewMove, renderGroupSection, renderSortableTabKeyRow, shouldDisableSortableItemTransform, sortableOverlay],
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

        {isSortableMode ? renderSortableSidebarItems() : renderPrecisionSidebarItems()}
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
