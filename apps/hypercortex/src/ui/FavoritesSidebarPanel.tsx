import * as React from 'react'
import { Box, Button, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import type { HyperCortexFavoritesNavV1, NoteMeta } from '../core'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { getFolderById } from '../favorites'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey } from '../assetTypes'
import { isDraftNoteId } from '../drafts'
import { resolveAssetRef } from '../assetLookup'
import { SIDEBAR_PREVIEW_ENTRY_ATTR } from './sidebar-preview/previewTarget'
import { isFavoriteRefActive, type FavoriteFolderView } from './favoritesSidebarModel'
import { getAssetPreviewDescriptor } from './assetPreview/registry'
import { SIDEBAR_ROW_HEIGHT } from './sidebarLayout'
import { favoritesNavTrail } from './favoritesNavigator'
import { menuPaperSx } from './pluginUiStyles'
import { SortableItem, SortableRoot, SortableSection, type SortableItemRenderArgs } from './SortableDnd'
import { folderTitle } from './index-page/helpers'

const ACTIVE_ENTRY_SCROLL_PADDING = 16

export type FavoritesSidebarPanelProps = {
  panelWidth: number
  mode: 'manual' | 'hover'
  collapsed: boolean
  doc: HyperCortexFavoritesDocV1 | null
  nav: HyperCortexFavoritesNavV1
  /** 当前收藏夹页的唯一视图：引用、附件查找表与可切换条目，由上层统一组装。 */
  folderView: FavoriteFolderView
  noteIndex?: Record<string, NoteMeta>
  /** 当前激活的详情目标（标签键）；用于把选中态落在右侧条目上。 */
  activeTabKey?: string
  /** 详情页选中态是否归属右侧栏：为真时按 activeTabKey 高亮当前条目。 */
  tabSelectionVisible?: boolean
  /** 激活条目滚动信号：变化即把当前选中条目滚入视野。 */
  activeEntryScrollSignal?: number
  /** 当前收藏夹记忆的滚动位置：切回该收藏夹时还原。 */
  scrollTop?: number
  /** 滚动还原信号：变化即按 scrollTop 还原列表位置。 */
  scrollRestoreSignal?: number
  /** 列表滚动上报：现场据此记忆当前收藏夹的浏览位置。 */
  onScrollTopChange?: (scrollTop: number) => void
  onNavigate: (folderId: string) => void
  onBack: () => void
  onForward: () => void
  onToggleCollapsed: () => void
  onToggleMode: () => void
  onOpenNote: (note: NoteMeta, openInTabs?: boolean) => void
  onOpenAsset: (asset: AssetEntry, openInTabs?: boolean) => void
  /** 在当前收藏夹新建草稿笔记（语义同左侧栏新建，不落盘）。 */
  onCreateNote?: () => void
  /** 关闭草稿态笔记条目（语义同左侧标签栏关闭，丢弃内存草稿）。 */
  onCloseDraftNote?: (noteId: string) => void
  /** 条目右键：由上层统一实体操作菜单接管。 */
  onEntryContextMenu?: (event: React.MouseEvent, ref: FavoriteItemRef) => void
  /** 条目拖拽排序：提交当前收藏夹内条目的新顺序（引用标识序列）。 */
  onReorderRefs?: (folderId: string, orderedRefIds: string[]) => void
}

function assetRowTitle(asset: AssetEntry): string {
  return String(asset.displayName || asset.fileName || asset.assetId || '附件')
}

/** 打开意图修饰键：按住 Ctrl（或 Mac 的 Cmd）点击表示“在左侧标签栏打开”。 */
function isOpenInTabsModifier(event?: React.MouseEvent): boolean {
  return !!event && (event.ctrlKey || event.metaKey)
}

