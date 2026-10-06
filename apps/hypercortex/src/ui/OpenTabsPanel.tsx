import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import WorkspacesRoundedIcon from '@mui/icons-material/WorkspacesRounded'
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded'
import type { HyperCortexSidebarSortModeV1, HyperCortexTabGroupV1, NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey, assetTabId } from '../assetTypes'
import { noteTabKey } from '../tabKey'
import type { SidebarItem } from './sidebarModel'
import { SortableItem, SortableSection, SortableSideScope } from './SortableDnd'
import { DragOverlay } from '@dnd-kit/core'
import { useOpenTabsPointerDnd } from './useOpenTabsPointerDnd'
import { parseSortableId, parseSortableSlotId, sortableGroupId, sortableTabId, sortableTopSlotId } from './openTabsSortableModel'
import { useOpenTabsSortableDnd } from './useOpenTabsSortableDnd'
import { useOpenTabsSortableOverlay } from './OpenTabsSortableOverlay'
import { useScrollMemory } from './scrollMemory'
import { useWorkspaceVisible } from './workspaceVisibility'
import { SortableInsertionSlot, TopLevelDropSlot, useOpenTabsPanelRows } from './OpenTabsPanelRows'
import { useOpenTabsPanelGroupSection } from './OpenTabsPanelGroupSection'
import { OpenTabsPanelGroupContextMenu, OpenTabsPanelWorkspaceMenu, type OpenTabsPanelGroupMenuState } from './OpenTabsPanelMenus'
import { DND_SIDE_ATTR, useWorkspaceDndParticipant, useWorkspaceDndSides } from './workspaceDnd'
import type { FavoritesForeignPayload } from './useFavoritesSidebarDnd'

const ACTIVE_TAB_SCROLL_PADDING = 16

function scrollActiveTabIntoView(container: HTMLElement, row: HTMLElement) {
  const containerRect = container.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const upperOverflow = rowRect.top - containerRect.top - ACTIVE_TAB_SCROLL_PADDING
  const lowerOverflow = rowRect.bottom - containerRect.bottom + ACTIVE_TAB_SCROLL_PADDING

  if (upperOverflow < 0) {
    container.scrollTo({ top: Math.max(0, container.scrollTop + upperOverflow), behavior: 'smooth' })
    return
  }
  if (lowerOverflow > 0) container.scrollTo({ top: container.scrollTop + lowerOverflow, behavior: 'smooth' })
}