export function FavoritesSidebarPanel(props: FavoritesSidebarPanelProps): React.ReactNode {
  const {
    panelWidth,
    mode,
    collapsed,
    doc,
    nav,
    folderView,
    noteIndex,
    activeTabKey,
    tabSelectionVisible = false,
    activeEntryScrollSignal = 0,
    scrollTop = 0,
    scrollRestoreSignal = 0,
    onScrollTopChange,
    onNavigate,
    onBack,
    onForward,
    onToggleCollapsed,
    onToggleMode,
    onOpenNote,
    onOpenAsset,
    onCreateNote,
    onCloseDraftNote,
    onEntryContextMenu,
    onReorderRefs,
  } = props

  const showTitle = panelWidth > 52
  const disableTooltips = mode === 'hover'
  const canGoBack = nav.back.length > 0
  const canGoForward = nav.forward.length > 0
  const currentTitle = doc ? folderTitle(doc, nav.currentFolderId) : '收藏夹'
  const [pathMenuAnchorEl, setPathMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const [pathMenuWidth, setPathMenuWidth] = React.useState<number | null>(null)
  const [overflowMenuAnchorEl, setOverflowMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const pathMenuOpen = Boolean(pathMenuAnchorEl)
  const overflowMenuOpen = Boolean(overflowMenuAnchorEl)
  const pathItems = React.useMemo(
    () => (doc ? favoritesNavTrail(nav).map(id => ({ id, title: folderTitle(doc, id) })) : []),
    [doc, nav],
  )
  const assetLookup = folderView.lookup
  const refs = folderView.refs

  // 选中态归属右侧栏时，把当前激活目标（标签键）映射回当前页的条目引用。
  const activeKey = tabSelectionVisible ? String(activeTabKey || '').trim() : ''
  const isRefActive = React.useCallback(
    (ref: FavoriteItemRef): boolean => (activeKey ? isFavoriteRefActive(ref, activeKey, assetLookup) : false),
    [activeKey, assetLookup],
  )

  // 激活条目滚动入视野：与左侧标签栏同一套“信号触发 + 边界留白”的做法。
  const listScrollRef = React.useRef<HTMLDivElement | null>(null)
  const activeRowRef = React.useRef<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    if (activeEntryScrollSignal <= 0) return
    const container = listScrollRef.current
    const row = activeRowRef.current
    if (!container || !row) return
    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const upperOverflow = rowRect.top - containerRect.top - ACTIVE_ENTRY_SCROLL_PADDING
    const lowerOverflow = rowRect.bottom - containerRect.bottom + ACTIVE_ENTRY_SCROLL_PADDING
    if (upperOverflow < 0) {
      container.scrollTo({ top: Math.max(0, container.scrollTop + upperOverflow), behavior: 'smooth' })
      return
    }
    if (lowerOverflow > 0) container.scrollTo({ top: container.scrollTop + lowerOverflow, behavior: 'smooth' })
  }, [activeEntryScrollSignal])

  // 列表滚动上报：rAF 节流，现场据此记忆当前收藏夹的浏览位置。
  const scrollReportRafRef = React.useRef<number | null>(null)
  const handleListScroll = React.useCallback(() => {
    if (!onScrollTopChange) return
    if (scrollReportRafRef.current != null) return
    scrollReportRafRef.current = requestAnimationFrame(() => {
      scrollReportRafRef.current = null
      const container = listScrollRef.current
      if (!container) return
      onScrollTopChange(container.scrollTop)
    })
  }, [onScrollTopChange])
  React.useEffect(() => {
    return () => {
      if (scrollReportRafRef.current != null) cancelAnimationFrame(scrollReportRafRef.current)
      scrollReportRafRef.current = null
    }
  }, [])

  // 收藏夹切换与现场可见化时恢复列表滚动位置。
  // 目标值经「最新值」ref 读取：同收藏夹内的滚动上报与普通重渲染不触发恢复，不与用户操作抢位置。
  const scrollTopValueRef = React.useRef(scrollTop)
  React.useLayoutEffect(() => {
    scrollTopValueRef.current = scrollTop
  })
  React.useLayoutEffect(() => {
    const container = listScrollRef.current
    if (!container) return
    const target = Math.max(0, Math.floor(Number(scrollTopValueRef.current) || 0))
    if (container.scrollTop !== target) container.scrollTop = target
  }, [nav.currentFolderId, scrollRestoreSignal])

  // 条目拖拽排序：实时预览重排 + 浮层跟手，拖拽项禁用 transform，松手即最终顺序，避免落位闪烁。
  const dragSuppressClickRef = React.useRef(false)
  const [dragPreviewIds, setDragPreviewIds] = React.useState<string[] | null>(null)
  const [dragActiveId, setDragActiveId] = React.useState('')
  const dragBaseIdsRef = React.useRef<string[]>([])
  const dragPreviewIdsRef = React.useRef<string[] | null>(null)

  const effectiveRefs = React.useMemo(() => {
    if (!dragPreviewIds) return refs
    const byId = new Map(refs.map(ref => [ref.id, ref] as const))
    const ordered = dragPreviewIds.map(id => byId.get(id)).filter((ref): ref is FavoriteItemRef => Boolean(ref))
    return ordered.length === refs.length ? ordered : refs
  }, [dragPreviewIds, refs])

  const dragOverlayRef = React.useMemo(() => (dragActiveId ? refs.find(ref => ref.id === dragActiveId) ?? null : null), [dragActiveId, refs])
  const dragOverlayTitle = React.useMemo(() => {
    if (!dragOverlayRef) return ''
    if (dragOverlayRef.kind === 'folder') return doc ? folderTitle(doc, dragOverlayRef.targetId) : '收藏夹'
    if (dragOverlayRef.kind === 'note') return noteIndex?.[dragOverlayRef.targetId]?.title || '已丢失的笔记'
    if (dragOverlayRef.kind === 'asset') {
      const asset = resolveAssetRef(assetLookup, dragOverlayRef.targetId)
      return asset ? assetRowTitle(asset) : '已丢失的附件'
    }
    return '已丢失的条目'
  }, [assetLookup, doc, dragOverlayRef, noteIndex])

  const dragOverlayIcon = React.useMemo(() => {
    if (!dragOverlayRef) return null
    if (dragOverlayRef.kind === 'folder') return <FolderRoundedIcon fontSize="small" sx={{ color: 'var(--hc-primary)' }} />
    if (dragOverlayRef.kind === 'note') return <NotesRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
    if (dragOverlayRef.kind === 'asset') {
      const asset = resolveAssetRef(assetLookup, dragOverlayRef.targetId)
      if (asset) {
        const preview = getAssetPreviewDescriptor(asset)
        const PreviewIcon = preview.icon
        if (preview.kind !== 'unsupported') return <PreviewIcon fontSize="small" sx={{ color: preview.color }} />
      }
    }
    return <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
  }, [assetLookup, dragOverlayRef])

  const handleDragStart = React.useCallback(
    (activeId: string) => {
      dragBaseIdsRef.current = refs.map(ref => ref.id)
      dragPreviewIdsRef.current = null
      setDragPreviewIds(null)
      setDragActiveId(activeId)
    },
    [refs],
  )

  const handleDragOver = React.useCallback(
    (activeId: string, overId: string) => {
      const base = dragBaseIdsRef.current.length ? dragBaseIdsRef.current : refs.map(ref => ref.id)
      const current = dragPreviewIdsRef.current || base
      const fromIndex = current.indexOf(activeId)
      const toIndex = current.indexOf(overId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
      const next = current.slice()
      next.splice(toIndex, 0, next.splice(fromIndex, 1)[0])
      dragPreviewIdsRef.current = next
      setDragPreviewIds(next)
    },
    [refs],
  )

  const handleDragEnd = React.useCallback(() => {
    dragSuppressClickRef.current = true
    window.setTimeout(() => {
      dragSuppressClickRef.current = false
    }, 0)
    const next = dragPreviewIdsRef.current
    const base = dragBaseIdsRef.current
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
    setDragActiveId('')
    if (!next || !base.length) return
    if (next.length === base.length && next.every((id, index) => id === base[index])) return
    onReorderRefs?.(nav.currentFolderId, next)
  }, [nav.currentFolderId, onReorderRefs])

  const handleDragCancel = React.useCallback(() => {
    dragSuppressClickRef.current = false
    dragBaseIdsRef.current = []
    dragPreviewIdsRef.current = null
    setDragPreviewIds(null)
    setDragActiveId('')
  }, [])

  const renderFolderRow = (ref: FavoriteItemRef, sortable?: SortableItemRenderArgs): React.ReactNode => {
    const folder = doc ? getFolderById(doc, ref.targetId) : undefined
    if (!folder) return renderMissingRow(ref, sortable)
    const title = folder.title || '未命名收藏夹'
    return (
      <RowShell showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} previewEntry={`folder:${folder.id}`} onClick={() => onNavigate(folder.id)} onContextMenu={e => onEntryContextMenu?.(e, ref)} sortable={sortable} shouldSuppressClick={() => dragSuppressClickRef.current}>
        <FolderRoundedIcon fontSize="small" sx={{ color: 'var(--hc-primary)' }} />
        {showTitle ? <RowLabel title={title} /> : null}
        {showTitle ? <ChevronRightRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.32)', flexShrink: 0 }} /> : null}
      </RowShell>
    )
  }

  const renderNoteRow = (ref: FavoriteItemRef, sortable?: SortableItemRenderArgs): React.ReactNode => {
    const note = noteIndex?.[ref.targetId]
    if (!note) return renderMissingRow(ref, sortable)
    const title = note.title || '未命名'
    const active = isRefActive(ref)
    const isDraft = isDraftNoteId(note.id)
    return (
      <RowShell showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} active={active} activeRef={active ? activeRowRef : undefined} previewEntry={`note:${note.id}`} onClick={event => onOpenNote(note, isOpenInTabsModifier(event))} onContextMenu={e => onEntryContextMenu?.(e, ref)} sortable={sortable} shouldSuppressClick={() => dragSuppressClickRef.current}>
        <NotesRoundedIcon fontSize="small" sx={{ color: active ? 'var(--hc-primary)' : 'var(--hc-text-subtle)' }} />
        {showTitle ? <RowLabel title={title} active={active} /> : null}
        {showTitle && isDraft ? (
          <Tooltip title="关闭" placement="left">
            <IconButton
              size="small"
              aria-label={`关闭 ${title}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation()
                onCloseDraftNote?.(note.id)
              }}
              sx={{
                color: 'rgba(0,0,0,.42)',
                '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
              }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </RowShell>
    )
  }

  const renderAssetRow = (ref: FavoriteItemRef, sortable?: SortableItemRenderArgs): React.ReactNode => {
    const asset = resolveAssetRef(assetLookup, ref.targetId)
    if (!asset) return renderMissingRow(ref, sortable)
    const title = assetRowTitle(asset)
    const preview = getAssetPreviewDescriptor(asset)
    const PreviewIcon = preview.icon
    const active = isRefActive(ref)
    return (
      <RowShell showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} active={active} activeRef={active ? activeRowRef : undefined} previewEntry={`asset:${assetRefKey(asset)}`} onClick={event => onOpenAsset(asset, isOpenInTabsModifier(event))} onContextMenu={e => onEntryContextMenu?.(e, ref)} sortable={sortable} shouldSuppressClick={() => dragSuppressClickRef.current}>
        {preview.kind !== 'unsupported' ? (
          <PreviewIcon fontSize="small" sx={{ color: active ? 'var(--hc-primary)' : preview.color }} />
        ) : (
          <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: active ? 'var(--hc-primary)' : 'var(--hc-asset-file)' }} />
        )}
        {showTitle ? <RowLabel title={title} active={active} /> : null}
      </RowShell>
    )
  }

  const renderMissingRow = (ref: FavoriteItemRef, sortable?: SortableItemRenderArgs): React.ReactNode => {
    const title = '已丢失的条目'
    return (
      <RowShell showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} muted onClick={() => {}} onContextMenu={e => onEntryContextMenu?.(e, ref)} sortable={sortable} shouldSuppressClick={() => dragSuppressClickRef.current}>
        <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
        {showTitle ? <RowLabel title={title} /> : null}
      </RowShell>
    )
  }

  const renderRef = (ref: FavoriteItemRef, sortable?: SortableItemRenderArgs): React.ReactNode => {
    if (ref.kind === 'folder') return renderFolderRow(ref, sortable)
    if (ref.kind === 'note') return renderNoteRow(ref, sortable)
    if (ref.kind === 'asset') return renderAssetRow(ref, sortable)
    return renderMissingRow(ref, sortable)
  }

  const renderOverflowButton = (): React.ReactNode => (
    <IconButton
      size="small"
      aria-label="更多操作"
      aria-haspopup="menu"
      aria-expanded={overflowMenuOpen ? 'true' : undefined}
      onClick={e => setOverflowMenuAnchorEl(e.currentTarget)}
      sx={{ color: 'rgba(0,0,0,.58)' }}
    >
      <MoreHorizRoundedIcon fontSize="small" />
    </IconButton>
  )

  const renderCreateNoteButton = (): React.ReactNode => (
    <IconButton size="small" aria-label="新建笔记" onClick={onCreateNote} sx={{ color: 'rgba(0,0,0,.58)' }}>
      <AddRoundedIcon fontSize="small" />
    </IconButton>
  )

  return (
    <>
      <Box sx={{ px: 0.75, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.25 }}>
        {!showTitle ? (
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
            {renderCreateNoteButton()}
            {renderOverflowButton()}
          </Box>
        ) : (
          <>
            <span>
              <IconButton size="small" aria-label="后退" disabled={!canGoBack} onClick={onBack}>
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
            </span>
            <span>
              <IconButton size="small" aria-label="前进" disabled={!canGoForward} onClick={onForward}>
                <ArrowForwardRoundedIcon fontSize="small" />
              </IconButton>
            </span>
            <Button
              size="small"
              aria-label="收藏夹路径"
              aria-haspopup="menu"
              aria-expanded={pathMenuOpen ? 'true' : undefined}
              onClick={e => {
                setPathMenuWidth(e.currentTarget.getBoundingClientRect().width)
                setPathMenuAnchorEl(e.currentTarget)
              }}
              endIcon={<ExpandMoreRoundedIcon sx={{ fontSize: 16 }} />}
              sx={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'space-between',
                px: 1,
                py: 0.75,
                minHeight: 32,
                borderRadius: 2,
                textTransform: 'none',
                color: 'var(--hc-text)',
                bgcolor: 'var(--hc-surface-soft)',
                '& .MuiButton-endIcon': { ml: 0.5, mr: 0, flexShrink: 0 },
                '&:hover': { bgcolor: 'var(--hc-primary-soft)' },
              }}
            >
              <Typography noWrap sx={{ minWidth: 0, fontSize: 12, fontWeight: 800 }}>
                {currentTitle}
              </Typography>
            </Button>
            {renderCreateNoteButton()}
            {renderOverflowButton()}
          </>
        )}
      </Box>

      <Menu
        anchorEl={overflowMenuAnchorEl}
        open={overflowMenuOpen}
        onClose={() => setOverflowMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        transitionDuration={0}
        PaperProps={{ sx: menuPaperSx }}
      >
        <MenuItem
          onClick={() => {
            setOverflowMenuAnchorEl(null)
            onToggleCollapsed()
          }}
          sx={{ fontSize: 12, gap: 0.75 }}
        >
          <ListItemIcon sx={{ minWidth: 0, mr: 1 }}>
            {collapsed ? <ChevronLeftRoundedIcon fontSize="small" /> : <ChevronRightRoundedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText primary={collapsed ? '展开收藏夹栏' : '收起收藏夹栏'} primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setOverflowMenuAnchorEl(null)
            onToggleMode()
          }}
          sx={{ fontSize: 12, gap: 0.75 }}
        >
          <ListItemIcon sx={{ minWidth: 0, mr: 1 }}>
            <SyncAltRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={mode === 'manual' ? '切换到悬停展开（覆盖）' : '切换到手动展开（挤压）'}
            primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }}
          />
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={pathMenuAnchorEl}
        open={pathMenuOpen}
        onClose={() => setPathMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        transitionDuration={0}
        slotProps={{
          paper: {
            sx: {
              ...menuPaperSx,
              borderRadius: 3,
              width: pathMenuWidth ?? 'auto',
              minWidth: 0,
              maxWidth: 'none',
            },
          },
        }}
      >
        {pathItems.map(item => {
          const isCurrent = item.id === nav.currentFolderId
          return (
            <MenuItem
              key={item.id}
              selected={isCurrent}
              onClick={() => {
                setPathMenuAnchorEl(null)
                if (!isCurrent) onNavigate(item.id)
              }}
              sx={{ fontSize: 12, gap: 0.75 }}
            >
              <FolderRoundedIcon fontSize="small" sx={{ color: isCurrent ? 'var(--hc-primary)' : 'var(--hc-text-subtle)', flexShrink: 0 }} />
              <Typography noWrap sx={{ fontSize: 12, fontWeight: isCurrent ? 800 : 600, color: isCurrent ? 'var(--hc-text)' : 'var(--hc-text-muted)' }}>
                {item.title}
              </Typography>
            </MenuItem>
          )
        })}
      </Menu>

      <Box
        ref={listScrollRef}
        onScroll={handleListScroll}
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
        }}
      >
        {!refs.length && showTitle ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'rgba(0,0,0,.42)' }}>这个收藏夹还是空的</Typography>
        ) : null}
        <SortableRoot
          overlay={dragActiveId ? <FavoritesDragOverlayCard title={dragOverlayTitle} icon={dragOverlayIcon} /> : null}
          onMove={handleDragEnd}
          onPreviewMove={handleDragOver}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
        >
          <SortableSection items={effectiveRefs.map(ref => ref.id)}>
            {effectiveRefs.map(ref => (
              <SortableItem key={ref.id} id={ref.id} disableTransform={dragActiveId === ref.id}>
                {sortable => renderRef(ref, sortable)}
              </SortableItem>
            ))}
          </SortableSection>
        </SortableRoot>
      </Box>
    </>
  )
}

function RowShell(props: {
  showTitle: boolean
  title: string
  tooltipDisabled: boolean
  muted?: boolean
  active?: boolean
  activeRef?: React.MutableRefObject<HTMLElement | null>
  /** 「按住预览」的条目标识：标注后悬停即可上报预览目标。 */
  previewEntry?: string
  onClick: (event?: React.MouseEvent) => void
  onContextMenu?: (event: React.MouseEvent) => void
  sortable?: SortableItemRenderArgs
  shouldSuppressClick?: () => boolean
  children: React.ReactNode
}): React.ReactNode {
  const { showTitle, title, tooltipDisabled, muted, active = false, activeRef, previewEntry, onClick, onContextMenu, sortable, shouldSuppressClick, children } = props
  return (
    <Tooltip
      title={!showTitle && !tooltipDisabled ? title : ''}
      placement="left"
      disableHoverListener={showTitle || tooltipDisabled}
      disableFocusListener={tooltipDisabled}
      disableTouchListener={tooltipDisabled}
    >
      <Box
        ref={(node: HTMLElement | null) => {
          if (activeRef) activeRef.current = node
          if (sortable) sortable.setNodeRef(node)
        }}
        {...(sortable ? sortable.handleProps : {})}
        {...(previewEntry ? { [SIDEBAR_PREVIEW_ENTRY_ATTR]: previewEntry } : {})}
        role="button"
        tabIndex={0}
        style={sortable?.style}
        onClick={event => {
          if (shouldSuppressClick?.()) return
          onClick(event)
        }}
        onContextMenu={onContextMenu}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onClick()
        }}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: showTitle ? 1 : 0.75,
          minHeight: showTitle ? SIDEBAR_ROW_HEIGHT : undefined,
          py: 0.6,
          boxSizing: 'border-box',
          borderRadius: 2,
          userSelect: 'none',
          outline: 'none',
          cursor: sortable?.isDragging ? 'grabbing' : sortable ? 'grab' : 'pointer',
          touchAction: sortable ? 'none' : undefined,
          opacity: sortable?.isDragging ? 0.72 : muted ? 0.86 : 1,
          zIndex: sortable?.isDragging ? 2 : undefined,
          position: sortable?.isDragging ? 'relative' : undefined,
          bgcolor: active ? 'var(--hc-primary-soft)' : 'transparent',
          '&:hover': { bgcolor: active ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
          '&:focus-visible': { boxShadow: '0 10px 24px var(--hc-shadow)' },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  )
}

function FavoritesDragOverlayCard(props: { title: string; icon: React.ReactNode }): React.ReactNode {
  const { title, icon } = props
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        width: '100%',
        boxSizing: 'border-box',
        px: 1,
        py: 0.6,
        borderRadius: 2,
        bgcolor: 'var(--hc-surface)',
        boxShadow: '0 14px 38px rgba(0,0,0,.22)',
        pointerEvents: 'none',
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{icon}</Box>
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.2, fontWeight: 800, color: 'var(--hc-text)' }}>
        {title}
      </Typography>
    </Box>
  )
}

function RowLabel(props: { title: string; active?: boolean }): React.ReactNode {
  const { title, active = false } = props
  return (
    <Typography
      noWrap
      sx={{
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 1.2,
        fontWeight: active ? 900 : 600,
        color: active ? 'var(--hc-text)' : 'var(--hc-text-muted)',
      }}
    >
      {title}
    </Typography>
  )
}