export type OpenTabsPanelProps = {
  panelWidth: number
  tabsMode: 'manual' | 'hover'
  sidebarSortMode: HyperCortexSidebarSortModeV1
  tabsCollapsed: boolean
  sidebarItems: SidebarItem[]
  openTabKeys: string[]
  activeTabKey?: string
  tabSelectionVisible?: boolean
  activeTabScrollSignal?: number
  /** 当前工作区列表的滚动记忆值（像素）；工作区切换、现场装载与现场可见化时恢复。 */
  sidebarScrollTop?: number
  /** 现场可见化恢复信号：变化即重新应用滚动记忆（覆盖常驻期间可能的视图丢失）。 */
  sidebarScrollRestoreSignal?: number
  /** 列表滚动上报：现场据此记忆当前工作区的浏览位置。 */
  onSidebarScrollTopChange?: (scrollTop: number) => void
  openNoteTabs: NoteMeta[]
  openAssetTabs?: AssetEntry[]
  playingTabKeys?: ReadonlySet<string>
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
  /** 笔记/附件条目右键：接入与收藏夹侧栏同源的实体操作菜单。 */
  onNoteContextMenu?: (event: React.MouseEvent, note: NoteMeta) => void
  onAssetContextMenu?: (event: React.MouseEvent, asset: AssetEntry) => void
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

export function OpenTabsPanel(props: OpenTabsPanelProps) {
  const {
    panelWidth,
    tabsMode,
    sidebarSortMode,
    tabsCollapsed,
    sidebarItems,
    openTabKeys,
    activeTabKey,
    tabSelectionVisible = true,
    activeTabScrollSignal = 0,
    sidebarScrollTop = 0,
    sidebarScrollRestoreSignal = 0,
    onSidebarScrollTopChange,
    openNoteTabs,
    openAssetTabs,
    playingTabKeys,
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
    onNoteContextMenu,
    onAssetContextMenu,
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
  const workspaceVisible = useWorkspaceVisible()

  const showTitle = panelWidth > 52
  const isSortableMode = sidebarSortMode === 'sortable'
  const sortableDnd = useOpenTabsSortableDnd({ enabled: isSortableMode, sidebarItems, onCommitSidebarItems })
  const { activeId: sortableActiveId, effectiveSidebarItems } = sortableDnd

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
    onMoveTabToUngroupedIndex,
    onMoveTabToGroupIndex,
    onMoveGroupToIndex,
  })

  // 与右侧共用一个拖拽上下文：注册左侧参与者。指针在左侧时按本侧原生排序；
  // 指针进入右侧后本栏移出该条目，由右侧以同一身份接管，左侧排序预览立即停止。
  const getCrossPayload = React.useCallback(
    (activeId: string): FavoritesForeignPayload | null => {
      const parsed = parseSortableId(activeId)
      if (parsed?.kind !== 'tab') return null
      const note = noteByTabKey[parsed.tabKey]
      if (note) return { id: activeId, kind: 'note', targetId: note.id }
      const asset = assetByTabKey[parsed.tabKey]
      if (asset) return { id: activeId, kind: 'asset', targetId: assetRefKey(asset) }
      return null
    },
    [assetByTabKey, noteByTabKey],
  )

  useWorkspaceDndParticipant('left', {
    owns: id => !!parseSortableId(id) || !!parseSortableSlotId(id),
    onDragStart: activeId => sortableDnd.handleDragStart(activeId),
    onDragOver: (activeId, overId, event) => sortableDnd.handlePreviewMove(activeId, overId, event),
    onDragEnd: (activeId, overId, event) => sortableDnd.handleMove(activeId, overId, event),
    onDragCancel: () => sortableDnd.handleDragCancel(),
    getDragPayload: getCrossPayload,
    onCrossLeave: () => sortableDnd.beginCrossTakeover(),
  })

  // 非活动侧静态渲染：指针不在本侧、且本侧非拖拽来源时，条目不参与拖拽刷新与碰撞。
  const dndSides = useWorkspaceDndSides()
  const sideEnabled = !dndSides.dragging || dndSides.pointerSide === 'left' || dndSides.originSide === 'left'

  const [groupMenu, setGroupMenu] = React.useState<OpenTabsPanelGroupMenuState>(null)
  const [renameState, setRenameState] = React.useState<{ groupId: string; title: string } | null>(null)
  const [workspaceMenuAnchorEl, setWorkspaceMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const [workspaceEditor, setWorkspaceEditor] = React.useState<{ mode: 'create' | 'rename'; title: string } | null>(null)
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = React.useState<{ id: string; title: string } | null>(null)
  const activeTabRowRef = React.useRef<HTMLElement | null>(null)

  // 列表滚动记忆：rAF 节流上报，工作区切换/现场可见化时还原（与右侧收藏夹栏共用同一机制）。
  const { scrollRef: scrollContainerRef, onScroll: handleSidebarScroll } = useScrollMemory({
    scrollTop: sidebarScrollTop,
    restoreKey: activeWorkspaceId,
    restoreSignal: sidebarScrollRestoreSignal,
    onScrollTopChange: onSidebarScrollTopChange,
  })

  React.useLayoutEffect(() => {
    if (activeTabScrollSignal <= 0) return
    const container = scrollContainerRef.current
    const row = activeTabRowRef.current
    if (!container || !row) return
    scrollActiveTabIntoView(container, row)
  }, [activeTabScrollSignal, scrollContainerRef])

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

  const { renderTabKeyRow, renderSortableTabKeyRow } = useOpenTabsPanelRows({
    activeTabKey,
    tabSelectionVisible,
    tabsMode,
    showTitle,
    activeTabRowRef,
    sortableActiveId,
    playingTabKeys,
    isNoteDirty,
    onOpenTab,
    onCloseTab,
    onOpenAssetTab,
    onCloseAssetTab,
    onNoteContextMenu,
    onAssetContextMenu,
    noteById,
    noteByTabKey,
    assetByTabKey,
    dnd,
    sortableDnd,
  })

  const sortableOverlay = useOpenTabsSortableOverlay({ activeId: sortableActiveId, assetByTabKey, groupById, noteById, noteByTabKey })

  const sortableActive = React.useMemo(() => parseSortableId(sortableActiveId), [sortableActiveId])
  const canDropSortableTab = sortableActive?.kind === 'tab'
  const canDropSortableGroup = sortableActive?.kind === 'group'

  const renderGroupSection = useOpenTabsPanelGroupSection({
    showTitle,
    dnd,
    sortableActiveId,
    canDropSortableTab,
    renderTabKeyRow,
    renderSortableTabKeyRow,
    onToggleGroupCollapsed,
    setGroupMenu,
  })

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
        <SortableSideScope enabled={sideEnabled}>
          <SortableSection items={topLevelIds}>
            <SortableInsertionSlot id={sortableTopSlotId(0)} enabled={!!sortableActiveId} showTitle={showTitle} />
            {effectiveSidebarItems.map((item, itemIndex) => {
              if (item.type === 'tab') {
                return (
                  <React.Fragment key={`top_${item.tabKey}`}>
                    {renderSortableTabKeyRow(item.tabKey, { topIndex: itemIndex })}
                    <SortableInsertionSlot id={sortableTopSlotId(itemIndex + 1)} enabled={!!sortableActiveId} showTitle={showTitle} />
                  </React.Fragment>
                )
              }
              const g = groupById[item.id]
              if (!g) return null
              const list = item.tabKeys || []
              const groupSortableId = sortableGroupId(g.id)
              return (
                <React.Fragment key={`group_${g.id}`}>
                  <SortableItem id={groupSortableId} disableTransform={sortableDnd.shouldDisableItemTransform(groupSortableId)}>
                    {sortable => renderGroupSection({ group: g, itemIndex, list, isCollapsed: g.collapsed === true, sortable, sortableTabs: true })}
                  </SortableItem>
                  <SortableInsertionSlot id={sortableTopSlotId(itemIndex + 1)} enabled={!!sortableActiveId} showTitle={showTitle} />
                </React.Fragment>
              )
            })}
          </SortableSection>
        </SortableSideScope>
      )
    },
    [effectiveSidebarItems, groupById, renderGroupSection, renderSortableTabKeyRow, showTitle, sideEnabled, sortableActiveId, sortableDnd],
  )

  return (
    <>
      <Box
        sx={{
          px: 0.75,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {panelWidth <= 52 ? (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {tabsMode === 'manual' ? (
              <IconButton size="small" aria-label={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} onClick={onToggleTabsCollapsed}>
                {tabsCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
              </IconButton>
            ) : (
              <IconButton size="small" aria-label="切换侧边栏模式" onClick={onToggleTabsMode} sx={{ color: 'rgba(0,0,0,.58)' }}>
                <SyncAltRoundedIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        ) : (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {tabsMode === 'manual' ? (
                <IconButton size="small" aria-label={tabsCollapsed ? '展开已打开笔记' : '收起已打开笔记'} onClick={onToggleTabsCollapsed}>
                  {tabsCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
                </IconButton>
              ) : null}
            </Box>

            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
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
            </Box>

            <IconButton size="small" aria-label="新建笔记" onClick={onCreateDraftNote} sx={{ color: 'rgba(0,0,0,.58)' }}>
              <AddRoundedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small" aria-label="新建分组" onClick={onCreateGroup} sx={{ color: 'rgba(0,0,0,.58)' }}>
              <FolderRoundedIcon fontSize="small" />
            </IconButton>

            <IconButton
              size="small"
              aria-label="全部收起分组"
              onClick={onCollapseAllGroups}
              disabled={tabGroups.length === 0}
              sx={{ color: 'rgba(0,0,0,.58)' }}
            >
              <UnfoldLessRoundedIcon fontSize="small" />
            </IconButton>

            <IconButton size="small" aria-label="切换侧边栏模式" onClick={onToggleTabsMode} sx={{ color: 'rgba(0,0,0,.58)' }}>
              <SyncAltRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
      </Box>

      <Box
        ref={scrollContainerRef}
        {...dnd.containerProps}
        {...{ [DND_SIDE_ATTR]: 'left' }}
        onScroll={handleSidebarScroll}
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
          bgcolor: dnd.dragOverKey === 'container' ? 'var(--hc-primary-soft)' : 'transparent',
          transition: 'background-color 120ms ease',
        }}
      >
        {!openTabKeys.length && !tabGroups.length && showTitle ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'rgba(0,0,0,.42)' }}>还没有打开的标签页</Typography>
        ) : null}

        {isSortableMode ? renderSortableSidebarItems() : renderPrecisionSidebarItems()}
      </Box>

      <OpenTabsPanelGroupContextMenu
        groupMenu={groupMenu}
        menuOpen={menuOpen}
        onClose={closeMenu}
        requestRename={requestRename}
        onSetGroupColor={onSetGroupColor}
        onDeleteGroupOnly={onDeleteGroupOnly}
        onDeleteGroupAndCloseTabs={onDeleteGroupAndCloseTabs}
      />

      <OpenTabsPanelWorkspaceMenu
        open={workspaceMenuOpen}
        anchorEl={workspaceMenuAnchorEl}
        onClose={closeWorkspaceMenu}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSwitchWorkspace={onSwitchWorkspace}
        onRequestRename={() => setWorkspaceEditor({ mode: 'rename', title: activeWorkspaceTitle })}
        onRequestCreate={() => setWorkspaceEditor({ mode: 'create', title: '' })}
        onRequestDelete={() => {
          const wid = activeWorkspaceId || workspaces[0]?.id || ''
          if (!wid) return
          const title = workspaces.find(w => w.id === wid)?.title || '工作区'
          setWorkspaceDeleteTarget({ id: wid, title })
        }}
      />

      <Dialog open={workspaceVisible && !!workspaceDeleteTarget} onClose={() => setWorkspaceDeleteTarget(null)} maxWidth="xs" fullWidth>
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
        open={workspaceVisible && !!workspaceEditor}
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

      <Dialog open={workspaceVisible && !!renameState} onClose={() => setRenameState(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 7 } }}>
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

      <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
        {sortableOverlay}
      </DragOverlay>
    </>
  )
}
